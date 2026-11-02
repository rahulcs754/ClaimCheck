import { describe, expect, it } from 'vitest';
import { findClaims, sentences } from '../src/claims.js';

const rules = (body: string) => findClaims(body).map((c) => c.rule);

describe('sentences', () => {
  it('drops code blocks, HTML comments, quotes and unchecked boxes', () => {
    const s = sentences(`<!-- Added tests? -->
\`\`\`
added tests
\`\`\`
> Added tests in a quote
- [ ] Added tests
- [x] Updated docs
**Bold.** Second sentence!`);
    expect(s).toEqual(['Updated docs', 'Bold.', 'Second sentence!']);
  });
});

describe('findClaims', () => {
  it('finds common agent claims', () => {
    expect(rules('Added unit tests. No breaking changes. Handled errors from the API.')).toEqual([
      'tests',
      'no-breaking',
      'error-handling',
    ]);
  });

  it('skips negated and future claims', () => {
    expect(rules('Did not add tests yet.')).toEqual([]);
    expect(rules('I will add tests in a follow-up PR.')).toEqual([]);
    expect(rules('Should I add tests?')).toEqual([]);
    expect(rules('No docs update needed.')).toEqual([]);
  });

  it('keeps negative claims like "no new dependencies"', () => {
    expect(rules('No new dependencies. Removed all console.log calls. No TODOs left.')).toEqual([
      'no-new-deps',
      'no-console',
      'no-todo',
    ]);
  });

  it('recognises more phrasings', () => {
    expect(rules('Tests were added for the parser')).toEqual(['tests']);
    expect(rules('This is backward compatible')).toEqual(['no-breaking']);
    expect(rules('Wrapped the call in try/catch')).toEqual(['error-handling']);
    expect(rules('Updated CHANGELOG')).toEqual(['changelog']);
    expect(rules('Added a database migration for the new column')).toEqual(['migration']);
    expect(rules('The code is now fully typed')).toEqual(['no-any']);
    expect(rules('One-line fix for the null check')).toEqual(['small-change']);
  });

  it('ignores quoted examples and code', () => {
    expect(rules('It finds claims like "added tests" and "no breaking changes".')).toEqual([]);
    expect(rules('Renamed the `addTests` helper.')).toEqual([]);
    expect(rules('Rules: tests, no-breaking, error-handling.')).toEqual([]);
    expect(rules('This is a non-breaking change.')).toEqual(['no-breaking']);
    expect(rules('Added tests for the "parser" module.')).toEqual(['tests']);
  });

  it('returns one claim per rule', () => {
    const c = findClaims('Added tests for a.\nAdded tests for b.');
    expect(c).toEqual([{ rule: 'tests', text: 'Added tests for a.' }]);
  });
});
