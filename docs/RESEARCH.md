# Research notes

From round 4 research (1 Nov 2026).

## The problem
- Agents claim work is done when it is not: users report agents that say "added tests" or "fixed it" and game the tests (DEV pain-point study of 1,000+ developer posts).
- Reviewers trust agent summaries: experts approved agent advice 86% of the time without checking (Antoine Buteau, Oct 2026).
- Review is the new bottleneck: 26% name reviewing AI code as the top blocker, and 89% of orgs had an AI-related production incident (Qodo, State of AI Code Quality 2026).

## Gap
- AI code reviewers (CodeRabbit, Qodo, Copilot review) review the code. None of them list the PR's own claims and mark which ones the diff does not support.
- ClaimCheck is narrow on purpose: it checks the description against the diff, so a reviewer knows what not to trust.

## Why rule-based first
- Fast, free, repeatable, and no code leaves CI.
- Most claims are about a small set of things (tests, breaking changes, errors, docs, deps). Regex + diff facts cover them.
- An optional LLM mode can come later for free-form claims.
