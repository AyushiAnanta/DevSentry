export const RISK_FACTORS={complexity:{weight:0.25,saturation:30},churn:{weight:0.20,saturation:20},bugFix:{weight:0.20,saturation:5},staticFindings:{weight:0.15,saturation:20},authors:{weight:0.10,saturation:8},size:{weight:0.10,saturation:1000}} as const;
export interface SeverityCounts {critical:number;high:number;medium:number;low:number;info:number}
export interface RiskInput {nloc:number;maxCcn:number;commits90d:number;bugFixCommits:number;authors:number;findingCounts:SeverityCounts}
export interface RiskFactorResult {name:keyof typeof RISK_FACTORS;raw:number;normalized:number;weight:number;contribution:number}
export interface RiskResult {riskScore:number;factors:RiskFactorResult[]}
export interface ScanRiskSummary {riskScore:number;counts:SeverityCounts}
const findingWeights:Record<keyof SeverityCounts,number>={critical:8,high:4,medium:2,low:1,info:0};
const clamp=(value:number)=>Math.max(0,value);
const normalize=(raw:number,saturation:number)=>Math.min(1,clamp(raw)/saturation);
export function scoreFile(input:RiskInput):RiskResult{
  const raw={complexity:input.maxCcn,churn:input.commits90d,bugFix:input.bugFixCommits,staticFindings:Object.entries(input.findingCounts).reduce((sum,[severity,count])=>sum+count*findingWeights[severity as keyof SeverityCounts],0),authors:input.authors,size:input.nloc};
  const factors=(Object.keys(RISK_FACTORS) as (keyof typeof RISK_FACTORS)[]).map(name=>{const config=RISK_FACTORS[name];const normalized=normalize(raw[name],config.saturation);return{name,raw:raw[name],normalized,weight:config.weight,contribution:100*normalized*config.weight};});
  return{riskScore:Math.round(factors.reduce((sum,factor)=>sum+factor.contribution,0)*100)/100,factors};
}
export function summarizeRisk(fileScores:number[],findings:SeverityCounts):ScanRiskSummary{
  const top=fileScores.slice().sort((a,b)=>b-a).slice(0,5);const mean=top.length?top.reduce((sum,value)=>sum+value,0)/top.length:0;
  return{riskScore:Math.round(mean*100)/100,counts:{...findings}};
}
