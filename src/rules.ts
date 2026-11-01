import { findAdded, isDoc, isSource, isTest, list } from './files.js';
import type { FileDiff, Rule, Verdict } from './types.js';

const ok = (evidence: string) => ({ verdict: 'supported' as Verdict, evidence });
const bad = (evidence: string) => ({ verdict: 'unsupported' as Verdict, evidence });
const unclear = (evidence: string) => ({ verdict: 'unclear' as Verdict, evidence });

const withAdded = (files: FileDiff[], pred: (p: string) => boolean) =>
  files.filter((f) => pred(f.path) && f.status !== 'deleted' && f.added.some((l) => l.text.trim()));

// ---- tests -----------------------------------------------------------------

const tests: Rule = {
  id: 'tests',
  label: 'Tests added',
  negatable: true,
  claim: [
    /\b(add(ed|s|ing)?|wr(ote|itten|ite|iting)|updat(ed|es|ing)|includ(ed|es|ing)|extend(ed|s)?|new)\b[^.\n]{0,40}?\b(unit |integration |e2e |regression |snapshot )?tests?\b/i,
    /\btests? (were |are |have been )?(added|included|updated|written)\b/i,
    /\b(test coverage|covered by (unit )?tests|with (unit )?tests)\b/i,
  ],
  check(files) {
    const changed = withAdded(files, isTest);
    if (changed.length === 0) {
      const src = files.filter((f) => isSource(f.path)).map((f) => f.path);
      return bad(`No test file has new lines.${src.length ? ` Code changed in ${list(src)}.` : ''}`);
    }
    const skips = findAdded(files, /^\s*(it|test|describe)\.(skip|only|todo)\(|^\s*x(it|describe)\(/, isTest);
    if (skips.length) return unclear(`Test files changed, but new skipped or focused tests at ${list(skips)}.`);
    return ok(`${changed.length} test file${changed.length > 1 ? 's' : ''} changed: ${list(changed.map((f) => f.path))}.`);
  },
};

// ---- no breaking changes -----------------------------------------------------

const EXPORT_DECL =
  /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const EXPORT_LIST = /^\s*export\s+(?:type\s+)?\{([^}]*)\}/;

/** Exported names declared on a line, e.g. "export function a" or "export { a, b as c }". */
export function exportNames(text: string): string[] {
  const d = EXPORT_DECL.exec(text);
  if (d?.[1]) return [d[1]];
  if (/^\s*export\s+default\b/.test(text)) return ['default'];
  const l = EXPORT_LIST.exec(text);
  if (l?.[1]) {
    return l[1]
      .split(',')
      .map((s) => s.trim().replace(/^type\s+/, ''))
      .filter(Boolean)
      .map((s) => s.split(/\s+as\s+/).pop()!.trim());
  }
  return [];
}

const noBreaking: Rule = {
  id: 'no-breaking',
  label: 'No breaking changes',
  negatable: false,
  claim: [
    /\b(no|zero|non|without( any)?)[- ]breaking\b/i,
    /\bbackwards?[- ]compatib(le|ility)\b/i,
    /\bnot (a )?breaking\b/i,
    /\b(doesn't|does not|won't|will not) break (anything|existing|the api|callers|consumers)\b/i,
  ],
  check(files) {
    const removed: string[] = [];
    const changedSig: string[] = [];
    const addedAll = new Set<string>();
    for (const f of files) for (const l of f.added) for (const n of exportNames(l.text)) addedAll.add(`${n}`);

    for (const f of files) {
      if (!isSource(f.path)) continue;
      const addedHere = new Map<string, string>();
      for (const l of f.added) for (const n of exportNames(l.text)) addedHere.set(n, l.text.trim());
      for (const l of f.removed) {
        for (const n of exportNames(l.text)) {
          const where = `\`${n}\` in \`${f.oldPath ?? f.path}\``;
          if (addedHere.has(n)) {
            const before = l.text.trim();
            const after = addedHere.get(n)!;
            if (/\bfunction\b|=>/.test(before) && params(before) !== params(after)) changedSig.push(where);
          } else if (!addedAll.has(n) || f.status === 'deleted') {
            removed.push(where);
          }
        }
      }
    }
    const sig = changedSig.length ? ` Signature changed for ${changedSig.slice(0, 3).join(', ')}.` : '';
    if (removed.length) return bad(`Removed export${removed.length > 1 ? 's' : ''} ${removed.slice(0, 4).join(', ')}${removed.length > 4 ? ` and ${removed.length - 4} more` : ''}.${sig}`);
    if (changedSig.length) return unclear(`Signature changed for ${changedSig.slice(0, 4).join(', ')}. Check callers.`);
    return ok('No exported name was removed or changed signature.');
  },
};

function params(line: string): string {
  const m = /\(([^)]*)\)/.exec(line);
  return (m?.[1] ?? '').replace(/\s+/g, '');
}

// ---- error handling ---------------------------------------------------------

const ERROR_CODE =
  /\btry\s*\{|\bcatch\s*[({]|\.catch\(|\bthrow\b|\bexcept\b|\bif err != nil\b|\bif\s*\(\s*!?\s*(err|error|e)\b|\b(isErr|isError|ErrorBoundary|onError|errorElement|safeParse)\b|\bresult\.error\b|\?\.\s*error\b/;

const errorHandling: Rule = {
  id: 'error-handling',
  label: 'Errors handled',
  negatable: true,
  claim: [
    /\b(handl(e|ed|es|ing)|catch(es|ing)?|add(ed|s)?|improv(e|ed|es)|proper)\b[^.\n]{0,30}?\b(errors?|exceptions?|failures?|rejections?)\b/i,
    /\berror[- ]handling\b/i,
    /\btry\s*\/\s*catch\b/i,
  ],
  check(files) {
    const hits = findAdded(files, ERROR_CODE);
    if (hits.length) return ok(`New error handling at ${list(hits)}.`);
    return bad('No new try/catch, .catch(), throw or error check in the changed code.');
  },
};

// ---- docs / changelog ---------------------------------------------------------

const docs: Rule = {
  id: 'docs',
  label: 'Docs updated',
  negatable: true,
  claim: [
    /\b(updat|add|wr[io]t|improv|extend|fix)\w*\b[^.\n]{0,30}?\b(docs?|documentation|readme|jsdoc|docstrings?)\b/i,
    /\b(docs?|documentation|readme) (were |was |has been |have been )?(updated|added)\b/i,
    /\bdocumented\b/i,
  ],
  check(files) {
    const changed = withAdded(files, isDoc).map((f) => f.path);
    if (changed.length) return ok(`Docs changed: ${list(changed)}.`);
    const docComments = findAdded(files, /^\s*(\/\*\*|"""|''')/, isSource).length + countDocComments(files);
    if (docComments) return ok(`No doc files changed, but ${docComments} new doc comment line${docComments > 1 ? 's' : ''} in code.`);
    return bad('No README, docs or doc comment changed.');
  },
};

function countDocComments(files: FileDiff[]): number {
  let n = 0;
  for (const f of files) if (isSource(f.path)) for (const l of f.added) if (/^\s*(\*\s+@|\/\/\/|\*\s+\w)/.test(l.text)) n++;
  return n;
}

const changelog: Rule = {
  id: 'changelog',
  label: 'Changelog updated',
  negatable: true,
  claim: [/\b(updat|add|bump|wr[io]t)\w*\b[^.\n]{0,25}?\b(change ?log|changeset|release notes)\b/i, /\b(change ?log|changeset) (entry )?(updated|added)\b/i],
  check(files) {
    const changed = withAdded(files, (p) => /(^|\/)(CHANGELOG|CHANGES|HISTORY|RELEASE[-_]NOTES)[^/]*$|(^|\/)\.changeset\//i.test(p));
    if (changed.length) return ok(`Changed: ${list(changed.map((f) => f.path))}.`);
    return bad('No CHANGELOG or .changeset file changed.');
  },
};

// ---- migrations -----------------------------------------------------------------

const migration: Rule = {
  id: 'migration',
  label: 'Migration added',
  negatable: true,
  claim: [/\b(add|creat|includ|wr[io]t|generat)\w*\b[^.\n]{0,30}?\b(db |database |schema )?migrations?\b/i],
  check(files) {
    const changed = withAdded(files, (p) => /(^|\/)(migrations?|migrate|alembic\/versions)\/|\.migration\.[jt]s$/i.test(p));
    if (changed.length) return ok(`Migration files: ${list(changed.map((f) => f.path))}.`);
    return bad('No file in a migrations folder was added or changed.');
  },
};

// ---- no new dependencies ---------------------------------------------------------

const NOT_DEPS = new Set(['version', 'node', 'npm', 'pnpm', 'yarn', 'bun', 'packageManager']);
const PKG_DEP = /^\s*"(@?[\w.-]+(?:\/[\w.-]+)?)"\s*:\s*"((?:[\^~]|>=?\s*)?\d[^"]*|workspace:[^"]*|npm:[^"]*|file:[^"]*|git[+:][^"]*|latest|\*)"/;

/** New dependency names per manifest, from added vs removed lines. */
export function newDependencies(files: FileDiff[]): string[] {
  const found: string[] = [];
  for (const f of files) {
    const name = f.path.split('/').pop() ?? '';
    let pick: (t: string) => string | undefined;
    if (name === 'package.json') pick = (t) => { const m = PKG_DEP.exec(t); return m && !NOT_DEPS.has(m[1]!) ? m[1] : undefined; };
    else if (/^requirements.*\.txt$/.test(name)) pick = (t) => (/^\s*([A-Za-z0-9][\w.-]*)/.exec(t.replace(/#.*/, ''))?.[1]?.toLowerCase());
    else if (name === 'go.mod') pick = (t) => /^\s*(?:require\s+)?([\w.-]+\.[a-z]+\/[^\s]+)\s+v\d/.exec(t)?.[1];
    else if (name === 'Cargo.toml') pick = (t) => /^\s*([\w-]+)\s*=\s*("|\{)/.exec(t)?.[1];
    else continue;
    const before = new Set(f.removed.map((l) => pick(l.text)).filter(Boolean));
    for (const l of f.added) {
      const dep = pick(l.text);
      if (dep && !before.has(dep)) found.push(`\`${dep}\` (${f.path})`);
    }
  }
  return found;
}

const noNewDeps: Rule = {
  id: 'no-new-deps',
  label: 'No new dependencies',
  negatable: false,
  claim: [
    /\bno (new|extra|additional) (dependenc|deps?\b|packages?|librar)/i,
    /\bwithout (adding )?(any )?(new |extra )?(dependenc|deps?\b|packages?|librar)/i,
    /\bzero (new )?dependenc/i,
  ],
  check(files) {
    const deps = newDependencies(files);
    if (deps.length) return bad(`New dependenc${deps.length > 1 ? 'ies' : 'y'}: ${deps.slice(0, 5).join(', ')}${deps.length > 5 ? ` and ${deps.length - 5} more` : ''}.`);
    return ok('No new entry in package.json, requirements, go.mod or Cargo.toml.');
  },
};

// ---- code hygiene claims ---------------------------------------------------------

const noAny: Rule = {
  id: 'no-any',
  label: 'No `any` / type safe',
  negatable: false,
  claim: [/\bno `?any`?\b(?! (new|other|breaking|change))/i, /\b(fully|strictly|properly) typed\b/i, /\btype[- ]safe(ty)?\b/i, /\bremoved (all )?(the )?`?any`?( types?)?\b/i],
  check(files) {
    const ts = (p: string) => /\.(ts|tsx|mts|cts)$/.test(p) && !isTest(p);
    const hits = findAdded(files, /:\s*any\b|\bas any\b|<any>|\bany\[\]|@ts-ignore|@ts-nocheck/, ts);
    // @ts-ignore lives in a comment, so check it separately
    for (const f of files) if (ts(f.path)) for (const l of f.added) if (/@ts-(ignore|nocheck)/.test(l.text)) hits.push(`${f.path}:${l.n}`);
    const uniq = [...new Set(hits)];
    if (uniq.length) return bad(`New \`any\` or @ts-ignore at ${list(uniq)}.`);
    return ok('No new `any` or @ts-ignore in changed TypeScript.');
  },
};

const noConsole: Rule = {
  id: 'no-console',
  label: 'No debug logs',
  negatable: false,
  claim: [
    /\b(remov|clean)\w*\b[^.\n]{0,30}?\b(console\.log|console logs?|debug (logs?|statements|code|prints?))\b/i,
    /\bno (more |leftover |stray )?(console\.logs?|debug (logs?|statements|code)|debugger)\b/i,
  ],
  check(files) {
    const hits = findAdded(files, /\bconsole\.(log|debug)\(|^\s*debugger;?\s*$/);
    if (hits.length) return bad(`New console.log or debugger at ${list(hits)}.`);
    return ok('No new console.log or debugger in shipped code.');
  },
};

const noTodo: Rule = {
  id: 'no-todo',
  label: 'No TODOs left',
  negatable: false,
  claim: [/\bno (new |more |remaining )?(todos?|fixmes?)\b/i, /\b(resolv|remov|address|fix)\w*\b[^.\n]{0,20}?\b(all |the )?(todos?|fixmes?)\b/i],
  check(files) {
    const hits: string[] = [];
    for (const f of files) if (!isDoc(f.path)) for (const l of f.added) if (/\b(TODO|FIXME|XXX|HACK)\b/.test(l.text)) hits.push(`${f.path}:${l.n}`);
    if (hits.length) return bad(`New TODO/FIXME at ${list(hits)}.`);
    return ok('No new TODO or FIXME.');
  },
};

// ---- size -----------------------------------------------------------------------

const oneLine: Rule = {
  id: 'small-change',
  label: 'Small change',
  negatable: false,
  claim: [/\b(one|single|1)[- ]line (fix|change)\b/i, /\b(tiny|trivial|small) (fix|change)\b/i],
  check(files, claim) {
    const max = /\b(one|single|1)[- ]line\b/i.test(claim) ? { lines: 4, files: 1 } : { lines: 40, files: 3 };
    let lines = 0;
    const touched: string[] = [];
    for (const f of files) {
      if (!isSource(f.path)) continue;
      const n = f.added.filter((l) => l.text.trim()).length + f.removed.filter((l) => l.text.trim()).length;
      if (n) touched.push(f.path);
      lines += n;
    }
    if (lines > max.lines || touched.length > max.files) return bad(`${lines} code lines changed across ${touched.length} files.`);
    return ok(`${lines} code lines changed in ${touched.length} file${touched.length === 1 ? '' : 's'}.`);
  },
};

export const RULES: Rule[] = [tests, noBreaking, errorHandling, docs, changelog, migration, noNewDeps, noAny, noConsole, noTodo, oneLine];
