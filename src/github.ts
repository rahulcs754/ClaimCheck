import { readFileSync } from 'node:fs';
import { MARKER } from './markdown.js';

export interface PrContext {
  owner: string;
  repo: string;
  number: number;
  body: string;
  baseRef?: string;
  apiUrl: string;
}

/** PR details from the GitHub Actions environment, or undefined outside a PR. */
export function prContext(env: NodeJS.ProcessEnv = process.env): PrContext | undefined {
  const [owner, repo] = (env.GITHUB_REPOSITORY ?? '').split('/');
  if (!owner || !repo || !env.GITHUB_EVENT_PATH) return undefined;
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as {
    pull_request?: { number?: number; body?: string | null; base?: { ref?: string } };
  };
  const pr = event.pull_request;
  if (typeof pr?.number !== 'number') return undefined;
  return {
    owner,
    repo,
    number: pr.number,
    body: pr.body ?? '',
    baseRef: pr.base?.ref ?? env.GITHUB_BASE_REF,
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
