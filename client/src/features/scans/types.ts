export type SeverityCount={critical:number;high:number;medium:number;low:number;info:number};
export type ScanSummary={riskScore:number;counts:SeverityCount};
export type ScanStatus='queued'|'running'|'done'|'failed';
export type Scan={scanId:string;status:ScanStatus;stage:string|null;summary:ScanSummary;warnings:string[];error?:string;aiStatus:'skipped'|'partial'|'complete'};
export type Finding={_id:string;filePath:string;line:number;ruleId:string;ruleIds:string[];source:'semgrep'|'lizard'|'llm';severity:'critical'|'high'|'medium'|'low'|'info';category:string;message:string;explanation?:string;suggestion?:string;snippet?:string;riskScore:number};
export type FileRisk={filePath:string;language:string;riskScore:number;factors:Array<{name:string;raw:number;normalized:number;weight:number;contribution:number}>;metrics:Record<string,unknown>};
