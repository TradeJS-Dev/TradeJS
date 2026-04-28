import {
  assertDiffAllowed,
  buildResearchAgentBranchName,
  buildResearchAgentCommitMessage,
  buildResearchAgentPrBody,
  buildResearchAgentPrTitle,
  getResearchAgentAllowedPathPrefixes,
  getResearchAgentNotePath,
  normalizeDiffOutput,
  parseChangedFilesFromDiff,
  parseGithubRepositoryFromRemote,
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
    expect(buildResearchAgentPrTitle('TrendLine', '171-test-run')).toBe(
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

  it('parses GitHub repository from ssh and https remotes', () => {
    expect(
      parseGithubRepositoryFromRemote('git@github.com:TradeJS-Dev/TradeJS.git'),
    ).toBe('TradeJS-Dev/TradeJS');
    expect(
      parseGithubRepositoryFromRemote(
        'https://github.com/TradeJS-Dev/TradeJS.git',
      ),
    ).toBe('TradeJS-Dev/TradeJS');
    expect(parseGithubRepositoryFromRemote('git@example.com:foo/bar.git')).toBe(
      null,
    );
  });

  it('builds PR body with why/what/validation sections', () => {
    const body = buildResearchAgentPrBody({
      strategy: 'TrendLine',
      runId: '171-test-run',
      config: 'TrendLine:research',
      connector: 'bybit',
      timeframe: '15',
      days: 45,
      recent: 1000,
      changedFiles: [
        'packages/strategies/src/TrendLine/config.ts',
        'notes/AI_TRENDLINE_REPLAY_NOTES.md',
      ],
      validation: {
        prettify: 'passed',
        typecheck: 'passed',
        unit: 'passed',
      },
      summary: 'Committed validated patch on branch codex/research/trend-line',
      aiTrainLocal: {
        run: {
          totalRows: 100,
          approvedRows: 24,
          minQuality: 4,
        },
        outcome: {
          approvalRate: 0.24,
          precisionApproved: 0.75,
          recallWinners: 0.31,
          avgProfitApproved: 1.42,
          avgProfitApprovedPerMonth: 12.8,
          expectancyDelta: 0.53,
        },
      },
    });

    expect(body).toContain('## Why');
    expect(body).toContain('## What changed');
    expect(body).toContain('## Validation');
    expect(body).toContain('TrendLine:research');
    expect(body).toContain('packages/strategies/src/TrendLine/config.ts');
    expect(body).toContain('`prettify`: passed');
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
