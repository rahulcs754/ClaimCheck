export interface DiffLine {
  /** Line number in the new file (added) or old file (removed). */
  n: number;
  text: string;
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  added: DiffLine[];
  removed: DiffLine[];
}

export type Verdict = 'supported' | 'unsupported' | 'unclear';

export interface Claim {
  /** Rule id, e.g. "tests". */
  rule: string;
  /** The sentence from the PR description that made the claim. */
  text: string;
}

export interface CheckResult {
  rule: string;
  label: string;
  claim: string;
  verdict: Verdict;
  evidence: string;
}

export interface Rule {
  id: string;
  /** Short name shown in the report, e.g. "Tests added". */
  label: string;
  /** Any match marks the sentence as a claim for this rule. */
  claim: RegExp[];
  /**
   * Positive claims ("added tests") are skipped when a negation word comes
   * just before the match ("did not add tests"). Negative claims
   * ("no breaking changes") already contain a negation, so they opt out.
   */
  negatable: boolean;
  check(files: FileDiff[], claim: string): { verdict: Verdict; evidence: string };
}
