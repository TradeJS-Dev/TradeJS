import {
  assertDiffAllowed,
  buildResearchAgentBranchName,
  buildResearchAgentCommitMessage,
  getResearchAgentAllowedPathPrefixes,
  getResearchAgentNotePath,
  normalizeDiffOutput,
  parseChangedFilesFromDiff,
  toUpperSnakeCase,
} from '../lib/researchAgent';

describe('research agent helpers', () => {
  it('builds upper snake strategy token for fallback notes', () => {
    expect(toUpperSnakeCase('TrendLine')).toBe('TREND_LINE');
    expect(toUpperSnakeCase('AdaptiveMomentumRibbon')).toBe(
      'ADAPTIVE_MOMENTUM_RIBBON',
    );
  });

  it('builds deterministic branch and commit names', () => {
    expect(buildResearchAgentBranchName('TrendLine', '171-test-run')).toBe(
      'codex/research/trend-line-171-test-run',
    );
    expect(buildResearchAgentCommitMessage('TrendLine', '171-test-run')).toBe(
      'Research agent: TrendLine follow-up for 171-test-run',
    );
  });

  it('returns allowed strategy and note paths', () => {
    expect(getResearchAgentNotePath('TrendLine')).toBe(
      'notes/AI_TRENDLINE_REPLAY_NOTES.md',
    );
    expect(getResearchAgentAllowedPathPrefixes('TrendLine')).toEqual([
      'packages/strategies/src/TrendLine/',
      'notes/AI_TRENDLINE_REPLAY_NOTES.md',
    ]);
  });

  it('normalizes markdown fenced diff output', () => {
    expect(normalizeDiffOutput('```diff\ndiff --git a/a.ts b/a.ts\n```')).toBe(
      'diff --git a/a.ts b/a.ts',
    );
  });

  it('parses changed files from unified diff', () => {
    const diff = [
      'diff --git a/packages/strategies/src/TrendLine/config.ts b/packages/strategies/src/TrendLine/config.ts',
      '--- a/packages/strategies/src/TrendLine/config.ts',
      '+++ b/packages/strategies/src/TrendLine/config.ts',
      '@@',
      '-old',
      '+new',
      'diff --git a/notes/AI_TRENDLINE_REPLAY_NOTES.md b/notes/AI_TRENDLINE_REPLAY_NOTES.md',
      '--- /dev/null',
      '+++ b/notes/AI_TRENDLINE_REPLAY_NOTES.md',
      '@@',
      '+note',
    ].join('\n');

    expect(parseChangedFilesFromDiff(diff)).toEqual([
      'packages/strategies/src/TrendLine/config.ts',
      'notes/AI_TRENDLINE_REPLAY_NOTES.md',
    ]);
  });

  it('rejects disallowed paths and deletions', () => {
    expect(() =>
      assertDiffAllowed(
        [
          'diff --git a/package.json b/package.json',
          '--- a/package.json',
          '+++ b/package.json',
          '@@',
          '-x',
          '+y',
        ].join('\n'),
        getResearchAgentAllowedPathPrefixes('TrendLine'),
      ),
    ).toThrow('disallowed path');

    expect(() =>
      assertDiffAllowed(
        [
          'diff --git a/packages/strategies/src/TrendLine/config.ts b/packages/strategies/src/TrendLine/config.ts',
          '--- a/packages/strategies/src/TrendLine/config.ts',
          '+++ /dev/null',
        ].join('\n'),
        getResearchAgentAllowedPathPrefixes('TrendLine'),
      ),
    ).toThrow('must not delete');
  });
});
