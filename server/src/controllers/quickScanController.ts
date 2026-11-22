import { NextFunction,Request,Response } from 'express';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { env } from '../config/env';
import { aiConfigured,aiService,redactSecretLiterals,redactSensitiveLineLiterals,withAICallBudget } from '../services/ai/aiService';
import { findingsFromLizard,runLizard,LizardFinding } from '../services/metricsService';
import { parseSemgrepJson,runSemgrep,SemgrepFinding } from '../services/semgrepService';
import { scoreFile,summarizeRisk } from '../services/riskScoringService';
import { removeTempDir } from '../services/repoService';

const schema=z.object({language:z.enum(['javascript','typescript','python','java']),code:z.string().min(1)}).strict();
const extension:Record<string,string>={javascript:'.js',typescript:'.ts',python:'.py',java:'.java'};
type QuickFinding=(SemgrepFinding|LizardFinding)&{explanation?:string;suggestion?:string;aiGenerated?:boolean};
function timeout<T>(task:Promise<T>,ms:number):Promise<T>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Quick scan timed out.')),ms);void task.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});}
export function quickScan(req:Request,res:Response,next:NextFunction):Promise<void>{return withAICallBudget(env.AI_MAX_CALLS,()=>runQuickScan(req,res,next));}

async function runQuickScan(req:Request,res:Response,next:NextFunction):Promise<void>{
  const input=schema.safeParse(req.body);
  if(!input.success){res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Provide a supported language and code.'}});return;}
  if(Buffer.byteLength(input.data.code,'utf8')>20*1024){res.status(413).json({error:{code:'BODY_TOO_LARGE',message:'Code must be no larger than 20 KB.'}});return;}
  let root='';let payload:Record<string,unknown>|undefined;let failure:unknown;
  const deadline=Date.now()+env.SCAN_TIMEOUT_MS;
  const remaining=()=>{const value=deadline-Date.now();if(value<=0)throw new Error('Quick scan timed out.');return value;};
  try{
    root=await fs.mkdtemp(join(tmpdir(),'devsentry-quick-'));
    const file=join(root,`snippet${extension[input.data.language]}`);
    await fs.writeFile(file,input.data.code,{encoding:'utf8',flag:'wx'});
    const toolTimeout=remaining();
    const [metrics,semgrep]=await timeout(Promise.all([runLizard([file],root,{timeoutMs:toolTimeout}),runSemgrep([file],root,{timeoutMs:toolTimeout})]),toolTimeout);
    const warnings=[...semgrep.warnings];
    const found:QuickFinding[]=[...parseSemgrepJson(semgrep.rawJson,root),...findingsFromLizard(metrics)];
    const counts={critical:0,high:0,medium:0,low:0,info:0};
    for(const item of found)if(item.severity in counts)counts[item.severity as keyof typeof counts]++;
    const metric=metrics[0];
    const risk=scoreFile({nloc:metric?.nloc??input.data.code.split(/\r?\n/).length,maxCcn:metric?.maxCcn??0,commits90d:0,bugFixCommits:0,authors:0,findingCounts:counts});
    let aiStatus:'skipped'|'partial'|'complete'='skipped';
    const explainLimit=Math.min(env.AI_MAX_FINDINGS,env.AI_MAX_CALLS);
    if(aiConfigured()&&found.length&&explainLimit>0){
      aiStatus='complete';
      const rank={critical:0,high:1,medium:2,low:3,info:4};
      const selected=[...found].sort((a,b)=>rank[a.severity]-rank[b.severity]).slice(0,explainLimit);
      for(const finding of selected){
        try{
          let snippet=input.data.code.split(/\r?\n/).slice(Math.max(0,finding.line-11),finding.line+10).join('\n');
          snippet=/secret|password/i.test(`${finding.ruleId} ${finding.category} ${finding.message}`)?redactSecretLiterals(snippet):redactSensitiveLineLiterals(snippet);
          const [answer]=await timeout(aiService.explainFindings([{ruleId:finding.ruleId,severity:finding.severity,message:finding.message,filePath:finding.filePath,line:finding.line,snippet}]),remaining());
          if(answer){finding.explanation=answer.explanation;finding.suggestion=answer.suggestion;finding.aiGenerated=true;}else aiStatus='partial';
        }catch{aiStatus='partial';}
      }
      if(aiStatus==='partial')warnings.push('Some AI explanations were skipped or unavailable.');
    }
    if(!aiConfigured())warnings.push('AI explanations skipped because no provider key is configured.');
    else if(explainLimit===0)warnings.push('AI explanations skipped because the configured call limit is zero.');
    payload={findings:found,metrics:{files:metric?[{filePath:`snippet${extension[input.data.language]}`,nloc:metric.nloc,maxCcn:metric.maxCcn,avgCcn:metric.avgCcn,functionCount:metric.functionCount,maxParams:metric.maxParams}]:[],risk:summarizeRisk([risk.riskScore],counts)},aiStatus,warnings};
  }catch(error){failure=error;}
  finally{if(root){try{await removeTempDir(root);}catch(error){failure??=error;}}}
  if(failure){if(failure instanceof Error&&failure.message==='Quick scan timed out.')res.status(504).json({error:{code:'QUICK_SCAN_TIMEOUT',message:'Quick scan exceeded its time limit.'}});else next(failure);return;}
  if(payload)res.json(payload);
  else next(new Error('Quick scan produced no result.'));
}
