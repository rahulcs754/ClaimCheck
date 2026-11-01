# ClaimCheck

**Does the PR do what it says?** ClaimCheck is a GitHub Action that reads the PR description (often written by an AI agent), finds claims like "added tests", "no breaking changes" or "handled errors", and checks each one against the real diff. It comments only when a claim does not match.

> Status: planning. The MVP is being built. See [docs/MVP-PLAN.md](docs/MVP-PLAN.md).

## Why
AI agents write PR summaries fast, and reviewers trust them. But agents often say "added tests" when no test file changed, or "no breaking changes" when an export was removed. ClaimCheck catches these before a human approves.

## Planned checks (MVP)
- "Added tests" → a test file has new lines
- "No breaking changes" → no exported name was removed
- "Handled errors" → new `try/catch`, `.catch(` or error checks were added
- "Updated docs / README / changelog" → those files changed
- "No new dependencies" → `package.json` dependencies did not grow
- "No `any`", "removed console.log", "no TODOs" → the added lines agree

No AI, no server, no data leaves CI. Plain rules, so results are fast and repeatable.

## License
MIT
