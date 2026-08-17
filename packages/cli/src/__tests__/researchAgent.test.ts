import {
  assertDiffAllowed,
  buildResearchAgentBranchName,
  buildResearchAgentCommitMessage,
  buildResearchAgentPrBody,
  buildResearchAgentPrTitle,
  getResearchAgentRepository,
  getResearchAgentRepositoryName,
  getResearchAgentAllowedPathPrefixes,
  normalizeDiffOutput,
  parseChangedFilesFromDiff,
  parseGithubRepositoryFromRemote,
} from '../lib/researchAgent';

describe('research agent helpers', () => {
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

  it('allows only the strategy package path', () => {
    expect(getResearchAgentAllowedPathPrefixes('TrendLine')).toEqual([
      'src/TrendLine/',
    ]);
  });

  it('resolves standalone repositories with one TrendLine family exception', () => {
    expect(getResearchAgentRepositoryName('Breakout')).toBe(
      'TradeJS-Strategy-Breakout',
    );
    expect(getResearchAgentRepositoryName('TrendLine')).toBe(
      'TradeJS-Strategy-TrendLine',
    );
    expect(getResearchAgentRepositoryName('ReverseTrendLine')).toBe(
      'TradeJS-Strategy-TrendLine',
    );
    expect(getResearchAgentRepository('TrendLine')).toBe(
      'TradeJS-Dev/TradeJS-Strategy-TrendLine',
    );
  });

  it('normalizes markdown fenced diff output', () => {
    expect(normalizeDiffOutput('```diff\ndiff --git a/a.ts b/a.ts\n```')).toBe(
      'diff --git a/a.ts b/a.ts',
    );
  });

  it('parses changed files from unified diff', () => {
    const diff = [
      'diff --git a/src/TrendLine/config.ts b/src/TrendLine/config.ts',
      '--- a/src/TrendLine/config.ts',
      '+++ b/src/TrendLine/config.ts',
      '@@',
      '-old',
      '+new',
      'diff --git a/notes/TrendLine/2026-08-10-test-run.md b/notes/TrendLine/2026-08-10-test-run.md',
      '--- /dev/null',
      '+++ b/notes/TrendLine/2026-08-10-test-run.md',
      '@@',
      '+note',
    ].join('\n');

    expect(parseChangedFilesFromDiff(diff)).toEqual([
      'src/TrendLine/config.ts',
      'notes/TrendLine/2026-08-10-test-run.md',
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
      changedFiles: ['src/TrendLine/config.ts', 'src/TrendLine/core.test.ts'],
      validation: {
        checks: 'passed',
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
    expect(body).toContain('src/TrendLine/config.ts');
    expect(body).toContain('`checks`: passed');
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
          'diff --git a/notes/TrendLine/2026-08-10-test-run.md b/notes/TrendLine/2026-08-10-test-run.md',
          '--- /dev/null',
          '+++ b/notes/TrendLine/2026-08-10-test-run.md',
          '@@',
          '+note',
        ].join('\n'),
        getResearchAgentAllowedPathPrefixes('TrendLine'),
      ),
    ).toThrow('disallowed path');

    expect(() =>
      assertDiffAllowed(
        [
          'diff --git a/src/TrendLine/config.ts b/src/TrendLine/config.ts',
          '--- a/src/TrendLine/config.ts',
          '+++ /dev/null',
        ].join('\n'),
        getResearchAgentAllowedPathPrefixes('TrendLine'),
      ),
    ).toThrow('must not delete');
  });
});
