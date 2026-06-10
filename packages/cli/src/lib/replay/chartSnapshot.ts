import type {
  StrategyChartOrder,
  StrategyChartSnapshot,
  StrategyChartsSnapshotResponse,
} from '@tradejs/types';
import type { HistoricalSignalsReplayResult } from './historicalSignalsReplay';

const formatPercent = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(1)}%`
    : 'n/a';

const formatSigned = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
    : 'n/a';

const toSimpleOrderLog = (
  orderLog: HistoricalSignalsReplayResult['strategies'][number]['orderLog'],
) =>
  orderLog.map((entry) => [entry.timestamp, entry.amount] as [number, number]);

const toReplayChartOrders = (
  orderLog: HistoricalSignalsReplayResult['strategies'][number]['orderLog'],
): StrategyChartOrder[] =>
  orderLog.map((entry, index) => {
    const isOpenOrder = entry.type.startsWith('OPEN');
    const equityBefore =
      orderLog[index - 1]?.amount ??
      (Number.isFinite(entry.amount) && Number.isFinite(entry.profit)
        ? entry.amount - entry.profit
        : null);

    return {
      id: `${entry.index}:${entry.timestamp}:${entry.type}`,
      symbol: entry.symbol,
      direction: entry.direction,
      timestamp: entry.timestamp,
      entryTimestamp: entry.timestamp,
      exitTimestamp: isOpenOrder ? null : entry.timestamp,
      exitReason: entry.type,
      pnl: entry.profit,
      equityBefore,
      equityAfter: entry.amount,
      qty: entry.qty,
      notional: entry.qty * entry.price,
      requestedEntryPrice: isOpenOrder ? entry.price : null,
      entryPrice: isOpenOrder ? entry.price : null,
      requestedExitPrice: isOpenOrder ? null : entry.price,
      exitPrice: isOpenOrder ? null : entry.price,
      openFee: isOpenOrder ? entry.fee ?? null : null,
      closeFee: isOpenOrder ? null : entry.fee ?? null,
      fundingFee: null,
      totalFee: entry.fee ?? null,
      sequence: entry.index + 1,
    };
  });

export const buildReplayChartSnapshot = (params: {
  replayResult: HistoricalSignalsReplayResult;
  generatedAt: number;
  runLabel: string;
}) => {
  const { replayResult, generatedAt, runLabel } = params;
  const strategies: StrategyChartSnapshot[] = replayResult.strategies.map(
    ({ strategyName, strategyConfig, orderLog, stat }) => ({
      cardId: `${strategyName}-${generatedAt}`,
      generatedAt,
      strategyName,
      title: strategyName,
      subtitle: runLabel,
      symbols: [
        ...new Set(orderLog.map((entry) => entry.symbol).filter(Boolean)),
      ],
      orderLog: toSimpleOrderLog(orderLog),
      orders: toReplayChartOrders(orderLog),
      stat,
      metrics: [
        {
          id: 'orders',
          label: 'Orders',
          value: String(stat?.orders ?? 0),
        },
        {
          id: 'winRate',
          label: 'Win Rate',
          value: formatPercent(stat?.winRate ?? null),
        },
        {
          id: 'pnl',
          label: 'P&L',
          value: formatSigned(stat?.netProfit ?? null),
          tone:
            (stat?.netProfit ?? 0) > 0
              ? 'success'
              : (stat?.netProfit ?? 0) < 0
                ? 'error'
                : 'neutral',
        },
        {
          id: 'drawdown',
          label: 'Drawdown',
          value: formatPercent(stat?.maxDrawdown ?? null),
        },
        {
          id: 'sharpe',
          label: 'Sharpe',
          value:
            typeof stat?.sharpeRatio === 'number'
              ? stat.sharpeRatio.toFixed(2)
              : 'n/a',
        },
        {
          id: 'exposure',
          label: 'Exposure',
          value: formatPercent(stat?.exposure ?? null),
        },
      ],
      tags:
        Object.keys(strategyConfig || {}).length > 0
          ? [`params:${Object.keys(strategyConfig || {}).length}`]
          : undefined,
    }),
  );

  return {
    mode: 'replay',
    generatedAt,
    runLabel,
    strategies,
  } satisfies StrategyChartsSnapshotResponse;
};
