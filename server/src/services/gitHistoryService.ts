import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute,join,relative,sep } from 'node:path';
const execFileAsync=promisify(execFile);
export const BUG_FIX_SUBJECT=/\b(fix(e[sd])?|bug|patch|hotfix|defect)\b/i;
export interface CommitRecord {hash:string;author:string;timestamp:number;subject:string;files:string[]}
export interface FileHistory {commits90d:number;authors:number;bugFixCommits:number;lastModified:Date|null}
export interface HistoryResult {files:Map<string,FileHistory>;warnings:string[];commits:CommitRecord[]}
export function parseGitLog(raw:string,root:string):CommitRecord[]{
  const commits:CommitRecord[]=[];
  for(const chunk of raw.split('\x1e').filter(value=>value.trim())){
    const fields=chunk.split('\0');if(fields.length<4)continue;
    const hash=fields[0]?.trim()??'';const author=fields[1]?.trim()??'';const timestamp=Number(fields[2]?.trim());
    const remaining=fields.slice(3).join('\0').replace(/^\r?\n/,'');const lineBreak=remaining.search(/[\r\n]/);const subject=(lineBreak<0?remaining:remaining.slice(0,lineBreak)).trim();
    const fileText=lineBreak<0?'':remaining.slice(lineBreak).replace(/^[\r\n]+/,'');
    const changedFiles=fileText.split(/[\0\r\n]+/).map(file=>file.trim()).filter(Boolean).map(file=>isAbsolute(file)?relative(root,file).split(sep).join('/'):file.replace(/\\/g,'/').replace(/^\.\//,''));
    if(hash&&Number.isFinite(timestamp))commits.push({hash,author,timestamp,subject,files:[...new Set(changedFiles)]});
  }
  return commits;
}
export async function getGitHistory(root:string,options:{now?:number;timeoutMs?:number}={}):Promise<HistoryResult>{
  const {stdout}=await execFileAsync('git',['log','--format=%x1e%H%x00%an%x00%at%x00%s','-z','--name-only','--no-renames'],{cwd:root,timeout:options.timeoutMs??180_000,maxBuffer:50*1024*1024,windowsHide:true,encoding:'utf8'});
  const commits=parseGitLog(stdout,root);const cutoff=((options.now??Date.now())-90*24*60*60*1000)/1000;const perFile=new Map<string,FileHistory>();const authorsByFile=new Map<string,Set<string>>();
  for(const commit of commits){for(const filePath of commit.files){const row=perFile.get(filePath)??{commits90d:0,authors:0,bugFixCommits:0,lastModified:null};const commitDate=new Date(commit.timestamp*1000);if(commit.timestamp>=cutoff)row.commits90d++;if(BUG_FIX_SUBJECT.test(commit.subject))row.bugFixCommits++;const authors=authorsByFile.get(filePath)??new Set<string>();authors.add(commit.author);authorsByFile.set(filePath,authors);row.authors=authors.size;if(!row.lastModified||commitDate>row.lastModified)row.lastModified=commitDate;perFile.set(filePath,row);}}
  const warnings:string[]=[];try{await fs.access(join(root,'.git','shallow'));warnings.push('Git history is shallow and may be truncated.');}catch{/* No shallow marker means the clone has complete history. */}
  return{files:perFile,warnings,commits};
}
