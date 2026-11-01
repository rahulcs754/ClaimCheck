import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkClaims } from '../src/check.js';
import { parseDiff } from '../src/diff.js';
import { renderMarkdown, summary } from '../src/markdown.js';
import { file } from './helpers.js';

describe('demo PR', () => {
  const body = readFileSync('examples/demo/pr-body.md', 'utf8');
  const results = checkClaims(body, parseDiff(readFileSync('examples/demo/pr.diff', 'utf8')));

  it('catches the false claims', () => {
    expect(Object.fromEntries(results.map((r) => [r.rule, r.verdict]))).toEqual({
      tests: 'unsupported',
      'no-breaking': 'unsupported',
      'error-handling': 'unsupported',
      docs: 'supported',
      'no-new-deps': 'unsupported',
      'no-console': 'unsupported',
    });
    expect(summary(results)).toEqual({ bad: 5, unclear: 0, good: 1 });
  });

  it('renders a stable comment', () => {
    expect(renderMarkdown(results)).toMatchSnapshot();
  });
});

describe('renderMarkdown', () => {
  it('says so when nothing is checkable', () => {
    expect(renderMarkdown([])).toContain('no checkable claims');
  });
  it('says all good when every claim matches', () => {
    const r = checkClaims('Added tests.', [file('a.test.ts', ['it()'])]);
    expect(renderMarkdown(r)).toContain('✅ ClaimCheck: the claim in the PR description matches the diff');
  });
  it('escapes pipes in table cells', () => {
    const r = checkClaims('Added tests for a | b.', []);
    expect(renderMarkdown(r)).toContain('a \\| b');
  });
});
