export const SEMGREP_SEVERITY_MAP={
  severity:{ERROR:'high',WARNING:'medium',INFO:'low'},
  criticalRuleIds:new Set<string>([
    'devsentry.sql-string-concat',
    'devsentry.command-string-concat','devsentry.command-string-concat-python','devsentry.command-string-concat-java',
    'devsentry.dynamic-eval','devsentry.dynamic-eval-python',
    'devsentry.hardcoded-secret','devsentry.hardcoded-secret-python','devsentry.hardcoded-secret-java',
  ]),
} as const;
export type SemgrepSeverity=keyof typeof SEMGREP_SEVERITY_MAP.severity;
export type FindingSeverity='critical'|'high'|'medium'|'low';
export function mapSemgrepSeverity(severity:string,ruleId:string):FindingSeverity{if(SEMGREP_SEVERITY_MAP.criticalRuleIds.has(ruleId)||[...SEMGREP_SEVERITY_MAP.criticalRuleIds].some(id=>ruleId.endsWith(`.${id}`)))return'critical';return SEMGREP_SEVERITY_MAP.severity[severity as SemgrepSeverity]??'low';}
export function categoryForRule(ruleId:string):'security'|'bug'|'smell'|'style'{if(/sql-string-concat|command-string-concat|dynamic-eval|hardcoded-secret/.test(ruleId))return'security';if(ruleId.includes('empty-catch'))return'smell';if(ruleId.includes('loose-equality')||ruleId.includes('java-string-reference-equality'))return'style';return'bug';}
