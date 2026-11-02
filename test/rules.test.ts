import { describe, expect, it } from 'vitest';
import { exportNames, newDependencies, RULES } from '../src/rules.js';
import { file } from './helpers.js';

const rule = (id: string) => RULES.find((r) => r.id === id)!;
const verdict = (id: string, files: Parameters<(typeof RULES)[number]['check']>[0], claim = '') => rule(id).check(files, claim).verdict;

describe('tests rule', () => {
  it('needs a test file with new lines', () => {
    expect(verdict('tests', [file('src/a.ts', ['x'])])).toBe('unsupported');
    expect(verdict('tests', [file('src/a.ts', ['x']), file('src/a.test.ts', ['it("x", () => {})'])])).toBe('supported');
    expect(verdict('tests', [file('tests/test_api.py', ['def test_x(): pass'])])).toBe('supported');
    expect(verdict('tests', [file('src/a.test.ts', [], ['old'], 'deleted')])).toBe('unsupported');
  });
  it('flags new skipped tests as unclear', () => {
    expect(verdict('tests', [file('src/a.test.ts', ['it.skip("x", () => {})'])])).toBe('unclear');
    expect(verdict('tests', [file('src/a.test.ts', ["  expect(f('it.skip(x)')).toBe(1)"])])).toBe('supported');
  });
});

describe('no-breaking rule', () => {
  it('reads export names', () => {
    expect(exportNames('export async function load(a) {')).toEqual(['load']);
    expect(exportNames('export default class Foo {}')).toEqual(['Foo']);
    expect(exportNames('export default foo;')).toEqual(['default']);
    expect(exportNames('export { a, b as c, type D }')).toEqual(['a', 'c', 'D']);
    expect(exportNames('const x = 1')).toEqual([]);
  });
  it('fails when an export is removed', () => {
    expect(verdict('no-breaking', [file('src/a.ts', [], ['export function gone() {'])])).toBe('unsupported');
  });
  it('passes when an export moved to another file', () => {
    expect(
      verdict('no-breaking', [file('src/a.ts', [], ['export function moved() {']), file('src/b.ts', ['export function moved() {'])]),
    ).toBe('supported');
  });
  it('is unclear when a function signature changed', () => {
    expect(verdict('no-breaking', [file('src/a.ts', ['export function f(a, b) {'], ['export function f(a) {'])])).toBe('unclear');
  });
  it('ignores exports in tests', () => {
    expect(verdict('no-breaking', [file('src/a.test.ts', [], ['export const fixture = 1'])])).toBe('supported');
  });
});

describe('error-handling rule', () => {
  it('looks for error handling in added code', () => {
    expect(verdict('error-handling', [file('src/a.ts', ['return fetch(url)'])])).toBe('unsupported');
    expect(verdict('error-handling', [file('src/a.ts', ['try {', '} catch (e) {'])])).toBe('supported');
    expect(verdict('error-handling', [file('src/a.ts', ['  .catch(() => null)'])])).toBe('supported');
    expect(verdict('error-handling', [file('main.go', ['if err != nil {'])])).toBe('supported');
    // a comment is not code
    expect(verdict('error-handling', [file('src/a.ts', ['// try { later'])])).toBe('unsupported');
  });
});

describe('docs and changelog rules', () => {
  it('accepts markdown, docs folder or doc comments', () => {
    expect(verdict('docs', [file('src/a.ts', ['x'])])).toBe('unsupported');
    expect(verdict('docs', [file('README.md', ['new'])])).toBe('supported');
    expect(verdict('docs', [file('docs/bundle.js', ['x'])])).toBe('unsupported');
    expect(verdict('docs', [file('src/a.ts', ['/**', ' * @param x the value'])])).toBe('supported');
  });
  it('needs a changelog file', () => {
    expect(verdict('changelog', [file('CHANGELOG.md', ['- fix'])])).toBe('supported');
    expect(verdict('changelog', [file('.changeset/brave-cats.md', ['---'])])).toBe('supported');
    expect(verdict('changelog', [file('README.md', ['x'])])).toBe('unsupported');
  });
});

describe('dependency rule', () => {
  it('finds new package.json dependencies but not version bumps or scripts', () => {
    const deps = newDependencies([
      file('package.json', ['  "version": "1.1.0",', '    "lodash": "^4.17.21",', '    "build": "tsup",', '    "react": "^19.0.0"'], ['  "version": "1.0.0",', '    "react": "^18.3.1"']),
    ]);
    expect(deps).toEqual(['`lodash` (package.json)']);
  });
  it('reads requirements.txt and go.mod', () => {
    expect(newDependencies([file('requirements.txt', ['requests==2.32.0', '# comment'])])).toEqual(['`requests` (requirements.txt)']);
    expect(newDependencies([file('go.mod', ['\tgithub.com/pkg/errors v0.9.1'])])).toEqual(['`github.com/pkg/errors` (go.mod)']);
  });
});

describe('hygiene rules', () => {
  it('no-any', () => {
    expect(verdict('no-any', [file('src/a.ts', ['const x: any = 1'])])).toBe('unsupported');
    expect(verdict('no-any', [file('src/a.ts', ['// @ts-ignore'])])).toBe('unsupported');
    expect(verdict('no-any', [file('src/a.ts', ['const x: unknown = 1'])])).toBe('supported');
    expect(verdict('no-any', [file('src/a.test.ts', ['const x = y as any'])])).toBe('supported');
  });
  it('no-console ignores tests', () => {
    expect(verdict('no-console', [file('src/a.ts', ['console.log(x)'])])).toBe('unsupported');
    expect(verdict('no-console', [file('src/a.test.ts', ['console.log(x)'])])).toBe('supported');
  });
  it('no-todo', () => {
    expect(verdict('no-todo', [file('src/a.ts', ['// TODO: later'])])).toBe('unsupported');
    expect(verdict('no-todo', [file('docs/plan.md', ['TODO list'])])).toBe('supported');
  });
  it('small-change is strict for "one-line"', () => {
    const f = [file('src/a.ts', ['a', 'b', 'c'], ['d', 'e'])];
    expect(verdict('small-change', f, 'One-line fix')).toBe('unsupported');
    expect(verdict('small-change', f, 'Small fix')).toBe('supported');
  });
});
