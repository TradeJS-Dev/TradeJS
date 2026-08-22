import type { ExchangeEntryRecord } from '@tradejs/types';
import type { TradeParityEntry } from '../../runtimeParity';
import type { ReplayStrategySummary } from '../support';
import {
  buildExchangeComparisonRows,
  buildRuntimeComparisonRows,
} from '../runtimeComparisonCalculations';

const backtestEntry = (id: string, expectedPnl: number): TradeParityEntry => ({
  id,
  source: 'backtest',
  strategy: 'TrendShift',
  symbol: 'BTCUSDT',
  direction: 'LONG',
  timestamp: 100,
  price: 100,
  expectedPnl,
});

const exchangeEntry = (
  timestamp: number,
  closedPnl?: number,
): ExchangeEntryRecord => ({
  symbol: 'BTCUSDT',
  direction: 'LONG',
  qty: 1,
  entryPrice: 100,
  entryTimestamp: timestamp,
  ...(closedPnl == null ? {} : { closedPnl }),
});

const strategySummary = (strategyName: string): ReplayStrategySummary => ({
  strategyName,
  strategyConfig: {},
  tickers: 0,
  tickersWithTrades: 0,
  orders: 0,
  wins: 0,
  losses: 0,
  netProfit: 0,
  avgTradeProfit: 0,
  winRate: 0,
});

describe('runtime comparison row calculations', () => {
  it('aggregates matched, failed, exchange-only and backtest-only rows', () => {
    const matchedBacktest = backtestEntry('matched', 5);
    const failedBacktest = backtestEntry('failed', 3);
    const backtestOnly = backtestEntry('backtest-only', 2);
    const rows = buildExchangeComparisonRows({
      liveStrategySummaries: [strategySummary('TrendShift')],
      backtestEntries: [matchedBacktest, failedBacktest, backtestOnly],
      matched: [
        {
          exchange: exchangeEntry(100, 1.235),
          backtest: matchedBacktest,
          timestampDiffMs: 0,
          priceDeltaPct: 0,
        },
      ],
      orderFailed: [
        {
          exchange: exchangeEntry(101),
          backtest: failedBacktest,
          timestampDiffMs: 1,
          priceDeltaPct: 0,
          reason: 'ORDER_FAILED',
        },
      ],
      exchangeOnly: [exchangeEntry(200, -2)],
      strategyNameByOrderLinkKey: new Map(),
    });

    expect(rows).toEqual(
      [
        {
          strategyName: 'TrendShift',
          backtestEntries: 3,
          backtestNetProfit: 10,
          runtimeTrades: 2,
          runtimePnl: 1.24,
          matched: 1,
          orderFailed: 1,
          runtimeOnly: 0,
          backtestOnly: 1,
        },
        {
          strategyName: '[exchange-unmatched]',
          backtestEntries: 0,
          backtestNetProfit: 0,
          runtimeTrades: 1,
          runtimePnl: -2,
          matched: 0,
          orderFailed: 0,
          runtimeOnly: 1,
          backtestOnly: 0,
        },
      ].sort((left, right) =>
        left.strategyName.localeCompare(right.strategyName),
      ),
    );
  });

  it('builds runtime rows from the union of live, runtime and parity strategies', () => {
    const rows = buildRuntimeComparisonRows({
      liveStrategySummaries: [strategySummary('LiveOnly')],
      runtimeSummaries: [
        { strategyName: 'RuntimeOnly', trades: 2, totalPnl: 4 },
      ],
      parityRows: [
        [
          'ParityOnly',
          { backtest: 1, matched: 0, runtimeOnly: 0, backtestOnly: 1 },
        ],
      ],
      backtestEntries: [
        {
          ...backtestEntry('parity', 7),
          strategy: 'ParityOnly',
        },
      ],
    });

    expect(rows.map(({ strategyName }) => strategyName)).toEqual([
      'LiveOnly',
      'ParityOnly',
      'RuntimeOnly',
    ]);
    expect(rows[1]).toMatchObject({
      backtestEntries: 1,
      backtestNetProfit: 7,
      backtestOnly: 1,
    });
    expect(rows[2]).toMatchObject({ runtimeTrades: 2, runtimePnl: 4 });
  });
});
