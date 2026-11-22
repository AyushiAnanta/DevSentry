import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, sep } from 'node:path';
import { simpleGit } from 'simple-git';
import { env } from '../config/env';
import { logger } from '../config/logger';

const ignoredDirectories=new Set(['.git','node_modules','dist','build','vendor']);
const sourceExtensions=new Set(['.js','.jsx','.ts','.tsx','.py','.java']);
export interface ParsedGithubUrl {owner:string;repo:string;cloneUrl:string}
export interface SourceFile {absolutePath:string;filePath:string;language:'javascript'|'typescript'|'python'|'java'}
export interface RepoWarningSink {warnings:string[]}
export type CloneImplementation=(cloneUrl:string,destination:string,timeoutMs:number)=>Promise<void>;
export const cloneWithSimpleGit:CloneImplementation=async(cloneUrl,destination,timeoutMs)=>{
  const git=simpleGit({baseDir:destination,timeout:{block:timeoutMs},allowConfig:['core.hooksPath'],allowEnvironment:['GIT_TERMINAL_PROMPT','GIT_LFS_SKIP_SMUDGE']}).env({GIT_TERMINAL_PROMPT:'0',GIT_LFS_SKIP_SMUDGE:'1'});
  await git.raw(['-c','core.hooksPath=NUL','clone','--depth',String(env.CLONE_DEPTH),'--single-branch','--no-tags','--no-recurse-submodules',cloneUrl,'.']);
};

export function parseGithubUrl(input:string):ParsedGithubUrl {
  let url:URL;
  try{url=new URL(input);}catch{throw new Error('Invalid GitHub repository URL');}
  const authority=/^https:\/\/([^/?#]*)/i.exec(input)?.[1]??'';
  if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||authority.includes(':')||url.port||url.search||url.hash)throw new Error('URL must be an HTTPS GitHub repository URL without credentials, port, query, or fragment');
  const match=/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(url.pathname);
  if(!match)throw new Error('GitHub URL must contain exactly an owner and repository');
  const owner=match[1];const repo=match[2];
  if(!owner||!repo||owner==='.'||owner==='..'||repo==='.'||repo==='..')throw new Error('Invalid GitHub owner or repository');
  return{owner,repo,cloneUrl:`https://github.com/${owner}/${repo}.git`};
}

export async function checkGithubSize(repo:ParsedGithubUrl,warnings:RepoWarningSink,fetcher:typeof fetch=fetch):Promise<void>{
  const headers:Record<string,string>={'Accept':'application/vnd.github+json','User-Agent':'DevSentry'};
  if(env.GITHUB_API_TOKEN)headers.Authorization=`Bearer ${env.GITHUB_API_TOKEN}`;
  try{
    const response=await fetcher(`https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`,{headers,signal:AbortSignal.timeout(Math.min(env.SCAN_TIMEOUT_MS,10_000))});
    if(!response.ok){warnings.warnings.push(`GitHub size pre-check unavailable (HTTP ${response.status}); enforcing the limit after clone.`);return;}
    const body=await response.json() as {size?:unknown};
    if(typeof body.size==='number'&&body.size>env.MAX_REPO_SIZE_MB*1024)throw new Error(`Repository exceeds the ${env.MAX_REPO_SIZE_MB} MB size limit`);
  }catch(error){if(error instanceof Error&&error.message.startsWith('Repository exceeds'))throw error;warnings.warnings.push('GitHub size pre-check unavailable; enforcing the limit after clone.');}
}

export async function cloneRepo(repo:ParsedGithubUrl,cloneImpl:CloneImplementation=cloneWithSimpleGit,timeoutMs=env.SCAN_TIMEOUT_MS,onDestination?:(destination:string)=>void):Promise<string>{
  const destination=await fs.mkdtemp(join(tmpdir(),'devsentry-'));
  onDestination?.(destination);
  try{
    await cloneImpl(repo.cloneUrl,destination,timeoutMs);
    return destination;
  }catch(error){await removeTempDir(destination);throw error;}
}

export async function removeTempDir(directory: string): Promise<void> {
  try {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  } catch (error) {
    // On Windows a freshly cloned or Docker-mounted folder can stay locked (EBUSY).
    // A leftover temp folder must not turn a finished scan into a failed one.
    logger.warn({ dir: basename(directory), msg: error instanceof Error ? error.message : String(error) }, 'temp-dir cleanup skipped');
  }
}

/** Remove stale "devsentry-*" directories in os.tmpdir() older than 1 hour.
 *  Best-effort: never throws, logs how many were removed. */
export async function sweepStaleTempDirs(olderThanMs = 60 * 60 * 1000): Promise<void> {
  try {
    const tmp = tmpdir();
    const entries = await fs.readdir(tmp, { withFileTypes: true });
    const now = Date.now();
    let removed = 0;
    const deadline = Date.now() + 4000; // budget: 4 s max

    for (const entry of entries) {
      if (Date.now() > deadline) break;
      if (!entry.isDirectory() || !entry.name.startsWith('devsentry-')) continue;
      try {
        const stat = await fs.stat(join(tmp, entry.name));
        if (now - stat.mtimeMs < olderThanMs) continue;
        await fs.rm(join(tmp, entry.name), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        removed++;
      } catch {
        // ignore individual failures
      }
    }

    if (removed > 0) {
      logger.info({ removed }, 'swept stale devsentry temp directories');
    }
  } catch {
    // best-effort: never throw
  }
}

export async function withClonedRepo<T>(repo:ParsedGithubUrl,work:(directory:string)=>Promise<T>,cloneImpl?:CloneImplementation,timeoutMs=env.SCAN_TIMEOUT_MS):Promise<T>{
  const directory=await cloneRepo(repo,cloneImpl,timeoutMs);
  try{return await work(directory);}finally{await removeTempDir(directory);}
}

export async function listSourceFiles(root:string,warnings:RepoWarningSink,options:{maxFiles?:number;maxFileKb?:number}={}):Promise<SourceFile[]>{
  const maxFiles=options.maxFiles??env.MAX_FILES;const maxBytes=(options.maxFileKb??env.MAX_FILE_KB)*1024;const files:SourceFile[]=[];let truncated=false;
  async function visit(directory:string):Promise<void>{
    if(truncated)return;
    const entries=await fs.readdir(directory,{withFileTypes:true});entries.sort((a,b)=>a.name.localeCompare(b.name));
    for(const entry of entries){
      if(entry.isSymbolicLink())continue;
      const absolutePath=join(directory,entry.name);
      if(entry.isDirectory()){if(!ignoredDirectories.has(entry.name))await visit(absolutePath);continue;}
      if(!entry.isFile()||basename(entry.name).endsWith('.min.js'))continue;
      const extension=extname(entry.name).toLowerCase();if(!sourceExtensions.has(extension))continue;
      const stat=await fs.stat(absolutePath);if(stat.size>maxBytes)continue;
      files.push({absolutePath,filePath:relative(root,absolutePath).split(sep).join('/'),language:extension==='.py'?'python':extension==='.java'?'java':extension==='.ts'||extension==='.tsx'?'typescript':'javascript'});
      if(files.length>maxFiles){files.pop();truncated=true;warnings.warnings.push(`Source file limit reached (${maxFiles}); remaining files were skipped.`);return;}
    }
  }
  await visit(root);
  return files;
}
