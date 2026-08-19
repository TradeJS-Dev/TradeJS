import { calculateAdvancedTradeMetrics } from '@tradejs/core/backtest';
import type { StrategyChartSnapshot } from '@tradejs/types';
import { formatInteger } from '#components/Shared/OrdersDrawer';
import {
  buildStrategyPerformanceViewModel,
  calculateMaxLossStreak,
  formatMaxDrawdownPercent as calculateMaxDrawdownPercent,
} from '#app/lib/strategyPerformance';
import {
  buildSnapshotAdvancedTrades,
  buildSnapshotOrders,
  buildSnapshotSummaryMetrics,
} from './StrategySnapshotCard.orders.presenter';
import {
  buildAiDiagnosticGroups,
  buildDirectionStatGroups,
  sortAiDrawerMetrics,
} from './StrategySnapshotCard.diagnostics.presenter';
import { buildSymbolPnlRanking } from './StrategySnapshotCard.ranking.presenter';

export { SNAPSHOT_ORDER_ROW_HEIGHT } from './StrategySnapshotCard.orders.presenter';
export {
  getMetricColor,
  type AiDiagnosticGroup,
  type AiDiagnosticMetric,
  type DirectionMetric,
  type DirectionStatGroup,
} from './StrategySnapshotCard.diagnostics.presenter';
export {
  getPnlBarColor,
  type SymbolPnlRank,
} from './StrategySnapshotCard.ranking.presenter';

const formatDatasetCreatedAt = (datasetId?: string) => {
  if (!datasetId || !/^\d{12,}$/.test(datasetId)) {
    return '';
  }

  const timestamp = Number(datasetId);
  if (!Number.isSafeInteger(timestamp)) {
    return '';
  }

  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

export const buildStrategySnapshotCardViewModel = (
  snapshot: StrategyChartSnapshot,
  mode: 'replay' | 'ai',
) => {
  const snapshotOrders = buildSnapshotOrders(snapshot, mode);
  const symbolPnlRanking = buildSymbolPnlRanking(snapshot.details);
  const performance = buildStrategyPerformanceViewModel(snapshot.orderLog);
  const maxLossStreak = calculateMaxLossStreak(snapshot.orderLog);
  const drawerBaseMetrics =
    mode === 'ai'
      ? snapshot.metrics
          .filter((metric) => metric.id !== 'pnl')
          .map((metric) =>
            metric.id === 'quality' || metric.label === 'Quality'
              ? {
                  id: 'maxDrawdown',
                  label: 'Max drawdown',
                  value:
                    calculateMaxDrawdownPercent(snapshot.orderLog) ?? 'n/a',
                  tone: 'warning' as const,
                }
              : metric,
          )
      : snapshot.metrics;
  const firstPoint = snapshot.orderLog[0];
  const lastPoint = snapshot.orderLog[snapshot.orderLog.length - 1];
  const symbolsLabel =
    snapshot.symbols.length > 3
      ? `${snapshot.symbols.slice(0, 3).join(', ')} +${snapshot.symbols.length - 3}`
      : snapshot.symbols.join(', ') || 'n/a';

  return {
    snapshotOrders,
    aiDiagnosticGroups: buildAiDiagnosticGroups(snapshot.details),
    directionStatGroups: buildDirectionStatGroups(snapshot.details),
    symbolPnlRanking,
    topSymbolPnlRanking: [...symbolPnlRanking]
      .sort(
        (left, right) =>
          right.pnl - left.pnl || left.symbol.localeCompare(right.symbol),
      )
      .slice(0, 10),
    worstSymbolPnlRanking: [...symbolPnlRanking]
      .sort(
        (left, right) =>
          left.pnl - right.pnl || left.symbol.localeCompare(right.symbol),
      )
      .slice(0, 10),
    symbolRankingMaxAbsPnl: Math.max(
      ...symbolPnlRanking.map((rank) => Math.abs(rank.pnl)),
      1,
    ),
    performance,
    symbolsLabel,
    sourceLabel: mode === 'ai' && snapshot.datasetId ? 'dataset:' : 'symbols:',
    sourceValue:
      mode === 'ai' && snapshot.datasetId ? snapshot.datasetId : symbolsLabel,
    datasetCreatedAtLabel:
      mode === 'ai' ? formatDatasetCreatedAt(snapshot.datasetId) : '',
    tagsLabel: snapshot.tags?.join(' · ') ?? '',
    displaySubtitle:
      mode === 'ai'
        ? snapshot.subtitle?.replace(/^q\d+\+\s*(?:·\s*)?/i, '').trim()
        : snapshot.subtitle,
    metrics: buildSnapshotSummaryMetrics(snapshot),
    drawerMetrics:
      mode === 'ai'
        ? sortAiDrawerMetrics([
            ...drawerBaseMetrics,
            {
              id: 'maxLossStreak',
              label: 'Max loss streak',
              value: formatInteger(maxLossStreak),
              tone:
                maxLossStreak > 0 ? ('warning' as const) : ('success' as const),
            },
          ])
        : drawerBaseMetrics,
    advancedMetrics: calculateAdvancedTradeMetrics({
      trades: buildSnapshotAdvancedTrades(snapshot),
      orderLog: snapshot.orderLog,
      startTimestamp: firstPoint?.[0] ?? null,
      endTimestamp: lastPoint?.[0] ?? null,
    }),
    hasOrdersDrawer: snapshotOrders.length > 0,
    hasStatDrawer: mode === 'ai' || Boolean(snapshot.details?.length),
  };
};
