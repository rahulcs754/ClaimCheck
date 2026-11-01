import type { FileDiff } from './types.js';

const TEST =
  /(^|\/)(__tests__|__test__|tests?|specs?|e2e|cypress|playwright)\/|\.(test|spec|e2e)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$|Tests?\.(java|kt|cs)$|_spec\.rb$/i;
const DOC = /\.(md|mdx|rst|adoc|txt)$|(^|\/)docs?\//i;
const CODE = /\.([cm]?[jt]sx?|vue|svelte|py|go|rb|java|kt|cs|php|rs|swift)$/i;

export const isTest = (p: string) => TEST.test(p);
export const isDoc = (p: string) => DOC.test(p) && !isTest(p) && !CODE.test(p);
/** Source code that ships: code files that are not tests. */
export const isSource = (p: string) => CODE.test(p) && !isTest(p);

/** A comment-only line, so "no console.log" in a comment does not count as code. */
export const isCommentLine = (t: string) => /^\s*(\/\/|\/\*|\*|#(?!!)|<!--)/.test(t);

export function list(paths: string[], max = 3): string {
  const shown = paths.slice(0, max).map((p) => `\`${p}\``).join(', ');
  return paths.length > max ? `${shown} and ${paths.length - max} more` : shown;
}

/** Added code lines in shipped source files, as "path:line". */
export function findAdded(files: FileDiff[], re: RegExp, filter = isSource): string[] {
  const hits: string[] = [];
  for (const f of files) {
    if (!filter(f.path)) continue;
    for (const l of f.added) if (re.test(l.text) && !isCommentLine(l.text)) hits.push(`${f.path}:${l.n}`);
  }
  return hits;
}
