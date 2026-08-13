import type { StrategyChartDetail } from '@tradejs/types';
import {
  isSymbolDetail,
  parseFormattedNumber,
} from './StrategySnapshotCard.details.presenter';

export interface SymbolPnlRank {
  symbol: string;
  pnl: number;
  orders: number | null;
  winRate: number | null;
  avgPnl: number | null;
}

export const getPnlBarColor = (value: number) => {
  if (value > 0) return 'teal.500';
  if (value < 0) return 'red.500';
  return 'gray.500';
};

export const buildSymbolPnlRanking = (
  details: StrategyChartDetail[] | undefined,
): SymbolPnlRank[] => {
  const grouped = new Map<string, Partial<SymbolPnlRank>>();

  for (const detail of details ?? []) {
    if (!isSymbolDetail(detail)) {
      continue;
    }

    const [, symbol, metricId] = detail.id.split(':');
    if (!symbol || !metricId) {
      continue;
    }

    const current = grouped.get(symbol) ?? { symbol };
    if (metricId === 'pnl') {
      const pnl = parseFormattedNumber(detail.value);
      if (pnl != null) {
        current.pnl = pnl;
      }
    }
    if (metricId === 'orders') {
      current.orders = parseFormattedNumber(detail.value);
    }
    if (metricId === 'winRate') {
      current.winRate = parseFormattedNumber(detail.value);
    }

    grouped.set(symbol, current);
  }

  return [...grouped.values()]
    .filter(
      (rank): rank is SymbolPnlRank =>
        typeof rank.symbol === 'string' &&
        typeof rank.pnl === 'number' &&
        Number.isFinite(rank.pnl),
    )
    .map((rank) => ({
      symbol: rank.symbol,
      pnl: rank.pnl,
      orders: rank.orders ?? null,
      winRate: rank.winRate ?? null,
      avgPnl:
        typeof rank.orders === 'number' && rank.orders > 0
          ? rank.pnl / rank.orders
          : null,
    }))
    .sort(
      (left, right) =>
        Math.abs(right.pnl) - Math.abs(left.pnl) ||
        right.pnl - left.pnl ||
        left.symbol.localeCompare(right.symbol),
    );
};
