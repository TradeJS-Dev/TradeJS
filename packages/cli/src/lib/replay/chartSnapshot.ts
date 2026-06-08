import type {
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
