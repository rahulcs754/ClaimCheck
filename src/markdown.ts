import type { CheckResult } from './types.js';

export const MARKER = '<!-- claimcheck -->';

const ICON = { supported: '✅', unsupported: '❌', unclear: '⚠️' } as const;

function cell(s: string, max = 140): string {
  const t = s.length > max ? `${s.slice(0, max - 1)}…` : s;
  return t.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function summary(results: CheckResult[]): { bad: number; unclear: number; good: number } {
  return {
    bad: results.filter((r) => r.verdict === 'unsupported').length,
    unclear: results.filter((r) => r.verdict === 'unclear').length,
    good: results.filter((r) => r.verdict === 'supported').length,
  };
}

export function renderMarkdown(results: CheckResult[]): string {
  const { bad, unclear, good } = summary(results);
  const total = results.length;
  let title: string;
  if (total === 0) title = 'ℹ️ ClaimCheck: no checkable claims in the PR description';
  else if (bad) title = `❌ ClaimCheck: ${bad} of ${total} claim${total > 1 ? 's' : ''} in the PR description ${bad > 1 ? "don't" : "doesn't"} match the diff`;
  else if (unclear) title = `⚠️ ClaimCheck: ${unclear} of ${total} claim${total > 1 ? 's' : ''} need${unclear > 1 ? '' : 's'} a closer look`;
  else title = total === 1 ? '✅ ClaimCheck: the claim in the PR description matches the diff' : `✅ ClaimCheck: all ${total} claims match the diff`;

  const lines = [MARKER, `### ${title}`, ''];
  if (total) {
    const order = { unsupported: 0, unclear: 1, supported: 2 };
    const sorted = [...results].sort((a, b) => order[a.verdict] - order[b.verdict]);
    lines.push('| | Claim | PR says | What the diff shows |', '|---|---|---|---|');
    for (const r of sorted) lines.push(`| ${ICON[r.verdict]} | ${r.label} | "${cell(r.claim)}" | ${cell(r.evidence, 220)} |`);
    lines.push('');
    if (bad) lines.push('Fix the code or edit the description so a reviewer can trust it.', '');
  } else {
    lines.push('ClaimCheck looks for claims like "added tests", "no breaking changes" or "handled errors".', '');
  }
  lines.push(`<sub>${good} supported · ${bad} not supported · ${unclear} unclear · [ClaimCheck](https://github.com/rahulcs754/claimcheck)</sub>`);
  return lines.join('\n');
}
