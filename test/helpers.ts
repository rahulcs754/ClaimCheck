import type { FileDiff } from '../src/types.js';

/** Build a FileDiff quickly: added/removed are lists of line texts. */
export function file(path: string, added: string[] = [], removed: string[] = [], status: FileDiff['status'] = 'modified'): FileDiff {
  return {
    path,
    status,
    added: added.map((text, i) => ({ n: i + 1, text })),
    removed: removed.map((text, i) => ({ n: i + 1, text })),
  };
}
