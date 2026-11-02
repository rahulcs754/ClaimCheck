# ClaimCheck

**Does the PR do what it says?** ClaimCheck is a GitHub Action that reads the PR description (often written by an AI agent), finds claims like "added tests", "no breaking changes" or "handled errors", and checks each one against the real diff. It comments only when a claim does not match.

[![CI](https://github.com/rahulcs754/claimcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/rahulcs754/claimcheck/actions/workflows/ci.yml)
· [Website](https://rahulcs754.github.io/claimcheck/)

## Benefits
- **Catches false "done" claims.** Agents often say "added tests" when no test file changed. ClaimCheck shows it before a human approves.
- **Saves reviewer time.** A reviewer sees at a glance which parts of the summary to trust and which to check.
- **Quiet by default.** No comment when every claim matches. One comment per PR, updated on each push.
- **No AI, no server.** Plain rules over the git diff. Fast, free, repeatable, and no code leaves CI.

## What the PR comment looks like
From the [demo](examples/demo): an agent wrote a nice summary, but the diff tells another story.

> ### ❌ ClaimCheck: 5 of 6 claims in the PR description don't match the diff
>
> | | Claim | PR says | What the diff shows |
> |---|---|---|---|
> | ❌ | Tests added | "Added unit tests for the retry logic" | No test file has new lines. Code changed in `src/payments/client.ts`, `src/payments/gateway.ts`. |
> | ❌ | No breaking changes | "No breaking changes, fully backward compatible" | Removed export `refundLegacy` in `src/payments/client.ts`. Signature changed for `charge` in `src/payments/client.ts`. |
> | ❌ | Errors handled | "Handled errors from the gateway with proper error handling" | No new try/catch, .catch(), throw or error check in the changed code. |
> | ❌ | No new dependencies | "No new dependencies" | New dependency: `p-retry` (package.json). |
> | ❌ | No debug logs | "Removed leftover console.log statements" | New console.log or debugger at `src/payments/client.ts:10`. |
> | ✅ | Docs updated | "Updated the README with the new config" | Docs changed: `README.md`. |

## How to use it

### 1. Add the workflow
Create `.github/workflows/claimcheck.yml` (also in [examples/workflow](examples/workflow/claimcheck.yml)):
```yaml
name: ClaimCheck
on:
  pull_request:
    types: [opened, edited, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  claimcheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # needed to diff against the base branch
      - uses: rahulcs754/claimcheck@main
```
`edited` makes it re-check when someone fixes the description.

### 2. Open a PR
Write the description as usual (or let your agent write it). ClaimCheck posts a comment only if a claim does not match. If you later fix the code or the text, the same comment updates to ✅.

### Options
| Input | Default | What it does |
|---|---|---|
| `fail-on-mismatch` | `false` | Fail the check when a claim is not supported. Use it with branch protection to block the merge. |
| `comment` | `true` | Post or update one PR comment. |
| `comment-on` | `mismatch` | `mismatch` = comment only when something fails. `always` = comment on every PR. |
| `base` | `origin/<base branch>` | Ref to diff against. |
| `working-directory` | `.` | Folder to run in. |

The report is also written to the job summary.

### Run it locally (or from your agent)
```bash
npx github:rahulcs754/claimcheck --body-file pr.md --base origin/main
npx github:rahulcs754/claimcheck --body "Added tests. No breaking changes." --base main --json
```
Tip: ask your coding agent to run this before it opens a PR, so it fixes its own summary.

## What it checks
| Claim in the PR text | Checked against the diff |
|---|---|
| "added / updated tests", "with unit tests" | A test file (`*.test.*`, `*.spec.*`, `__tests__/`, `tests/`, `test_*.py`, `*_test.go` …) has new lines. New `it.skip` / `.only` → ⚠️ |
| "no breaking changes", "backward compatible" | No exported name removed from source files (JS/TS). Changed function params → ⚠️ |
| "handled errors", "error handling", "try/catch" | New `try`, `catch`, `.catch(`, `throw`, `if err != nil`, `except` … in code |
| "updated docs / README", "documented" | A `.md` / `docs/` file changed, or new doc comments |
| "updated changelog" | `CHANGELOG*` or `.changeset/` changed |
| "added a migration" | A file in a `migrations/` folder changed |
| "no new dependencies" | No new entry in `package.json`, `requirements*.txt`, `go.mod`, `Cargo.toml` |
| "no `any`", "fully typed", "type safe" | No new `: any`, `as any` or `@ts-ignore` in TypeScript |
| "removed console.log", "no debug logs" | No new `console.log` / `debugger` in shipped code |
| "no TODOs" | No new `TODO` / `FIXME` |
| "one-line fix", "small change" | Size of the code change |

It skips negated or future text ("did not add tests", "will add tests later"), questions, code blocks, HTML comments and unchecked `- [ ]` boxes.

## Limits
- Rule-based: it understands common phrasings, not every sentence. Unknown claims are ignored, never guessed.
- "Errors handled" checks that error handling was added, not that it is correct.
- Breaking-change check covers JS/TS exports only.

## Develop
```bash
npm install
npm test          # vitest
npm run typecheck
npm run build     # bundles dist/cli.js (commit it; the Action runs it)
```

## License
MIT
