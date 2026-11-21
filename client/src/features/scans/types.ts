export type SeverityCount={critical:number;high:number;medium:number;low:number;info:number};
export type ScanSummary={riskScore:number;counts:SeverityCount};
export type ScanStatus='queued'|'running'|'done'|'failed';
