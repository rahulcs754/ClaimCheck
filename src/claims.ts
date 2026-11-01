import { RULES } from './rules.js';
import type { Claim, Rule } from './types.js';

const NEGATION =
  /\b(no|not|never|without|cannot|can't|won't|didn't|don't|doesn't|haven't|hasn't|skip\w*|todo|later|will|follow[- ]?up|next pr|plan(ned)? to|need(s|ed)? to|should|could|would|tbd)\b|n't\b/i;

/**
 * Split a PR description into sentences worth checking. Drops code blocks,
 * HTML comments (PR template hints), quotes and unchecked checklist items.
 */
export function sentences(body: string): string[] {
  const clean = body
    .replace(/\r/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '');
  const out: string[] = [];
  for (const raw of clean.split('\n')) {
    let line = raw.trim();
    if (!line || line.startsWith('>') || line.startsWith('|')) continue;
    if (/^[-*+]\s+\[ \]/.test(line)) continue; // unchecked box: not a claim
    line = line.replace(/^([-*+]|\d+[.)])\s+(\[[xX]\]\s+)?/, '').replace(/^#+\s+/, '');
    line = line.replace(/\*\*|__/g, '');
    for (const s of line.split(/(?<=[.!?;])\s+/)) {
      const t = s.trim();
      if (t.length > 2) out.push(t);
    }
  }
  return out;
}

function matches(rule: Rule, sentence: string): boolean {
  for (const re of rule.claim) {
    const m = re.exec(sentence);
    if (!m) continue;
    if (!rule.negatable) return true;
    const before = sentence.slice(Math.max(0, m.index - 40), m.index);
    const inside = m[0];
    if (NEGATION.test(before) || /\b(no|not|n't)\b/i.test(inside)) continue;
    if (/\?\s*$/.test(sentence)) continue; // a question is not a claim
    return true;
  }
  return false;
}

/** One claim per rule: the first sentence that makes it. */
export function findClaims(body: string, rules: Rule[] = RULES): Claim[] {
  const claims: Claim[] = [];
  const list = sentences(body);
  for (const rule of rules) {
    const hit = list.find((s) => matches(rule, s));
    if (hit) claims.push({ rule: rule.id, text: hit });
  }
  return claims;
}
