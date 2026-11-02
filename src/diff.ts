import type { FileDiff } from './types.js';

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Parse unified diff text (any context size) into per-file added/removed lines. */
export function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: FileDiff | undefined;
  let oldN = 0;
  let newN = 0;
  let inHunk = false;

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      cur = { path: m?.[2] ?? '', status: 'modified', added: [], removed: [] };
      if (m && m[1] !== m[2]) cur.oldPath = m[1];
      files.push(cur);
      inHunk = false;
      continue;
    }
    if (!cur) continue;
    if (!inHunk) {
      if (line.startsWith('new file mode')) cur.status = 'added';
      else if (line.startsWith('deleted file mode')) cur.status = 'deleted';
      else if (line.startsWith('rename from ')) { cur.status = 'renamed'; cur.oldPath = line.slice(12); }
      else if (line.startsWith('rename to ')) cur.path = line.slice(10);
      else if (line.startsWith('+++ ') && line !== '+++ /dev/null') cur.path = stripPrefix(line.slice(4));
      else if (line.startsWith('--- ') && line !== '--- /dev/null' && cur.status === 'deleted') cur.path = stripPrefix(line.slice(4));
    }
    const h = HUNK.exec(line);
    if (h) {
      oldN = Number(h[1]);
      newN = Number(h[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('+')) cur.added.push({ n: newN++, text: line.slice(1) });
    else if (line.startsWith('-')) cur.removed.push({ n: oldN++, text: line.slice(1) });
    else if (line.startsWith(' ')) { oldN++; newN++; }
  }
  return files.filter((f) => f.path);
}

function stripPrefix(p: string): string {
  const t = p.trim().replace(/^"(.*)"$/, '$1');
  return t.replace(/^[ab]\//, '');
}
