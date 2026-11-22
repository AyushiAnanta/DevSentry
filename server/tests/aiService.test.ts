import { env } from '../src/config/env';
import { aiService,redactSecretLiterals,redactSensitiveLineLiterals,withAICallBudget } from '../src/services/ai/aiService';
import { reviewPrompt } from '../src/services/ai/prompts';

const original={provider:env.AI_PROVIDER,key:env.GEMINI_API_KEY,model:env.AI_MODEL_GEMINI};
const output={explanation:'The value is used unsafely.',suggestion:'Use a parameterized query.'};
function success(text:string):Response{return new Response(JSON.stringify({candidates:[{content:{parts:[{text}]}}]}),{status:200,headers:{'content-type':'application/json'}});}
beforeEach(()=>{env.AI_PROVIDER='gemini';env.GEMINI_API_KEY='unit-test-key';env.AI_MODEL_GEMINI='test-model';});
afterEach(()=>{env.AI_PROVIDER=original.provider;env.GEMINI_API_KEY=original.key;env.AI_MODEL_GEMINI=original.model;jest.restoreAllMocks();});

describe('AI provider',()=>{
  test('numbers source lines in logic-review prompts',()=>{
    const prompt=reviewPrompt({filePath:'average.ts',content:'function average(values: number[]) {\n  return values.length - 1;\n}'});
    expect(prompt).toContain('copy the prefix value into each finding\'s line field');
    expect(prompt).toContain('1: function average');
    expect(prompt).toContain('2:   return values.length - 1;');
  });
  test('requests structured JSON and returns schema-validated output',async()=>{
    const fetch=jest.spyOn(global,'fetch').mockResolvedValue(success(JSON.stringify(output)));
    const secret='UnitTestSecretLiteral42';
    const snippet=redactSensitiveLineLiterals(`const password = "${secret}";`);
    const [result]=await aiService.explainFindings([{ruleId:'devsentry.hardcoded-secret',severity:'critical',message:'Hardcoded password',filePath:'src/auth.ts',line:4,snippet}]);
    expect(result).toEqual(output);
    const sent=JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {generationConfig:{responseMimeType:string};contents:Array<{parts:Array<{text:string}>}>};
    expect(sent.generationConfig.responseMimeType).toBe('application/json');
    expect(sent.contents[0]?.parts[0]?.text).not.toContain(secret);
    expect(redactSecretLiterals(`const password = '${secret}'`)).not.toContain(secret);
  });
  test('retries invalid JSON once, then skips invalid output',async()=>{
    const fetch=jest.spyOn(global,'fetch').mockResolvedValueOnce(success('{')).mockResolvedValueOnce(success('{"explanation":"ok","suggestion":"fix"}')).mockResolvedValueOnce(success('{}')).mockResolvedValueOnce(success('{}'));
    const [valid]=await aiService.explainFindings([{ruleId:'r',severity:'low',message:'m',filePath:'a.ts',line:1,snippet:'code'}]);
    const [invalid]=await aiService.explainFindings([{ruleId:'r',severity:'low',message:'m',filePath:'a.ts',line:1,snippet:'code'}]);
    expect(valid).toEqual({explanation:'ok',suggestion:'fix'});expect(invalid).toBeNull();expect(fetch).toHaveBeenCalledTimes(4);
  });
  test('backs off and retries HTTP 429',async()=>{
    const fetch=jest.spyOn(global,'fetch').mockResolvedValueOnce(new Response('',{status:429})).mockResolvedValueOnce(success(JSON.stringify(output)));
    const [result]=await aiService.explainFindings([{ruleId:'r',severity:'low',message:'m',filePath:'a.ts',line:1,snippet:'code'}]);
    expect(result).toEqual(output);expect(fetch).toHaveBeenCalledTimes(2);
  });
  test('never exceeds the total outbound-call budget while retrying',async()=>{
    const fetch=jest.spyOn(global,'fetch').mockResolvedValue(new Response('',{status:429}));
    await expect(withAICallBudget(1,()=>aiService.explainFindings([{ruleId:'r',severity:'low',message:'m',filePath:'a.ts',line:1,snippet:'code'}]))).rejects.toThrow('AI call limit reached');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
