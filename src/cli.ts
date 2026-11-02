import { appendFileSync, readFileSync } from 'node:fs';
import { checkClaims } from './check.js';
import { parseDiff } from './diff.js';
import { gitDiff } from './git.js';
import { fetchBody, fetchReceipt, prContext, upsertComment } from './github.js';
import { renderMarkdown, summary } from './markdown.js';
import { renderReceipt, summarizeReceipt, type ReceiptSummary } from './receipt.js';

const HELP = `claimcheck - check the claims in a PR description against the diff

Usage:
  claimcheck [options]

Options:
  --body <text>          PR description text
  --body-file <path>     Read the PR description from a file ("-" for stdin)
  --base <ref>           Compare HEAD with this ref (default: origin/<PR base> or origin/main)
  --diff-file <path>     Use a saved unified diff instead of running git
  --json                 Print results as JSON
  --comment              Post the report as a PR comment (GitHub Actions)
  --comment-on <when>    mismatch (default) | always
  --fail-on-mismatch     Exit 1 when a claim is not supported
  --receipt              Add a verification receipt: which CI tests and steps ran
                         for the PR head commit, and what was not verified (GitHub Actions)
  --wait <minutes>       With --receipt, wait up to this long for other CI jobs to finish (default 0)
  -h, --help             Show this help

In GitHub Actions the PR description and base branch are read automatically.`;

interface Opts {
  body?: string;
  bodyFile?: string;
  base?: string;
  diffFile?: string;
  json: boolean;
  comment: boolean;
  commentOn: 'mismatch' | 'always';
  failOnMismatch: boolean;
  receipt: boolean;
  wait: number;
}

export function parseArgs(argv: string[]): Opts {
  const o: Opts = { json: false, comment: false, commentOn: 'mismatch', failOnMismatch: false, receipt: false, wait: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--body') o.body = next();
    else if (a === '--body-file') o.bodyFile = next();
    else if (a === '--base') o.base = next();
    else if (a === '--diff-file') o.diffFile = next();
    else if (a === '--json') o.json = true;
    else if (a === '--comment') o.comment = true;
    else if (a === '--comment-on') {
      const v = next();
      if (v !== 'mismatch' && v !== 'always') throw new Error('--comment-on must be mismatch or always');
      o.commentOn = v;
    } else if (a === '--fail-on-mismatch') o.failOnMismatch = true;
    else if (a === '--receipt') o.receipt = true;
    else if (a === '--wait') {
      const v = Number(next());
      if (!Number.isFinite(v) || v < 0) throw new Error('--wait must be a number of minutes');
      o.wait = v;
    }
    else if (a === '-h' || a === '--help') {
      console.log(HELP);
      process.exit(0);
    } else throw new Error(`Unknown option: ${a}`);
  }
  return o;
}

async function main(): Promise<number> {
  const o = parseArgs(process.argv.slice(2));
  const pr = prContext();
  const token = process.env.GITHUB_TOKEN;

  let body = o.body;
  if (body === undefined && o.bodyFile) body = readFileSync(o.bodyFile === '-' ? 0 : o.bodyFile, 'utf8');
  if (body === undefined && pr) body = token ? await fetchBody(token, pr).catch(() => pr.body) : pr.body;
  if (body === undefined) throw new Error('No PR description. Use --body, --body-file, or run inside a pull_request workflow.');

  const base = o.base || (pr?.baseRef ? `origin/${pr.baseRef}` : 'origin/main');
  const diff = o.diffFile ? readFileSync(o.diffFile, 'utf8') : gitDiff(base);
  const files = parseDiff(diff);
  const results = checkClaims(body, files);
  const s = summary(results);

  let receipt: ReceiptSummary | undefined;
  if (o.receipt) {
    if (!pr?.headSha || !token) console.error('claimcheck: --receipt needs a pull_request event and GITHUB_TOKEN; skipping receipt.');
    else {
      const raw = await fetchReceipt(token, pr, pr.headSha, { waitMinutes: o.wait, selfRunId: process.env.GITHUB_RUN_ID });
      receipt = summarizeReceipt(raw, files, results);
    }
  }
  const md = receipt ? `${renderMarkdown(results)}\n\n${renderReceipt(receipt)}` : renderMarkdown(results);

  if (o.json) console.log(JSON.stringify({ results, summary: s, receipt }, null, 2));
  else console.log(md);

  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);

  if (o.comment) {
    if (!pr || !token) console.error('claimcheck: --comment needs a pull_request event and GITHUB_TOKEN; skipping comment.');
    else {
      // A receipt is meant to sit on every PR, so it always gets a comment.
      const needs = s.bad + s.unclear > 0 || o.commentOn === 'always' || receipt !== undefined;
      // When everything matches we still update an old comment, so a fixed PR clears its warning.
      const r = await upsertComment(token, pr, md, needs);
      if (r !== 'skipped') console.error(`claimcheck: PR comment ${r}.`);
    }
  }
  return o.failOnMismatch && s.bad > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`claimcheck: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  },
);
