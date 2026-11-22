import {act,fireEvent,render,renderHook,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import type {ReactNode} from 'react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {toast} from 'sonner';
import {getFindings,getScan,quickScan} from './api';
import {QuickScanPage,ScanPage} from './pages';
import {useScan} from './hooks';

vi.mock('./api',()=>({getScan:vi.fn(),getFindings:vi.fn(),getFileRisks:vi.fn().mockResolvedValue({items:[],totalPages:0}),getProjectScans:vi.fn(),getFileContent:vi.fn(),quickScan:vi.fn()}));
vi.mock('sonner',()=>({toast:{error:vi.fn(),success:vi.fn()}}));
vi.mock('@monaco-editor/react',()=>({default:({value,onChange}:{value:string;onChange:(value:string)=>void})=><textarea aria-label="Code editor" value={value} onChange={event=>onChange(event.target.value)}/> }));
function wrapper(path:string,element:ReactNode){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/scans/:id" element={element}/><Route path="/quick-scan" element={element}/></Routes></MemoryRouter></QueryClientProvider>);}
const finding=(source:'semgrep'|'llm',line:number)=>({_id:String(line),filePath:'src/app.ts',line,ruleId:'rule',ruleIds:['rule'],source,severity:'high' as const,category:'bug',message:`Finding ${line}`,riskScore:12,explanation:'Explanation text',suggestion:'Suggestion text'});
beforeEach(()=>{vi.clearAllMocks();});

describe('scan pages',()=>{
  it('polls while running and stops once a scan is done',async()=>{
    vi.mocked(getScan).mockResolvedValueOnce({scanId:'scan-123456',status:'running',stage:'analyzing',summary:{riskScore:0,counts:{critical:0,high:0,medium:0,low:0,info:0}},warnings:[],aiStatus:'skipped'}).mockResolvedValue({scanId:'scan-123456',status:'done',stage:null,summary:{riskScore:0,counts:{critical:0,high:0,medium:0,low:0,info:0}},warnings:[],aiStatus:'skipped'});
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const {result}=renderHook(()=>useScan('scan-123456'),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
    await waitFor(()=>expect(result.current.data?.status).toBe('running'));
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,2600));});
    await waitFor(()=>expect(result.current.data?.status).toBe('done'));
    const calls=vi.mocked(getScan).mock.calls.length;
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,2700));});
    expect(vi.mocked(getScan).mock.calls).toHaveLength(calls);
  },15000);
  it('stops polling after a scan fails',async()=>{
    vi.mocked(getScan).mockResolvedValue({scanId:'scan-failed',status:'failed',stage:null,summary:{riskScore:0,counts:{critical:0,high:0,medium:0,low:0,info:0}},warnings:[],error:'failed',aiStatus:'skipped'});
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const {result}=renderHook(()=>useScan('scan-failed'),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
    await waitFor(()=>expect(result.current.data?.status).toBe('failed'));
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,2600));});
    expect(getScan).toHaveBeenCalledTimes(1);
  },10000);
  it('shows the LLM verification badge only for LLM findings',async()=>{
    vi.mocked(getScan).mockResolvedValue({scanId:'scan-123456',status:'done',stage:null,summary:{riskScore:12,counts:{critical:0,high:2,medium:0,low:0,info:0}},warnings:[],aiStatus:'complete'});
    vi.mocked(getFindings).mockResolvedValue({items:[finding('semgrep',1),finding('llm',2)],page:1,limit:20,total:2,totalPages:1});
    wrapper('/scans/scan-123456',<ScanPage/>);
    expect(await screen.findByText('AI-suggested, unverified')).toBeInTheDocument();
    expect(screen.getAllByText(/AI-suggested, unverified/)).toHaveLength(1);
    expect(screen.getByText('Finding 1')).toBeInTheDocument();expect(screen.getByText('Finding 2')).toBeInTheDocument();
  });
  it('requests filtered findings when severity changes',async()=>{
    vi.mocked(getScan).mockResolvedValue({scanId:'scan-123456',status:'done',stage:null,summary:{riskScore:0,counts:{critical:0,high:0,medium:0,low:0,info:0}},warnings:[],aiStatus:'skipped'});
    vi.mocked(getFindings).mockResolvedValue({items:[],page:1,limit:20,total:0,totalPages:0});
    wrapper('/scans/scan-123456',<ScanPage/>);
    fireEvent.change(await screen.findByLabelText('Severity filter'),{target:{value:'high'}});
    await waitFor(()=>expect(getFindings).toHaveBeenLastCalledWith('scan-123456',expect.stringContaining('severity=high')));
  });
  it.each([[413,'Snippet is larger than 20 KB.'],[429,'Quick scan rate limit reached.'],[500,'Quick scan service is unavailable.']])('shows a toast for quick-scan HTTP %s',async(status,message)=>{
    vi.mocked(quickScan).mockRejectedValue({response:{status}});
    wrapper('/quick-scan',<QuickScanPage/>);
    fireEvent.click(await screen.findByRole('button',{name:'Analyze snippet'}));
    await waitFor(()=>expect(toast.error).toHaveBeenCalledWith(message));
  });
});
