#!/usr/bin/env node

// src/cli.ts
import { appendFileSync, readFileSync as readFileSync2 } from "fs";

// src/files.ts
var TEST = /(^|\/)(__tests__|__test__|tests?|specs?|e2e|cypress|playwright)\/|\.(test|spec|e2e)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$|Tests?\.(java|kt|cs)$|_spec\.rb$/i;
var DOC = /\.(md|mdx|rst|adoc|txt)$|(^|\/)docs?\//i;
var CODE = /\.([cm]?[jt]sx?|vue|svelte|py|go|rb|java|kt|cs|php|rs|swift)$/i;
var isTest = (p) => TEST.test(p);
var isDoc = (p) => DOC.test(p) && !isTest(p) && !CODE.test(p);
var isSource = (p) => CODE.test(p) && !isTest(p);
var isCommentLine = (t) => /^\s*(\/\/|\/\*|\*|#(?!!)|<!--)/.test(t);
function list(paths, max = 3) {
  const shown = paths.slice(0, max).map((p) => `\`${p}\``).join(", ");
  return paths.length > max ? `${shown} and ${paths.length - max} more` : shown;
}
function findAdded(files, re, filter = isSource) {
  const hits = [];
  for (const f of files) {
    if (!filter(f.path)) continue;
    for (const l of f.added) if (re.test(l.text) && !isCommentLine(l.text)) hits.push(`${f.path}:${l.n}`);
  }
  return hits;
}

// src/rules.ts
var ok = (evidence) => ({ verdict: "supported", evidence });
var bad = (evidence) => ({ verdict: "unsupported", evidence });
var unclear = (evidence) => ({ verdict: "unclear", evidence });
var withAdded = (files, pred) => files.filter((f) => pred(f.path) && f.status !== "deleted" && f.added.some((l) => l.text.trim()));
var tests = {
  id: "tests",
  label: "Tests added",
  negatable: true,
  claim: [
    /\b(add(ed|s|ing)?|wr(ote|itten|ite|iting)|updat(ed|es|ing)|includ(ed|es|ing)|extend(ed|s)?|new)\b[^.\n]{0,40}?\b(unit |integration |e2e |regression |snapshot )?tests?\b/i,
    /\btests? (were |are |have been )?(added|included|updated|written)\b/i,
    /\b(test coverage|covered by (unit )?tests|with (unit )?tests)\b/i
  ],
  check(files) {
    const changed = withAdded(files, isTest);
    if (changed.length === 0) {
      const src = files.filter((f) => isSource(f.path)).map((f) => f.path);
      return bad(`No test file has new lines.${src.length ? ` Code changed in ${list(src)}.` : ""}`);
    }
    const skips = findAdded(files, /^\s*(it|test|describe)\.(skip|only|todo)\(|^\s*x(it|describe)\(/, isTest);
    if (skips.length) return unclear(`Test files changed, but new skipped or focused tests at ${list(skips)}.`);
    return ok(`${changed.length} test file${changed.length > 1 ? "s" : ""} changed: ${list(changed.map((f) => f.path))}.`);
  }
};
var EXPORT_DECL = /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
var EXPORT_LIST = /^\s*export\s+(?:type\s+)?\{([^}]*)\}/;
function exportNames(text) {
  const d = EXPORT_DECL.exec(text);
  if (d?.[1]) return [d[1]];
  if (/^\s*export\s+default\b/.test(text)) return ["default"];
  const l = EXPORT_LIST.exec(text);
  if (l?.[1]) {
    return l[1].split(",").map((s) => s.trim().replace(/^type\s+/, "")).filter(Boolean).map((s) => s.split(/\s+as\s+/).pop().trim());
  }
  return [];
}
var noBreaking = {
  id: "no-breaking",
  label: "No breaking changes",
  negatable: false,
  claim: [
    /\b(no|zero|non|without( any)?)[- ]breaking\b/i,
    /\bbackwards?[- ]compatib(le|ility)\b/i,
    /\bnot (a )?breaking\b/i,
    /\b(doesn't|does not|won't|will not) break (anything|existing|the api|callers|consumers)\b/i
  ],
  check(files) {
    const removed = [];
    const changedSig = [];
    const addedAll = /* @__PURE__ */ new Set();
    for (const f of files) for (const l of f.added) for (const n of exportNames(l.text)) addedAll.add(`${n}`);
    for (const f of files) {
      if (!isSource(f.path)) continue;
      const addedHere = /* @__PURE__ */ new Map();
      for (const l of f.added) for (const n of exportNames(l.text)) addedHere.set(n, l.text.trim());
      for (const l of f.removed) {
        for (const n of exportNames(l.text)) {
          const where = `\`${n}\` in \`${f.oldPath ?? f.path}\``;
          if (addedHere.has(n)) {
            const before = l.text.trim();
            const after = addedHere.get(n);
            if (/\bfunction\b|=>/.test(before) && params(before) !== params(after)) changedSig.push(where);
          } else if (!addedAll.has(n) || f.status === "deleted") {
            removed.push(where);
          }
        }
      }
    }
    const sig = changedSig.length ? ` Signature changed for ${changedSig.slice(0, 3).join(", ")}.` : "";
    if (removed.length) return bad(`Removed export${removed.length > 1 ? "s" : ""} ${removed.slice(0, 4).join(", ")}${removed.length > 4 ? ` and ${removed.length - 4} more` : ""}.${sig}`);
    if (changedSig.length) return unclear(`Signature changed for ${changedSig.slice(0, 4).join(", ")}. Check callers.`);
    return ok("No exported name was removed or changed signature.");
  }
};
function params(line) {
  const m = /\(([^)]*)\)/.exec(line);
  return (m?.[1] ?? "").replace(/\s+/g, "");
}
var ERROR_CODE = /\btry\s*\{|\bcatch\s*[({]|\.catch\(|\bthrow\b|\bexcept\b|\bif err != nil\b|\bif\s*\(\s*!?\s*(err|error|e)\b|\b(isErr|isError|ErrorBoundary|onError|errorElement|safeParse)\b|\bresult\.error\b|\?\.\s*error\b/;
var errorHandling = {
  id: "error-handling",
  label: "Errors handled",
  negatable: true,
  claim: [
    /\b(handl(e|ed|es|ing)|catch(es|ing)?|add(ed|s)?|improv(e|ed|es)|proper)\b[^.\n]{0,30}?\b(errors?|exceptions?|failures?|rejections?)\b/i,
    /\berror[- ]handling\b/i,
    /\btry\s*\/\s*catch\b/i
  ],
  check(files) {
    const hits = findAdded(files, ERROR_CODE);
    if (hits.length) return ok(`New error handling at ${list(hits)}.`);
    return bad("No new try/catch, .catch(), throw or error check in the changed code.");
  }
};
var docs = {
  id: "docs",
  label: "Docs updated",
  negatable: true,
  claim: [
    /\b(updat|add|wr[io]t|improv|extend|fix)\w*\b[^.\n]{0,30}?\b(docs?|documentation|readme|jsdoc|docstrings?)\b/i,
    /\b(docs?|documentation|readme) (were |was |has been |have been )?(updated|added)\b/i,
    /\bdocumented\b/i
  ],
  check(files) {
    const changed = withAdded(files, isDoc).map((f) => f.path);
    if (changed.length) return ok(`Docs changed: ${list(changed)}.`);
    const docComments = findAdded(files, /^\s*(\/\*\*|"""|''')/, isSource).length + countDocComments(files);
    if (docComments) return ok(`No doc files changed, but ${docComments} new doc comment line${docComments > 1 ? "s" : ""} in code.`);
    return bad("No README, docs or doc comment changed.");
  }
};
function countDocComments(files) {
  let n = 0;
  for (const f of files) if (isSource(f.path)) {
    for (const l of f.added) if (/^\s*(\*\s+@|\/\/\/|\*\s+\w)/.test(l.text)) n++;
  }
  return n;
}
var changelog = {
  id: "changelog",
  label: "Changelog updated",
  negatable: true,
  claim: [/\b(updat|add|bump|wr[io]t)\w*\b[^.\n]{0,25}?\b(change ?log|changeset|release notes)\b/i, /\b(change ?log|changeset) (entry )?(updated|added)\b/i],
  check(files) {
    const changed = withAdded(files, (p) => /(^|\/)(CHANGELOG|CHANGES|HISTORY|RELEASE[-_]NOTES)[^/]*$|(^|\/)\.changeset\//i.test(p));
    if (changed.length) return ok(`Changed: ${list(changed.map((f) => f.path))}.`);
    return bad("No CHANGELOG or .changeset file changed.");
  }
};
var migration = {
  id: "migration",
  label: "Migration added",
  negatable: true,
  claim: [/\b(add|creat|includ|wr[io]t|generat)\w*\b[^.\n]{0,30}?\b(db |database |schema )?migrations?\b/i],
  check(files) {
    const changed = withAdded(files, (p) => /(^|\/)(migrations?|migrate|alembic\/versions)\/|\.migration\.[jt]s$/i.test(p));
    if (changed.length) return ok(`Migration files: ${list(changed.map((f) => f.path))}.`);
    return bad("No file in a migrations folder was added or changed.");
  }
};
var NOT_DEPS = /* @__PURE__ */ new Set(["version", "node", "npm", "pnpm", "yarn", "bun", "packageManager"]);
var PKG_DEP = /^\s*"(@?[\w.-]+(?:\/[\w.-]+)?)"\s*:\s*"((?:[\^~]|>=?\s*)?\d[^"]*|workspace:[^"]*|npm:[^"]*|file:[^"]*|git[+:][^"]*|latest|\*)"/;
function newDependencies(files) {
  const found = [];
  for (const f of files) {
    const name = f.path.split("/").pop() ?? "";
    let pick;
    if (name === "package.json") pick = (t) => {
      const m = PKG_DEP.exec(t);
      return m && !NOT_DEPS.has(m[1]) ? m[1] : void 0;
    };
    else if (/^requirements.*\.txt$/.test(name)) pick = (t) => /^\s*([A-Za-z0-9][\w.-]*)/.exec(t.replace(/#.*/, ""))?.[1]?.toLowerCase();
    else if (name === "go.mod") pick = (t) => /^\s*(?:require\s+)?([\w.-]+\.[a-z]+\/[^\s]+)\s+v\d/.exec(t)?.[1];
    else if (name === "Cargo.toml") pick = (t) => /^\s*([\w-]+)\s*=\s*("|\{)/.exec(t)?.[1];
    else continue;
    const before = new Set(f.removed.map((l) => pick(l.text)).filter(Boolean));
    for (const l of f.added) {
      const dep = pick(l.text);
      if (dep && !before.has(dep)) found.push(`\`${dep}\` (${f.path})`);
    }
  }
  return found;
}
var noNewDeps = {
  id: "no-new-deps",
  label: "No new dependencies",
  negatable: false,
  claim: [
    /\bno (new|extra|additional) (dependenc|deps?\b|packages?|librar)/i,
    /\bwithout (adding )?(any )?(new |extra )?(dependenc|deps?\b|packages?|librar)/i,
    /\bzero (new )?dependenc/i
  ],
  check(files) {
    const deps = newDependencies(files);
    if (deps.length) return bad(`New dependenc${deps.length > 1 ? "ies" : "y"}: ${deps.slice(0, 5).join(", ")}${deps.length > 5 ? ` and ${deps.length - 5} more` : ""}.`);
    return ok("No new entry in package.json, requirements, go.mod or Cargo.toml.");
  }
};
var noAny = {
  id: "no-any",
  label: "No `any` / type safe",
  negatable: false,
  claim: [/\bno `?any`?\b(?! (new|other|breaking|change))/i, /\b(fully|strictly|properly) typed\b/i, /\btype[- ]safe(ty)?\b/i, /\bremoved (all )?(the )?`?any`?( types?)?\b/i],
  check(files) {
    const ts = (p) => /\.(ts|tsx|mts|cts)$/.test(p) && !isTest(p);
    const hits = findAdded(files, /:\s*any\b|\bas any\b|<any>|\bany\[\]|@ts-ignore|@ts-nocheck/, ts);
    for (const f of files) if (ts(f.path)) {
      for (const l of f.added) if (/@ts-(ignore|nocheck)/.test(l.text)) hits.push(`${f.path}:${l.n}`);
    }
    const uniq = [...new Set(hits)];
    if (uniq.length) return bad(`New \`any\` or @ts-ignore at ${list(uniq)}.`);
    return ok("No new `any` or @ts-ignore in changed TypeScript.");
  }
};
var noConsole = {
  id: "no-console",
  label: "No debug logs",
  negatable: false,
  claim: [
    /\b(remov|clean)\w*\b[^.\n]{0,30}?\b(console\.log|console logs?|debug (logs?|statements|code|prints?))\b/i,
    /\bno (more |leftover |stray )?(console\.logs?|debug (logs?|statements|code)|debugger)\b/i
  ],
  check(files) {
    const hits = findAdded(files, /\bconsole\.(log|debug)\(|^\s*debugger;?\s*$/);
    if (hits.length) return bad(`New console.log or debugger at ${list(hits)}.`);
    return ok("No new console.log or debugger in shipped code.");
  }
};
var noTodo = {
  id: "no-todo",
  label: "No TODOs left",
  negatable: false,
  claim: [/\bno (new |more |remaining )?(todos?|fixmes?)\b/i, /\b(resolv|remov|address|fix)\w*\b[^.\n]{0,20}?\b(all |the )?(todos?|fixmes?)\b/i],
  check(files) {
    const hits = [];
    for (const f of files) if (!isDoc(f.path)) {
      for (const l of f.added) if (/\b(TODO|FIXME|XXX|HACK)\b/.test(l.text)) hits.push(`${f.path}:${l.n}`);
    }
    if (hits.length) return bad(`New TODO/FIXME at ${list(hits)}.`);
    return ok("No new TODO or FIXME.");
  }
};
var oneLine = {
  id: "small-change",
  label: "Small change",
  negatable: false,
  claim: [/\b(one|single|1)[- ]line (fix|change)\b/i, /\b(tiny|trivial|small) (fix|change)\b/i],
  check(files, claim) {
    const max = /\b(one|single|1)[- ]line\b/i.test(claim) ? { lines: 4, files: 1 } : { lines: 40, files: 3 };
    let lines = 0;
    const touched = [];
    for (const f of files) {
      if (!isSource(f.path)) continue;
      const n = f.added.filter((l) => l.text.trim()).length + f.removed.filter((l) => l.text.trim()).length;
      if (n) touched.push(f.path);
      lines += n;
    }
    if (lines > max.lines || touched.length > max.files) return bad(`${lines} code lines changed across ${touched.length} files.`);
    return ok(`${lines} code lines changed in ${touched.length} file${touched.length === 1 ? "" : "s"}.`);
  }
};
var RULES = [tests, noBreaking, errorHandling, docs, changelog, migration, noNewDeps, noAny, noConsole, noTodo, oneLine];

// src/claims.ts
var NEGATION = /\b(no|not|never|without|cannot|can't|won't|didn't|don't|doesn't|haven't|hasn't|skip\w*|todo|later|will|follow[- ]?up|next pr|plan(ned)? to|need(s|ed)? to|should|could|would|tbd)\b|n't\b/i;
function sentences(body) {
  const clean = body.replace(/\r/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
  const out = [];
  for (const raw of clean.split("\n")) {
    let line = raw.trim();
    if (!line || line.startsWith(">") || line.startsWith("|")) continue;
    if (/^[-*+]\s+\[ \]/.test(line)) continue;
    line = line.replace(/^([-*+]|\d+[.)])\s+(\[[xX]\]\s+)?/, "").replace(/^#+\s+/, "");
    line = line.replace(/\*\*|__/g, "");
    for (const s of line.split(/(?<=[.!?;])\s+/)) {
      const t = s.trim();
      if (t.length > 2) out.push(t);
    }
  }
  return out;
}
var QUOTED = /"[^"\n]*"|\u201c[^\u201d\n]*\u201d|`[^`\n]*`/g;
function matches(rule, raw) {
  const sentence = raw.replace(QUOTED, '""');
  for (const re of rule.claim) {
    const m = re.exec(sentence);
    if (!m) continue;
    if (!rule.negatable) return true;
    const before = sentence.slice(Math.max(0, m.index - 40), m.index);
    const inside = m[0];
    if (NEGATION.test(before) || /\b(no|not|n't)\b/i.test(inside)) continue;
    if (/\?\s*$/.test(sentence)) continue;
    return true;
  }
  return false;
}
function findClaims(body, rules = RULES) {
  const claims = [];
  const list2 = sentences(body);
  for (const rule of rules) {
    const hit = list2.find((s) => matches(rule, s));
    if (hit) claims.push({ rule: rule.id, text: hit });
  }
  return claims;
}

// src/check.ts
function checkClaims(body, files, rules = RULES) {
  return findClaims(body, rules).map((c) => {
    const rule = rules.find((r) => r.id === c.rule);
    const { verdict, evidence } = rule.check(files, c.text);
    return { rule: rule.id, label: rule.label, claim: c.text, verdict, evidence };
  });
}

// src/diff.ts
var HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
function parseDiff(diff) {
  const files = [];
  let cur;
  let oldN = 0;
  let newN = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      cur = { path: m?.[2] ?? "", status: "modified", added: [], removed: [] };
      if (m && m[1] !== m[2]) cur.oldPath = m[1];
      files.push(cur);
      inHunk = false;
      continue;
    }
    if (!cur) continue;
    if (!inHunk) {
      if (line.startsWith("new file mode")) cur.status = "added";
      else if (line.startsWith("deleted file mode")) cur.status = "deleted";
      else if (line.startsWith("rename from ")) {
        cur.status = "renamed";
        cur.oldPath = line.slice(12);
      } else if (line.startsWith("rename to ")) cur.path = line.slice(10);
      else if (line.startsWith("+++ ") && line !== "+++ /dev/null") cur.path = stripPrefix(line.slice(4));
      else if (line.startsWith("--- ") && line !== "--- /dev/null" && cur.status === "deleted") cur.path = stripPrefix(line.slice(4));
    }
    const h = HUNK.exec(line);
    if (h) {
      oldN = Number(h[1]);
      newN = Number(h[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) cur.added.push({ n: newN++, text: line.slice(1) });
    else if (line.startsWith("-")) cur.removed.push({ n: oldN++, text: line.slice(1) });
    else if (line.startsWith(" ")) {
      oldN++;
      newN++;
    }
  }
  return files.filter((f) => f.path);
}
function stripPrefix(p) {
  const t = p.trim().replace(/^"(.*)"$/, "$1");
  return t.replace(/^[ab]\//, "");
}

// src/git.ts
import { execFileSync } from "child_process";
function gitDiff(base, cwd = process.cwd()) {
  return execFileSync("git", ["diff", "--no-color", "--no-ext-diff", "-M", "--unified=0", `${base}...HEAD`], {
    cwd,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024
  });
}

// src/github.ts
import { readFileSync } from "fs";

// src/markdown.ts
var MARKER = "<!-- claimcheck -->";
var ICON = { supported: "\u2705", unsupported: "\u274C", unclear: "\u26A0\uFE0F" };
function cell(s, max = 140) {
  const t = s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
  return t.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
function summary(results) {
  return {
    bad: results.filter((r) => r.verdict === "unsupported").length,
    unclear: results.filter((r) => r.verdict === "unclear").length,
    good: results.filter((r) => r.verdict === "supported").length
  };
}
function renderMarkdown(results) {
  const { bad: bad2, unclear: unclear2, good } = summary(results);
  const total = results.length;
  let title;
  if (total === 0) title = "\u2139\uFE0F ClaimCheck: no checkable claims in the PR description";
  else if (bad2) title = `\u274C ClaimCheck: ${bad2} of ${total} claim${total > 1 ? "s" : ""} in the PR description ${bad2 > 1 ? "don't" : "doesn't"} match the diff`;
  else if (unclear2) title = `\u26A0\uFE0F ClaimCheck: ${unclear2} of ${total} claim${total > 1 ? "s" : ""} need${unclear2 > 1 ? "" : "s"} a closer look`;
  else title = total === 1 ? "\u2705 ClaimCheck: the claim in the PR description matches the diff" : `\u2705 ClaimCheck: all ${total} claims match the diff`;
  const lines = [MARKER, `### ${title}`, ""];
  if (total) {
    const order = { unsupported: 0, unclear: 1, supported: 2 };
    const sorted = [...results].sort((a, b) => order[a.verdict] - order[b.verdict]);
    lines.push("| | Claim | PR says | What the diff shows |", "|---|---|---|---|");
    for (const r of sorted) lines.push(`| ${ICON[r.verdict]} | ${r.label} | "${cell(r.claim)}" | ${cell(r.evidence, 220)} |`);
    lines.push("");
    if (bad2) lines.push("Fix the code or edit the description so a reviewer can trust it.", "");
  } else {
    lines.push('ClaimCheck looks for claims like "added tests", "no breaking changes" or "handled errors".', "");
  }
  lines.push(`<sub>${good} supported \xB7 ${bad2} not supported \xB7 ${unclear2} unclear \xB7 [ClaimCheck](https://github.com/rahulcs754/claimcheck)</sub>`);
  return lines.join("\n");
}

// src/github.ts
function prContext(env = process.env) {
  const [owner, repo] = (env.GITHUB_REPOSITORY ?? "").split("/");
  if (!owner || !repo || !env.GITHUB_EVENT_PATH) return void 0;
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  const pr = event.pull_request;
  if (typeof pr?.number !== "number") return void 0;
  return {
    owner,
    repo,
    number: pr.number,
    body: pr.body ?? "",
    baseRef: pr.base?.ref ?? env.GITHUB_BASE_REF,
    headSha: pr.head?.sha,
    apiUrl: env.GITHUB_API_URL ?? "https://api.github.com"
  };
}
async function gh(token, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json"
    }
  });
  if (!res.ok) throw new Error(`GitHub API ${init.method ?? "GET"} ${new URL(url).pathname} failed: ${res.status}`);
  return res;
}
async function fetchBody(token, pr) {
  const res = await gh(token, `${pr.apiUrl}/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`);
  const data = await res.json();
  return data.body ?? "";
}
async function upsertComment(token, pr, body, create = true) {
  const base = `${pr.apiUrl}/repos/${pr.owner}/${pr.repo}`;
  for (let page = 1; page <= 10; page++) {
    const res = await gh(token, `${base}/issues/${pr.number}/comments?per_page=100&page=${page}`);
    const comments = await res.json();
    const ours = comments.find((c) => c.body?.includes(MARKER));
    if (ours) {
      await gh(token, `${base}/issues/comments/${ours.id}`, { method: "PATCH", body: JSON.stringify({ body }) });
      return "updated";
    }
    if (comments.length < 100) break;
  }
  if (!create) return "skipped";
  await gh(token, `${base}/issues/${pr.number}/comments`, { method: "POST", body: JSON.stringify({ body }) });
  return "created";
}
async function fetchCiJobs(token, pr, sha, selfRunId) {
  const base = `${pr.apiUrl}/repos/${pr.owner}/${pr.repo}`;
  const jobs = [];
  const runsRes = await gh(token, `${base}/actions/runs?head_sha=${sha}&per_page=100`);
  const runs = (await runsRes.json()).workflow_runs ?? [];
  for (const run of runs) {
    const res = await gh(token, `${base}/actions/runs/${run.id}/jobs?per_page=100`);
    const list2 = (await res.json()).jobs ?? [];
    for (const j of list2) {
      if (String(run.id) === selfRunId && j.status !== "completed") continue;
      jobs.push({
        name: run.name ? `${run.name} / ${j.name}` : j.name,
        status: j.status,
        conclusion: j.conclusion,
        url: j.html_url,
        steps: (j.steps ?? []).map((s) => ({ name: s.name, status: s.status, conclusion: s.conclusion }))
      });
    }
  }
  const checksRes = await gh(token, `${base}/commits/${sha}/check-runs?per_page=100`);
  const checks = (await checksRes.json()).check_runs ?? [];
  for (const c of checks) {
    if (c.app?.slug === "github-actions") continue;
    jobs.push({ name: c.name, status: c.status, conclusion: c.conclusion, url: c.html_url, steps: [] });
  }
  return jobs;
}
async function fetchReceipt(token, pr, sha, opts = {}) {
  const deadline = Date.now() + (opts.waitMinutes ?? 0) * 6e4;
  const poll = (opts.pollSeconds ?? 20) * 1e3;
  try {
    for (; ; ) {
      const jobs = await fetchCiJobs(token, pr, sha, opts.selfRunId);
      const pending = jobs.some((j) => j.status !== "completed");
      if (!pending || Date.now() + poll > deadline) return { sha, jobs };
      await new Promise((r) => setTimeout(r, poll));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = /: 40[34]$/.test(msg) ? " (give the workflow `actions: read` and `checks: read`)" : "";
    return { sha, jobs: [], error: `${msg}${hint}` };
  }
}

// src/receipt.ts
var KINDS = [
  ["typecheck", /\b(typecheck|type-check|types|tsc|mypy|pyright|flow)\b/i],
  ["lint", /\b(lint|eslint|biome|ruff|flake8|pylint|golangci|stylelint|clippy|format:check|prettier --check)\b/i],
  ["test", /\b(tests?|vitest|jest|pytest|mocha|ava|playwright|cypress|e2e|specs?|unittest|go test|cargo test|rspec|phpunit|coverage)\b/i],
  ["build", /\b(build|compile|bundle|tsup|webpack|rollup|next build|vite build)\b/i]
];
var BORING = /^(set up job|complete job|post |run actions\/|checkout|set ?up |install|run (npm (ci|install)|pnpm install|yarn( install)?|pip install|bun install))/i;
function stepKind(name) {
  if (BORING.test(name)) return void 0;
  for (const [kind, re] of KINDS) if (re.test(name)) return kind;
  return void 0;
}
function result(status, conclusion) {
  if (status !== "completed") return "running";
  if (conclusion === "success" || conclusion === "neutral") return "passed";
  if (conclusion === "skipped" || conclusion === "cancelled") return "skipped";
  return "failed";
}
var LABEL = { test: "Tests", typecheck: "Type check", lint: "Lint", build: "Build" };
function summarizeReceipt(receipt, files = [], results = []) {
  const ran = [];
  const jobs = { passed: 0, failed: 0, running: 0, skipped: 0 };
  const failed = [];
  const running = [];
  const skipped = [];
  for (const job of receipt.jobs) {
    const r = result(job.status, job.conclusion);
    jobs[r === "passed" ? "passed" : r === "failed" ? "failed" : r === "running" ? "running" : "skipped"]++;
    if (r === "running") running.push(job.name);
    if (r === "skipped") skipped.push(job.name);
    let found = false;
    for (const s of job.steps) {
      const kind = stepKind(s.name);
      if (!kind) continue;
      found = true;
      ran.push({ kind, job: job.name, step: s.name, result: result(s.status, s.conclusion) });
    }
    const jobKind = stepKind(job.name.split(" / ").pop() ?? job.name);
    if (!found && jobKind) ran.push({ kind: jobKind, job: job.name, result: r });
    if (r === "failed") {
      const bad2 = job.steps.find((s) => result(s.status, s.conclusion) === "failed");
      failed.push(bad2 ? `${job.name} (step "${bad2.name}")` : job.name);
    }
  }
  const notVerified = [];
  if (receipt.error) notVerified.push(`CI results could not be read: ${receipt.error}`);
  else if (receipt.jobs.length === 0) notVerified.push("No CI jobs ran for this commit.");
  if (failed.length) notVerified.push(`Failed: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? ` and ${failed.length - 5} more` : ""}.`);
  if (running.length) notVerified.push(`Still running when ClaimCheck finished: ${running.slice(0, 5).join(", ")}.`);
  if (skipped.length) notVerified.push(`Skipped or cancelled: ${skipped.slice(0, 5).join(", ")}.`);
  if (!receipt.error && receipt.jobs.length) {
    const tests2 = ran.filter((s) => s.kind === "test");
    const passedTests = tests2.filter((s) => s.result === "passed");
    if (tests2.length === 0) notVerified.push("No CI step ran tests.");
    else if (passedTests.length === 0) notVerified.push("Tests ran, but none passed.");
    const testsClaimed = results.some((r) => r.rule === "tests" && r.verdict === "supported");
    if (testsClaimed && passedTests.length === 0) notVerified.push("The PR adds tests, but no passing CI step ran them.");
    const code2 = files.filter((f) => f.status !== "deleted" && isSource(f.path)).map((f) => f.path);
    if (code2.length && !ran.some((s) => (s.kind === "typecheck" || s.kind === "lint") && s.result === "passed"))
      notVerified.push("No type check or lint step passed.");
  }
  const code = files.filter((f) => f.status !== "deleted" && isSource(f.path)).map((f) => f.path);
  const testFiles = files.filter((f) => f.status !== "deleted" && isTest(f.path));
  if (code.length && testFiles.length === 0) notVerified.push(`Changed code has no test changes: ${list(code)}.`);
  for (const r of results.filter((x) => x.verdict === "unclear")) notVerified.push(`Needs a human look: ${r.label}.`);
  for (const r of results.filter((x) => x.verdict === "unsupported")) notVerified.push(`Claim not backed by the diff: ${r.label}.`);
  return { sha: receipt.sha, ran, jobs, notVerified };
}
var ICON2 = { passed: "\u2705 passed", failed: "\u274C failed", skipped: "\u23ED\uFE0F skipped", running: "\u23F3 running" };
function cell2(s) {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
function renderReceipt(s) {
  const lines = [`#### \u{1F9FE} Verification receipt for \`${s.sha.slice(0, 7)}\``, ""];
  if (s.ran.length) {
    const order = ["test", "typecheck", "lint", "build"];
    const sorted = [...s.ran].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    lines.push("| Check | Where | Result |", "|---|---|---|");
    for (const r of sorted.slice(0, 20)) lines.push(`| ${LABEL[r.kind]} | ${cell2(r.job)}${r.step ? ` \u2192 \`${cell2(r.step)}\`` : ""} | ${ICON2[r.result]} |`);
    if (sorted.length > 20) lines.push(`| | and ${sorted.length - 20} more | |`);
    lines.push("");
  } else {
    lines.push("No test, type check, lint or build step found in CI.", "");
  }
  const { passed, failed, running, skipped } = s.jobs;
  lines.push(`CI jobs: ${passed} passed \xB7 ${failed} failed \xB7 ${running} running \xB7 ${skipped} skipped`, "");
  if (s.notVerified.length) {
    lines.push("**Not verified**", ...s.notVerified.map((n) => `- ${n}`));
  } else {
    lines.push("**Not verified:** nothing found. CI ran tests and checks, and every claim matches the diff.");
  }
  return lines.join("\n");
}

// src/cli.ts
var HELP = `claimcheck - check the claims in a PR description against the diff

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
function parseArgs(argv) {
  const o = { json: false, comment: false, commentOn: "mismatch", failOnMismatch: false, receipt: false, wait: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === void 0) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--body") o.body = next();
    else if (a === "--body-file") o.bodyFile = next();
    else if (a === "--base") o.base = next();
    else if (a === "--diff-file") o.diffFile = next();
    else if (a === "--json") o.json = true;
    else if (a === "--comment") o.comment = true;
    else if (a === "--comment-on") {
      const v = next();
      if (v !== "mismatch" && v !== "always") throw new Error("--comment-on must be mismatch or always");
      o.commentOn = v;
    } else if (a === "--fail-on-mismatch") o.failOnMismatch = true;
    else if (a === "--receipt") o.receipt = true;
    else if (a === "--wait") {
      const v = Number(next());
      if (!Number.isFinite(v) || v < 0) throw new Error("--wait must be a number of minutes");
      o.wait = v;
    } else if (a === "-h" || a === "--help") {
      console.log(HELP);
      process.exit(0);
    } else throw new Error(`Unknown option: ${a}`);
  }
  return o;
}
async function main() {
  const o = parseArgs(process.argv.slice(2));
  const pr = prContext();
  const token = process.env.GITHUB_TOKEN;
  let body = o.body;
  if (body === void 0 && o.bodyFile) body = readFileSync2(o.bodyFile === "-" ? 0 : o.bodyFile, "utf8");
  if (body === void 0 && pr) body = token ? await fetchBody(token, pr).catch(() => pr.body) : pr.body;
  if (body === void 0) throw new Error("No PR description. Use --body, --body-file, or run inside a pull_request workflow.");
  const base = o.base || (pr?.baseRef ? `origin/${pr.baseRef}` : "origin/main");
  const diff = o.diffFile ? readFileSync2(o.diffFile, "utf8") : gitDiff(base);
  const files = parseDiff(diff);
  const results = checkClaims(body, files);
  const s = summary(results);
  let receipt;
  if (o.receipt) {
    if (!pr?.headSha || !token) console.error("claimcheck: --receipt needs a pull_request event and GITHUB_TOKEN; skipping receipt.");
    else {
      const raw = await fetchReceipt(token, pr, pr.headSha, { waitMinutes: o.wait, selfRunId: process.env.GITHUB_RUN_ID });
      receipt = summarizeReceipt(raw, files, results);
    }
  }
  const md = receipt ? `${renderMarkdown(results)}

${renderReceipt(receipt)}` : renderMarkdown(results);
  if (o.json) console.log(JSON.stringify({ results, summary: s, receipt }, null, 2));
  else console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}
`);
  if (o.comment) {
    if (!pr || !token) console.error("claimcheck: --comment needs a pull_request event and GITHUB_TOKEN; skipping comment.");
    else {
      const needs = s.bad + s.unclear > 0 || o.commentOn === "always" || receipt !== void 0;
      const r = await upsertComment(token, pr, md, needs);
      if (r !== "skipped") console.error(`claimcheck: PR comment ${r}.`);
    }
  }
  return o.failOnMismatch && s.bad > 0 ? 1 : 0;
}
main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`claimcheck: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
);
export {
  parseArgs
};
