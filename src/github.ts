import { readFileSync } from 'node:fs';
import { MARKER } from './markdown.js';
import type { CiJob, Receipt } from './receipt.js';

export interface PrContext {
  owner: string;
  repo: string;
  number: number;
  body: string;
  baseRef?: string;
  headSha?: string;
  apiUrl: string;
}

/** PR details from the GitHub Actions environment, or undefined outside a PR. */
export function prContext(env: NodeJS.ProcessEnv = process.env): PrContext | undefined {
  const [owner, repo] = (env.GITHUB_REPOSITORY ?? '').split('/');
  if (!owner || !repo || !env.GITHUB_EVENT_PATH) return undefined;
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as {
    pull_request?: { number?: number; body?: string | null; base?: { ref?: string }; head?: { sha?: string } };
  };
  const pr = event.pull_request;
  if (typeof pr?.number !== 'number') return undefined;
  return {
    owner,
    repo,
    number: pr.number,
    body: pr.body ?? '',
    baseRef: pr.base?.ref ?? env.GITHUB_BASE_REF,
    headSha: pr.head?.sha,
    apiUrl: env.GITHUB_API_URL ?? 'https://api.github.com',
  };
}

async function gh(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${init.method ?? 'GET'} ${new URL(url).pathname} failed: ${res.status}`);
  return res;
}

/** The latest PR body from the API (the event payload can be stale on re-runs). */
export async function fetchBody(token: string, pr: PrContext): Promise<string> {
  const res = await gh(token, `${pr.apiUrl}/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`);
  const data = (await res.json()) as { body?: string | null };
  return data.body ?? '';
}

/**
 * Update our earlier PR comment, or create one. With `create: false` it only
 * updates an existing comment (so a fixed PR clears an old warning).
 */
export async function upsertComment(
  token: string,
  pr: PrContext,
  body: string,
  create = true,
): Promise<'created' | 'updated' | 'skipped'> {
  const base = `${pr.apiUrl}/repos/${pr.owner}/${pr.repo}`;
  for (let page = 1; page <= 10; page++) {
    const res = await gh(token, `${base}/issues/${pr.number}/comments?per_page=100&page=${page}`);
    const comments = (await res.json()) as Array<{ id: number; body?: string }>;
    const ours = comments.find((c) => c.body?.includes(MARKER));
    if (ours) {
      await gh(token, `${base}/issues/comments/${ours.id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
      return 'updated';
    }
    if (comments.length < 100) break;
  }
  if (!create) return 'skipped';
  await gh(token, `${base}/issues/${pr.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
  return 'created';
}

interface ApiJob {
  name: string;
  status: string;
  conclusion: string | null;
  html_url?: string;
  steps?: Array<{ name: string; status: string; conclusion: string | null }>;
}

/**
 * Every CI job that ran for `sha`: GitHub Actions jobs with their steps, plus
 * check runs from other CI apps. Jobs of our own run that are still going
 * (ClaimCheck itself) are left out.
 */
export async function fetchCiJobs(token: string, pr: PrContext, sha: string, selfRunId?: string): Promise<CiJob[]> {
  const base = `${pr.apiUrl}/repos/${pr.owner}/${pr.repo}`;
  const jobs: CiJob[] = [];

  const runsRes = await gh(token, `${base}/actions/runs?head_sha=${sha}&per_page=100`);
  const runs = ((await runsRes.json()) as { workflow_runs?: Array<{ id: number; name?: string }> }).workflow_runs ?? [];
  for (const run of runs) {
    const res = await gh(token, `${base}/actions/runs/${run.id}/jobs?per_page=100`);
    const list = ((await res.json()) as { jobs?: ApiJob[] }).jobs ?? [];
    for (const j of list) {
      if (String(run.id) === selfRunId && j.status !== 'completed') continue;
      jobs.push({
        name: run.name ? `${run.name} / ${j.name}` : j.name,
        status: j.status,
        conclusion: j.conclusion,
        url: j.html_url,
        steps: (j.steps ?? []).map((s) => ({ name: s.name, status: s.status, conclusion: s.conclusion })),
      });
    }
  }

  const checksRes = await gh(token, `${base}/commits/${sha}/check-runs?per_page=100`);
  const checks = ((await checksRes.json()) as { check_runs?: Array<ApiJob & { app?: { slug?: string } }> }).check_runs ?? [];
  for (const c of checks) {
    if (c.app?.slug === 'github-actions') continue; // already listed with steps above
    jobs.push({ name: c.name, status: c.status, conclusion: c.conclusion, url: c.html_url, steps: [] });
  }
  return jobs;
}

/** Read CI jobs, waiting up to `waitMinutes` for running jobs to finish. */
export async function fetchReceipt(
  token: string,
  pr: PrContext,
  sha: string,
  opts: { waitMinutes?: number; selfRunId?: string; pollSeconds?: number } = {},
): Promise<Receipt> {
  const deadline = Date.now() + (opts.waitMinutes ?? 0) * 60_000;
  const poll = (opts.pollSeconds ?? 20) * 1000;
  try {
    for (;;) {
      const jobs = await fetchCiJobs(token, pr, sha, opts.selfRunId);
      const pending = jobs.some((j) => j.status !== 'completed');
      if (!pending || Date.now() + poll > deadline) return { sha, jobs };
      await new Promise((r) => setTimeout(r, poll));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = /: 40[34]$/.test(msg) ? ' (give the workflow `actions: read` and `checks: read`)' : '';
    return { sha, jobs: [], error: `${msg}${hint}` };
  }
}
