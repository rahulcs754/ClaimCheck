import { execFileSync } from 'node:child_process';

/** Diff between the merge base of `base` and HEAD. */
export function gitDiff(base: string, cwd = process.cwd()): string {
  return execFileSync('git', ['diff', '--no-color', '--no-ext-diff', '-M', '--unified=0', `${base}...HEAD`], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
}
