# ClaimCheck MVP plan

## Goal
A GitHub Action + CLI that reads a PR description, finds claims, checks each against the diff, and comments on the claims that don't match.

## Scope (v0.1)
- [ ] Claim finder: split the PR body into sentences and bullets; match claim rules; skip negated text ("no tests needed", "did not add tests").
- [ ] Diff facts: parse `git diff base...HEAD` into files, added lines, removed lines.
- [ ] Rules:
  - [ ] tests: "added/updated tests", "with unit tests", "test coverage" → test file has added lines
  - [ ] no-breaking: "no breaking change", "backward compatible" → no exported name removed from source files
  - [ ] error-handling: "handled errors", "error handling", "try/catch" → added `try`, `catch`, `.catch(`, `throw` or error checks
  - [ ] docs: "updated docs/README" → `.md`/`docs/` changed
  - [ ] changelog: "updated changelog" → CHANGELOG changed
  - [ ] no-new-deps: "no new dependencies" → no new key in package.json deps
  - [ ] no-any: "no any", "fully typed" → no `: any` / `as any` added
  - [ ] no-console: "removed console.log", "no debug logs" → no `console.log` added
  - [ ] no-todo: "no TODOs" → no TODO/FIXME added
  - [ ] types/migration: "added migration" → migration file added
- [ ] Report: markdown comment with a table of claims (✅ supported / ❌ not supported / evidence). Comment only when something fails (option to always comment).
- [ ] Action: composite action running `dist/cli.js`, inputs `base`, `comment`, `comment-on`, `fail-on-mismatch`.
- [ ] CLI: `claimcheck --body-file pr.md --base origin/main` for local use and agents.
- [ ] Tests with vitest; demo fixture; README how-to; GitHub Pages site.

## Later
- Optional LLM mode for free-form claims.
- Config file to add custom claim rules.
- Check commit messages and agent chat summaries, not only the PR body.
