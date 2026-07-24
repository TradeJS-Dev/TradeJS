import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeReplayOutputReport } from '../lib/replay/outputReport';
import { getReplayRuntimeUnmatchedCount } from '../lib/replay/support';

describe('writeReplayOutputReport', () => {
  it('counts every non-matched runtime comparison outcome', () => {
    expect(
      getReplayRuntimeUnmatchedCount({
        orderFailed: 2,
        runtimeOnly: 3,
        backtestOnly: 4,
      }),
    ).toBe(9);
  });

  it('writes markdown and json replay reports with per-trade analysis', async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tradejs-replay-report-'),
    );

    try {
      const runtimeLineage = {
        schemaVersion: 1 as const,
        gitSha: 'abc123',
        gitDirty: false,
        gateFingerprint: 'gate123',
        configFingerprint: 'config123',
        contextFingerprint: 'context123',
      };
      const runtimeEntry = {
        source: 'runtime' as const,
        strategy: 'TestStrategy',
        symbol: 'ABCUSDT',
        direction: 'LONG',
        timestamp: 1_781_049_600_000,
        price: 10.1,
        exitType: 'exit',
        exitTimestamp: 1_781_053_200_000,
        exitPrice: 10.4,
        pnl: 0.25,
      };
      const backtestEntry = {
        source: 'backtest' as const,
        strategy: 'TestStrategy',
        symbol: 'ABCUSDT',
        direction: 'LONG',
        timestamp: 1_781_049_600_000,
        comparisonTimestamp: 1_781_050_500_000,
        price: 10,
        exitType: 'exit',
        exitTimestamp: 1_781_053_200_000,
        exitPrice: 10.35,
        pnl: 0.2,
        signalId: 'bt-signal-1',
      };
      const backtestOnlyEntry = {
        source: 'backtest' as const,
        strategy: 'TestStrategy',
        symbol: 'XYZUSDT',
        direction: 'SHORT',
        timestamp: 1_781_050_500_000,
        comparisonTimestamp: 1_781_051_400_000,
        price: 4,
        exitType: 'sl',
        exitTimestamp: 1_781_052_300_000,
        exitPrice: 4.2,
        pnl: -0.1,
        signalId: 'bt-signal-2',
      };

      const paths = await writeReplayOutputReport({
        projectRoot,
        timestamp: '202606102257',
        replayKey: 'users:root:backtests:results:replay:202606102257',
        userName: 'root',
        connectorName: 'ByBit',
        interval: '15',
        tickers: ['ABCUSDT', 'XYZUSDT'],
        window: {
          start: 1_781_028_001_198,
          end: 1_781_114_401_198,
        },
        durationSeconds: 12.34,
        replayResult: {
          strategies: [],
          signals: [],
          orderLog: [],
          positionLog: [],
          cycleCount: 96,
          abortedCycles: 0,
          runtimeLineages: [
            {
              strategy: 'TestStrategy',
              symbol: 'ABCUSDT',
              lineage: runtimeLineage,
            },
          ],
        },
        strategySnapshot: {
          summaries: [
            {
              strategyName: 'TestStrategy',
              strategyConfig: {},
              tickers: 2,
              tickersWithTrades: 1,
              orders: 1,
              wins: 1,
              losses: 0,
              netProfit: 0.2,
              avgTradeProfit: 0.2,
              winRate: 100,
            },
          ],
          backtestEntries: [],
        },
        runtimeComparison: {
          mode: 'runtime',
          syncedTradesCount: 1,
          windowTradesCount: 1,
          runtimeEntriesCount: 1,
          backtestEntriesCount: 2,
          matchedCount: 1,
          runtimeOnlyCount: 0,
          backtestOnlyCount: 1,
          rows: [
            {
              strategyName: 'TestStrategy',
              backtestEntries: 2,
              backtestNetProfit: 0.1,
              runtimeTrades: 1,
              runtimePnl: 0.25,
              matched: 1,
              orderFailed: 0,
              runtimeOnly: 0,
              backtestOnly: 1,
            },
          ],
          details: {
            capped: false,
            limit: 100,
            matched: [
              {
                runtime: runtimeEntry,
                backtest: backtestEntry,
                timestampDiffMs: 0,
                priceDeltaPct: 1,
                exitTimestampDiffMs: 0,
                exitPriceDeltaPct: 0.48,
                exitType: {
                  expected: 'exit',
                  actual: 'exit',
                  matches: true,
                },
                pnl: {
                  expectedPnl: 0.2,
                  realizedPnl: 0.25,
                  delta: 0.05,
                },
                slippage: {
                  entryPriceDeltaPct: 1,
                  exitPriceDeltaPct: 0.48,
                  entryCost: -0.1,
                  exitCost: 0.05,
                  totalCost: -0.05,
                },
              },
            ],
            orderFailed: [],
            runtimeOnly: [],
            backtestOnly: [backtestOnlyEntry],
            nearestCandidates: [],
            mismatchDrilldown: {
              runtimeOnly: [],
              backtestOnly: [
                {
                  entry: backtestOnlyEntry,
                  classification: 'no_runtime_evaluation',
                  reason: 'no_runtime_signal_or_evaluation',
                },
              ],
              summary: {
                runtimeOnly: {},
                backtestOnly: {
                  no_runtime_evaluation: 1,
                },
              },
            },
          },
          orderFailedCount: 0,
          lineage: {
            enforced: true,
            replayScopes: 1,
            comparableScopes: 1,
            excludedRuntimeTrades: 0,
            excludedRuntimeSignals: 0,
            excludedRuntimeEvaluations: 0,
            excludedRuntimeLineageScopes: 0,
            excludedExchangeEntries: 0,
            excludedBacktestEntries: 0,
            reason: null,
            replay: [
              {
                strategy: 'TestStrategy',
                symbol: 'ABCUSDT',
                lineage: runtimeLineage,
              },
            ],
          },
        },
      });

      expect(paths.markdownPath).toBe(
        path.join(
          projectRoot,
          'data/replay/output/202606102257-replay-report.md',
        ),
      );
      expect(paths.jsonPath).toBe(
        path.join(
          projectRoot,
          'data/replay/output/202606102257-replay-report.json',
        ),
      );

      const markdown = await fs.readFile(paths.markdownPath, 'utf8');
      expect(markdown).toContain('## Matched Trades');
      expect(markdown).toContain('ABCUSDT');
      expect(markdown).toContain('XYZUSDT');
      expect(markdown).toContain('no_runtime_signal_or_evaluation');
      expect(markdown).toContain('| Unmatched |');

      const json = JSON.parse(await fs.readFile(paths.jsonPath, 'utf8'));
      expect(json.reportType).toBe('replay-output');
      expect(json.counts).toMatchObject({
        tickers: 2,
        matched: 1,
        runtimeOnly: 0,
        backtestOnly: 1,
      });
      expect(json.perTradeAnalysis.matched).toHaveLength(1);
      expect(json.perTradeAnalysis.backtestOnly[0].drilldown).toMatchObject({
        classification: 'no_runtime_evaluation',
        reason: 'no_runtime_signal_or_evaluation',
      });
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  });
});
