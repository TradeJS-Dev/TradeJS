import type {
  ReplayRuntimeComparisonSummary,
  ReplayRuntimeParityRow,
} from '../support';
import {
  buildNoExchangeEntriesReport,
  buildNoRuntimeTradesReport,
  buildReplayComparisonReport,
} from '../runtimeComparisonReporting';

const row = (
  strategyName: string,
  backtestNetProfit: number,
  runtimePnl: number,
): ReplayRuntimeParityRow => ({
  strategyName,
  backtestEntries: 2,
  backtestNetProfit,
  runtimeTrades: 2,
  runtimePnl,
  matched: 1,
  orderFailed: 0,
  runtimeOnly: 1,
  backtestOnly: 1,
});

describe('runtime comparison reporting', () => {
  it('renders runtime rows and both mismatch drilldowns', () => {
    const lines = buildReplayComparisonReport({
      mode: 'runtime',
      connectorName: 'bybit',
      rows: [
        row('Positive', 10, 5),
        row('Negative', -10, -5),
        row('Flat', 0, 0),
      ],
      details: {
        capped: false,
        limit: 10,
        matched: [],
        orderFailed: [],
        runtimeOnly: [],
        backtestOnly: [],
        nearestCandidates: [],
        mismatchDrilldown: {
          summary: {
            runtimeOnly: { gated_out: 1 },
            backtestOnly: { core_skipped: 2 },
          },
          runtimeOnly: [],
          backtestOnly: [],
        },
      } satisfies NonNullable<ReplayRuntimeComparisonSummary['details']>,
    });

    expect(lines.join('\n')).toContain(
      'SIGNALS REPLAY VS RUNTIME BY STRATEGY (connector=bybit',
    );
    expect(lines.join('\n')).toContain(
      'Mismatch drilldown: runtimeOnly=[gated_out=1], backtestOnly=[core_skipped=2]',
    );
    expect(lines.join('\n')).toContain('Positive');
    expect(lines.join('\n')).toContain('Negative');
    expect(lines.join('\n')).toContain('Flat');
  });

  it('renders exchange inference and omits an empty drilldown', () => {
    const lines = buildReplayComparisonReport({
      mode: 'exchange',
      connectorName: 'bybit',
      rows: [row('TrendShift', 0, 0)],
      details: undefined,
    });

    expect(lines.join('\n')).toContain(
      'inferredStrategy=orderLinkId | nearest backtest entry',
    );
    expect(lines.join('\n')).not.toContain('Mismatch drilldown:');
  });

  it('renders explicit fallback messages for missing runtime and exchange evidence', () => {
    const context = {
      connectorName: 'bybit',
      window: { start: 100, end: 200 },
    };

    expect(buildNoRuntimeTradesReport(context).join('\n')).toContain(
      'checking lineage-linked exchange executions',
    );
    expect(buildNoExchangeEntriesReport(context).join('\n')).toContain(
      'no lineage-linked exchange entry executions found',
    );
  });
});
