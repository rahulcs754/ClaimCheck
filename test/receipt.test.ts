import { describe, expect, it } from 'vitest';
import { checkClaims } from '../src/check.js';
import { renderReceipt, stepKind, summarizeReceipt, type CiJob } from '../src/receipt.js';
import { file } from './helpers.js';

const step = (name: string, conclusion: string | null = 'success', status = 'completed') => ({ name, status, conclusion });

const ci: CiJob = {
  name: 'CI / test',
  status: 'completed',
  conclusion: 'success',
  steps: [
    step('Set up job'),
    step('Run actions/checkout@v4'),
    step('Run npm ci'),
    step('Run npm run typecheck'),
    step('Run npm test'),
    step('Run npm run build'),
    step('Complete job'),
  ],
};

describe('stepKind', () => {
  it('classifies common CI steps', () => {
    expect(stepKind('Run npm test')).toBe('test');
    expect(stepKind('Run pytest -q')).toBe('test');
    expect(stepKind('Run npm run typecheck')).toBe('typecheck');
    expect(stepKind('Run npx eslint .')).toBe('lint');
    expect(stepKind('Run npm run build')).toBe('build');
  });
  it('ignores setup steps', () => {
    expect(stepKind('Run actions/setup-node@v4')).toBeUndefined();
    expect(stepKind('Run npm ci')).toBeUndefined();
    expect(stepKind('Post Run actions/checkout@v4')).toBeUndefined();
  });
});

describe('summarizeReceipt', () => {
  it('lists what ran and finds nothing missing on a clean PR', () => {
    const files = [file('src/a.ts', ['x']), file('src/a.test.ts', ['it()'])];
    const s = summarizeReceipt({ sha: 'abcdef1234', jobs: [ci] }, files, checkClaims('Added tests.', files));
    expect(s.ran.map((r) => `${r.kind}:${r.result}`)).toEqual(['typecheck:passed', 'test:passed', 'build:passed']);
    expect(s.notVerified).toEqual([]);
    expect(renderReceipt(s)).toContain('**Not verified:** nothing');
  });

  it('says what was not verified', () => {
    const files = [file('src/pay.ts', ['charge()'])];
    const jobs: CiJob[] = [
      { name: 'CI / build', status: 'completed', conclusion: 'success', steps: [step('Run npm run build')] },
      { name: 'E2E / playwright', status: 'in_progress', conclusion: null, steps: [] },
      { name: 'Lint / lint', status: 'completed', conclusion: 'failure', steps: [step('Run npx eslint .', 'failure')] },
    ];
    const s = summarizeReceipt({ sha: 'abc1234', jobs }, files, checkClaims('Handled errors.', files));
    expect(s.jobs).toEqual({ passed: 1, failed: 1, running: 1, skipped: 0 });
    expect(s.notVerified).toEqual([
      'Failed: Lint / lint (step "Run npx eslint .").',
      'Still running when ClaimCheck finished: E2E / playwright.',
      'Tests ran, but none passed.',
      'No type check or lint step passed.',
      'Changed code has no test changes: `src/pay.ts`.',
      'Claim not backed by the diff: Errors handled.',
    ]);
  });

  it('flags claimed tests that CI never ran', () => {
    const files = [file('src/a.test.ts', ['it()'])];
    const s = summarizeReceipt({ sha: 'abc1234', jobs: [{ ...ci, steps: [step('Run npm run build')] }] }, files, checkClaims('Added tests.', files));
    expect(s.notVerified).toContain('No CI step ran tests.');
    expect(s.notVerified).toContain('The PR adds tests, but no passing CI step ran them.');
  });

  it('reports API errors and missing CI', () => {
    expect(summarizeReceipt({ sha: 'a', jobs: [], error: 'GitHub API GET /x failed: 403' }).notVerified[0]).toMatch(/could not be read/);
    expect(summarizeReceipt({ sha: 'a', jobs: [] }).notVerified).toEqual(['No CI jobs ran for this commit.']);
  });

  it('renders a stable receipt', () => {
    const files = [file('src/a.ts', ['x']), file('src/a.test.ts', ['it()'])];
    expect(renderReceipt(summarizeReceipt({ sha: 'abcdef1234', jobs: [ci] }, files))).toMatchSnapshot();
  });
});
