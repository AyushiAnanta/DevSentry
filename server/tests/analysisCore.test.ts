import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {checkGithubSize,cloneRepo,listSourceFiles,parseGithubUrl,removeTempDir,withClonedRepo} from '../src/services/repoService';
import {parseLizardCsv,parseLizardXmlFiles,aggregateLizardMetrics} from '../src/services/metricsService';
import {BUG_FIX_SUBJECT,getGitHistory} from '../src/services/gitHistoryService';
import {scoreFile,summarizeRisk} from '../src/services/riskScoringService';
import {categoryForRule,mapSemgrepSeverity} from '../src/services/severityMap';
import {parseSemgrepJson} from '../src/services/semgrepService';
const execFileAsync=promisify(execFile);

describe('analysis core',()=>{
  test('parses a strict GitHub URL and rebuilds its clone URL',()=>{
    expect(parseGithubUrl('https://github.com/acme/api').cloneUrl).toBe('https://github.com/acme/api.git');
    expect(parseGithubUrl('https://github.com/acme/api.git').repo).toBe('api');
  });
  test.each(['http://github.com/a/b','https://github.com.evil.com/a/b','https://user:pass@github.com/a/b','https://github.com:443/a/b','https://github.com/a/b/extra','https://github.com/a/b?x=1','https://github.com/a/b#x','https://github.com@evil.com/a/b'])('rejects unsafe or malformed repo URL %s',url=>{expect(()=>parseGithubUrl(url)).toThrow();});
  test('filters source files, ignored directories, minified files, and oversized files',async()=>{
    const root=await fs.mkdtemp(join(tmpdir(),'devsentry-files-'));const warnings:string[]=[];
    try{await fs.mkdir(join(root,'node_modules'),{recursive:true});await fs.mkdir(join(root,'vendor'),{recursive:true});await fs.writeFile(join(root,'main.ts'),'const x = 1;');await fs.writeFile(join(root,'skip.min.js'),'minified');await fs.writeFile(join(root,'node_modules','hidden.js'),'ignored');await fs.writeFile(join(root,'large.py'),'x'.repeat(40));await fs.writeFile(join(root,'notes.md'),'docs');const files=await listSourceFiles(root,{warnings},{maxFileKb:0.02,maxFiles:10});expect(files.map(file=>file.filePath)).toEqual(['main.ts']);expect(files[0]?.language).toBe('typescript');expect(warnings).toEqual([]);}finally{await removeTempDir(root);}
  });
  test('caps listed files and reports truncation',async()=>{
    const root=await fs.mkdtemp(join(tmpdir(),'devsentry-cap-'));const warnings:string[]=[];
    try{await fs.writeFile(join(root,'a.ts'),'a');await fs.writeFile(join(root,'b.js'),'b');const files=await listSourceFiles(root,{warnings},{maxFiles:1});expect(files).toHaveLength(1);expect(warnings).toEqual(['Source file limit reached (1); remaining files were skipped.']);}finally{await removeTempDir(root);}
  });
  test('uses an injected local repository copier and always removes its temp directory after success',async()=>{
    const source=await fs.mkdtemp(join(tmpdir(),'devsentry-local-git-'));const warnings:string[]=[];let destination='';
    try{await execFileAsync('git',['init'],{cwd:source,windowsHide:true});await execFileAsync('git',['config','user.name','Fixture'],{cwd:source});await execFileAsync('git',['config','user.email','fixture@example.test'],{cwd:source});await fs.writeFile(join(source,'main.ts'),'export const x = 1;');await execFileAsync('git',['add','main.ts'],{cwd:source});await execFileAsync('git',['commit','-m','fixture'],{cwd:source});const result=await withClonedRepo({owner:'fixture',repo:'local',cloneUrl:source},async(directory)=>{destination=directory;return fs.readFile(join(directory,'main.ts'),'utf8');},async(_url,target)=>{await fs.cp(source,target,{recursive:true});});expect(result).toContain('x = 1');await expect(fs.access(destination)).rejects.toThrow();expect(warnings).toEqual([]);}finally{await removeTempDir(source);if(destination)await removeTempDir(destination);}
  });
  test('removes the temp directory after clone and callback failures',async()=>{
    let failedCloneDir='';await expect(cloneRepo({owner:'x',repo:'y',cloneUrl:'unused'},async(_url,destination)=>{failedCloneDir=destination;throw new Error('private path');})).rejects.toThrow('private path');await expect(fs.access(failedCloneDir)).rejects.toThrow();
    let failedWorkDir='';await expect(withClonedRepo({owner:'x',repo:'y',cloneUrl:'unused'},async(directory)=>{failedWorkDir=directory;throw new Error('pipeline failed');},async(_url,destination)=>{await fs.writeFile(join(destination,'temporary.txt'),'x');})).rejects.toThrow('pipeline failed');await expect(fs.access(failedWorkDir)).rejects.toThrow();
  });
  test('enforces repository size pre-check and warns when GitHub cannot check size',async()=>{
    const warnings:string[]=[];const repo=parseGithubUrl('https://github.com/acme/api');await expect(checkGithubSize(repo,{warnings},async()=>({ok:true,status:200,json:async()=>({size:102_401})} as Response))).rejects.toThrow('exceeds');
    const unavailable:string[]=[];await checkGithubSize(repo,{warnings:unavailable},async()=>({ok:false,status:403,json:async()=>({})} as Response));expect(unavailable).toHaveLength(1);
  });
  test('parses the saved real Lizard CSV and XML formats',async()=>{
    const root=resolve(__dirname,'../..');const csv=await fs.readFile(join(root,'server/tests/fixtures/raw/lizard.buggy.csv'),'utf8');const xml=await fs.readFile(join(root,'server/tests/fixtures/raw/lizard.buggy.xml'),'utf8');const functions=parseLizardCsv(csv,root);const nloc=parseLizardXmlFiles(xml,root);const metrics=aggregateLizardMetrics(functions,nloc);expect(functions[0]).toMatchObject({filePath:'server/tests/fixtures/buggy.ts',name:'loadUser',nloc:6,ccn:2,parameterCount:2,startLine:3,endLine:8});expect(nloc.get('server/tests/fixtures/buggy.ts')).toBe(20);expect(metrics[0]).toMatchObject({nloc:20,maxCcn:2,functionCount:6,maxParams:2});
  });
  test('maps Semgrep severities and critical rule IDs through the explicit table',()=>{
    expect(mapSemgrepSeverity('ERROR','some.rule')).toBe('high');expect(mapSemgrepSeverity('WARNING','some.rule')).toBe('medium');expect(mapSemgrepSeverity('INFO','some.rule')).toBe('low');expect(mapSemgrepSeverity('ERROR','devsentry.command-string-concat')).toBe('critical');expect(categoryForRule('devsentry.empty-catch')).toBe('smell');expect(categoryForRule('devsentry.loose-equality')).toBe('style');
  });
  test('parses saved real Semgrep JSON, dedupes by file and line, and strips mount paths',async()=>{
    const root=resolve(__dirname,'..');const raw=await fs.readFile(join(root,'tests/fixtures/raw/semgrep.buggy.json'),'utf8');const findings=parseSemgrepJson(raw,root);
    const duplicate=findings.find(finding=>finding.filePath==='tests/fixtures/buggy.py'&&finding.line===14);
    expect(duplicate?.ruleIds).toContain('python.lang.security.audit.eval-detected.eval-detected');expect(duplicate?.ruleIds).toContain('devsentry.dynamic-eval-python');expect(duplicate?.severity).toBe('critical');
    expect(findings.every(finding=>!finding.filePath.includes('/src/')&&!finding.filePath.toLowerCase().includes('temp')&&!finding.filePath.includes('\\'))).toBe(true);
    const mounted=JSON.stringify({results:[{check_id:'devsentry.test',path:'/src/tests/fixtures/a.ts',start:{line:2},end:{line:2},extra:{severity:'WARNING',message:'example'}},{check_id:'devsentry.test',path:'/tmp/devsentry-unsafe/a.ts',start:{line:3},end:{line:3},extra:{severity:'ERROR',message:'unsafe'}}]});
    expect(parseSemgrepJson(mounted,root)).toMatchObject([{filePath:'tests/fixtures/a.ts',line:2,ruleIds:['devsentry.test']}]);
  });
  test('recognizes bug-fix subjects without matching substrings',()=>{
    expect(BUG_FIX_SUBJECT.test('fix: null check')).toBe(true);expect(BUG_FIX_SUBJECT.test('hotfix session handling')).toBe(true);expect(BUG_FIX_SUBJECT.test('prefix update')).toBe(false);expect(BUG_FIX_SUBJECT.test('debugging output')).toBe(false);
  });
  test('reads commit history once and aggregates dates, authors, and bug-fix commits per file',async()=>{
    const root=await fs.mkdtemp(join(tmpdir(),'devsentry-history-'));const dateA='2026-11-19T12:00:00Z';const dateB='2026-11-20T12:00:00Z';
    async function git(args:string[],author:string,date:string):Promise<void>{await execFileAsync('git',args,{cwd:root,windowsHide:true,env:{...process.env,GIT_AUTHOR_NAME:author,GIT_COMMITTER_NAME:author,GIT_AUTHOR_EMAIL:`${author}@example.test`,GIT_COMMITTER_EMAIL:`${author}@example.test`,GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date}});}
    try{await git(['init'], 'First',dateA);await fs.writeFile(join(root,'a.ts'),'const a = 1;');await git(['add','a.ts'],'First',dateA);await git(['commit','-m','initial feature'],'First',dateA);await fs.writeFile(join(root,'a.ts'),'const a = 2;');await git(['add','a.ts'],'Second',dateB);await git(['commit','-m','fix: null check'],'Second',dateB);const result=await getGitHistory(root,{now:Date.parse('2026-11-21T00:00:00Z')});expect(result.commits).toHaveLength(2);expect(result.files.get('a.ts')).toMatchObject({commits90d:2,authors:2,bugFixCommits:1,lastModified:new Date(dateB)});expect(result.warnings).toEqual([]);}finally{await removeTempDir(root);}
  });
  test('computes the score using hand-calculated weighted contributions and top-five mean',()=>{
    const result=scoreFile({nloc:500,maxCcn:15,commits90d:10,bugFixCommits:2,authors:4,findingCounts:{critical:1,high:0,medium:2,low:2,info:7}});
    // Hand calculation: complexity 12.5 + churn 10 + bug-fix 8 + findings 10.5 + authors 5 + size 5 = 51 points.
    expect(result.riskScore).toBe(51);
    expect(result.factors.map(factor=>factor.contribution)).toEqual([12.5,10,8,10.5,5,5]);
    expect(summarizeRisk([10,100,20,30,40,90],{critical:1,high:0,medium:0,low:0,info:0}).riskScore).toBe(56);
  });
});
