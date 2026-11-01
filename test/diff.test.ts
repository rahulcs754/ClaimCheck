import { describe, expect, it } from 'vitest';
import { parseDiff } from '../src/diff.js';

describe('parseDiff', () => {
  it('reads added and removed lines with line numbers', () => {
    const files = parseDiff(`diff --git a/src/a.ts b/src/a.ts
index 1..2 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -3,2 +3,3 @@ fn
 keep
-old
+new1
+new2
`);
    expect(files).toHaveLength(1);
    expect(files[0]!.added).toEqual([{ n: 4, text: 'new1' }, { n: 5, text: 'new2' }]);
    expect(files[0]!.removed).toEqual([{ n: 4, text: 'old' }]);
  });

  it('marks new, deleted and renamed files', () => {
    const files = parseDiff(`diff --git a/x.ts b/x.ts
new file mode 100644
--- /dev/null
+++ b/x.ts
@@ -0,0 +1 @@
+export const x = 1;
diff --git a/y.ts b/y.ts
deleted file mode 100644
--- a/y.ts
+++ /dev/null
@@ -1 +0,0 @@
-export const y = 1;
diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
`);
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ['x.ts', 'added'],
      ['y.ts', 'deleted'],
      ['new.ts', 'renamed'],
    ]);
    expect(files[2]!.oldPath).toBe('old.ts');
  });

  it('does not treat +++ / --- inside a hunk as headers', () => {
    const files = parseDiff(`diff --git a/a.md b/a.md
--- a/a.md
+++ b/a.md
@@ -1 +1 @@
---- old rule
+++++ new rule
`);
    expect(files[0]!.path).toBe('a.md');
    expect(files[0]!.added[0]!.text).toBe('++++ new rule');
    expect(files[0]!.removed[0]!.text).toBe('--- old rule');
  });
});
