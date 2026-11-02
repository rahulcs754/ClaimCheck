import { isSource, isTest, list } from './files.js';
import type { CheckResult, FileDiff } from './types.js';

/**
 * Verification receipt: what CI actually ran for the PR's head commit
 * (tests, type check, lint, build) and what was left unverified.
 */

export type StepKind = 'test' | 'typecheck' | 'lint' | 'build';

export interface CiStep {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface CiJob {
  /** "Workflow / job" for Actions, the check name for other CI apps. */
  name: string;
  status: string;
  conclusion: string | null;
  url?: string;
  steps: CiStep[];
}

export interface Receipt {
  sha: string;
  jobs: CiJob[];
  /** Set when CI results could not be read. */
  error?: string;
}

export interface VerifiedStep {
  kind: StepKind;
  job: string;
  step?: string;
  result: 'passed' | 'failed' | 'skipped' | 'running';
}

export interface ReceiptSummary {
  sha: string;
  ran: VerifiedStep[];
  jobs: { passed: number; failed: number; running: number; skipped: number };
  notVerified: string[];
}

const KINDS: Array<[StepKind, RegExp]> = [
  ['typecheck', /\b(typecheck|type-check|types|tsc|mypy|pyright|flow)\b/i],
  ['lint', /\b(lint|eslint|biome|ruff|flake8|pylint|golangci|stylelint|clippy|format:check|prettier --check)\b/i],
  ['test', /\b(tests?|vitest|jest|pytest|mocha|ava|playwright|cypress|e2e|specs?|unittest|go test|cargo test|rspec|phpunit|coverage)\b/i],
  ['build', /\b(build|compile|bundle|tsup|webpack|rollup|next build|vite build)\b/i],
];

/** Setup and teardown steps that say nothing about the code. */
const BORING = /^(set up job|complete job|post |run actions\/|checkout|set ?up |install|run (npm (ci|install)|pnpm install|yarn( install)?|pip install|bun install))/i;

export function stepKind(name: string): StepKind | undefined {
  if (BORING.test(name)) return undefined;
  for (const [kind, re] of KINDS) if (re.test(name)) return kind;
  return undefined;
}

function result(status: string, conclusion: string | null): VerifiedStep['result'] {
  if (status !== 'completed') return 'running';
  if (conclusion === 'success' || conclusion === 'neutral') return 'passed';
  if (conclusion === 'skipped' || conclusion === 'cancelled') return 'skipped';
  return 'failed';
}

const LABEL: Record<StepKind, string> = { test: 'Tests', typecheck: 'Type check', lint: 'Lint', build: 'Build' };

/** Turn raw CI jobs into what ran and what was not verified. */
export function summarizeReceipt(receipt: Receipt, files: FileDiff[] = [], results: CheckResult[] = []): ReceiptSummary {
  const ran: VerifiedStep[] = [];
  const jobs = { passed: 0, failed: 0, running: 0, skipped: 0 };
  const failed: string[] = [];
  const running: string[] = [];
  const skipped: string[] = [];

  for (const job of receipt.jobs) {
    const r = result(job.status, job.conclusion);
    jobs[r === 'passed' ? 'passed' : r === 'failed' ? 'failed' : r === 'running' ? 'running' : 'skipped']++;
    if (r === 'running') running.push(job.name);
    if (r === 'skipped') skipped.push(job.name);

    let found = false;
    for (const s of job.steps) {
      const kind = stepKind(s.name);
      if (!kind) continue;
      found = true;
      ran.push({ kind, job: job.name, step: s.name, result: result(s.status, s.conclusion) });
    }
    // Other CI apps (and jobs without step data) only have a name.
    const jobKind = stepKind(job.name.split(' / ').pop() ?? job.name);
    if (!found && jobKind) ran.push({ kind: jobKind, job: job.name, result: r });

    if (r === 'failed') {
      const bad = job.steps.find((s) => result(s.status, s.conclusion) === 'failed');
      failed.push(bad ? `${job.name} (step "${bad.name}")` : job.name);
    }
  }

  const notVerified: string[] = [];
  if (receipt.error) notVerified.push(`CI results could not be read: ${receipt.error}`);
  else if (receipt.jobs.length === 0) notVerified.push('No CI jobs ran for this commit.');
  if (failed.length) notVerified.push(`Failed: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? ` and ${failed.length - 5} more` : ''}.`);
  if (running.length) notVerified.push(`Still running when ClaimCheck finished: ${running.slice(0, 5).join(', ')}.`);
  if (skipped.length) notVerified.push(`Skipped or cancelled: ${skipped.slice(0, 5).join(', ')}.`);

  if (!receipt.error && receipt.jobs.length) {
    const tests = ran.filter((s) => s.kind === 'test');
    const passedTests = tests.filter((s) => s.result === 'passed');
    if (tests.length === 0) notVerified.push('No CI step ran tests.');
    else if (passedTests.length === 0) notVerified.push('Tests ran, but none passed.');

    const testsClaimed = results.some((r) => r.rule === 'tests' && r.verdict === 'supported');
    if (testsClaimed && passedTests.length === 0) notVerified.push('The PR adds tests, but no passing CI step ran them.');

    const code = files.filter((f) => f.status !== 'deleted' && isSource(f.path)).map((f) => f.path);
    if (code.length && !ran.some((s) => (s.kind === 'typecheck' || s.kind === 'lint') && s.result === 'passed'))
      notVerified.push('No type check or lint step passed.');
  }

  const code = files.filter((f) => f.status !== 'deleted' && isSource(f.path)).map((f) => f.path);
  const testFiles = files.filter((f) => f.status !== 'deleted' && isTest(f.path));
  if (code.length && testFiles.length === 0) notVerified.push(`Changed code has no test changes: ${list(code)}.`);

  for (const r of results.filter((x) => x.verdict === 'unclear')) notVerified.push(`Needs a human look: ${r.label}.`);
  for (const r of results.filter((x) => x.verdict === 'unsupported')) notVerified.push(`Claim not backed by the diff: ${r.label}.`);

  return { sha: receipt.sha, ran, jobs, notVerified };
}

const ICON: Record<VerifiedStep['result'], string> = { passed: '✅ passed', failed: '❌ failed', skipped: '⏭️ skipped', running: '⏳ running' };

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function renderReceipt(s: ReceiptSummary): string {
  const lines = [`#### 🧾 Verification receipt for \`${s.sha.slice(0, 7)}\``, ''];
  if (s.ran.length) {
    const order: StepKind[] = ['test', 'typecheck', 'lint', 'build'];
    const sorted = [...s.ran].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    lines.push('| Check | Where | Result |', '|---|---|---|');
    for (const r of sorted.slice(0, 20)) lines.push(`| ${LABEL[r.kind]} | ${cell(r.job)}${r.step ? ` → \`${cell(r.step)}\`` : ''} | ${ICON[r.result]} |`);
    if (sorted.length > 20) lines.push(`| | and ${sorted.length - 20} more | |`);
    lines.push('');
  } else {
    lines.push('No test, type check, lint or build step found in CI.', '');
  }
  const { passed, failed, running, skipped } = s.jobs;
  lines.push(`CI jobs: ${passed} passed · ${failed} failed · ${running} running · ${skipped} skipped`, '');
  if (s.notVerified.length) {
    lines.push('**Not verified**', ...s.notVerified.map((n) => `- ${n}`));
  } else {
    lines.push('**Not verified:** nothing found. CI ran tests and checks, and every claim matches the diff.');
  }
  return lines.join('\n');
}
