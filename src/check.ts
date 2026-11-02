import { findClaims } from './claims.js';
import { RULES } from './rules.js';
import type { CheckResult, FileDiff, Rule } from './types.js';

export function checkClaims(body: string, files: FileDiff[], rules: Rule[] = RULES): CheckResult[] {
  return findClaims(body, rules).map((c) => {
    const rule = rules.find((r) => r.id === c.rule)!;
    const { verdict, evidence } = rule.check(files, c.text);
    return { rule: rule.id, label: rule.label, claim: c.text, verdict, evidence };
  });
}
