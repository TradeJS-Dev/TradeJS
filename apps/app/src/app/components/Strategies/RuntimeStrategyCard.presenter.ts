import {
  calculateAdvancedTradeMetrics,
  getFormatted,
  type AdvancedTradeInput,
} from '@tradejs/core/backtest';
import type {
  RuntimeStrategyView,
  TestThresholdsKey,
  ThresholdLevel,
} from '@tradejs/types';
import {
  formatCompactNumber,
  formatFee,
  formatInteger,
  formatPercent,
  formatPriceUsdt,
  formatSignedNumber,
  formatUsdt,
  getPnlColor,
  type OrdersDrawerOrder,
  type OrdersDrawerSummaryItem,
} from '#components/Shared/OrdersDrawer';
import {
  buildStrategyPerformanceViewModel,
  calculateMaxLossStreak,
} from '#app/lib/strategyPerformance';

export type RuntimeOrderView = RuntimeStrategyView['orders'][number];
export const RUNTIME_ORDER_ROW_HEIGHT = 306;

export interface RuntimeSymbolPnlRank {
  symbol: string;
  pnl: number;
  orders: number;
  winRate: number | null;
  avgPnl: number | null;
}

export interface RuntimeSymbolConcentrationRow extends RuntimeSymbolPnlRank {
  absPnl: number;
  absPnlShare: number;
  orderShare: number;
}

export interface RuntimeDirectionStats {
  direction: RuntimeOrderView['direction'];
  orders: number;
  active: number;
  closed: number;
  wins: number;
  pnl: number;
  avgPnl: number | null;
}

export interface RuntimeDrawerMetric {
  id: string;
  label: string;
  value: string;
  level: ThresholdLevel;
}

export const getColorByLevel = (level: ThresholdLevel) => {
  switch (level) {
    case 'success':
      return 'teal.500';
    case 'warning':
      return 'fg.warning';
    case 'neutral':
      return 'gray.300';
    case 'error':
    default:
      return 'fg.error';
  }
};

export const getMetricColor = (level: ThresholdLevel) => getColorByLevel(level);

export const getPnlBarColor = (value: number) => {
  if (value > 0) {
    return 'teal.500';
  }
  if (value < 0) {
    return 'red.500';
  }
  return 'gray.500';
};

const getOrderAccentColor = (order: RuntimeOrderView) => {
  if (order.status === 'active') {
    return 'orange.300';
  }

  if (typeof order.pnl !== 'number' || !Number.isFinite(order.pnl)) {
    return 'gray.600';
  }

  return order.pnl >= 0 ? 'teal.300' : 'red.300';
};

const formatExitType = (order: RuntimeOrderView) => {
  if (order.status === 'active') {
    return 'active';
  }

  return order.exitType ? order.exitType.toUpperCase() : 'closed';
};

const formatOrderReference = (orderId: string) => {
  const normalized = orderId.trim();
  const separatorIndex = normalized.indexOf('--');
  const suffix =
    separatorIndex >= 0 ? normalized.slice(separatorIndex + 2) : normalized;

  return suffix.length > 12 ? suffix.slice(-12) : suffix || 'n/a';
};

const getRuntimeOrderNotional = (order: RuntimeOrderView) => {
  const entryPrice = order.actualEntryPrice ?? order.entryPrice;

  if (
    typeof order.qty !== 'number' ||
    !Number.isFinite(order.qty) ||
    typeof entryPrice !== 'number' ||
    !Number.isFinite(entryPrice)
  ) {
    return null;
  }

  return order.qty * entryPrice;
};

const getRuntimeOrderSlippageCost = (order: RuntimeOrderView) => {
  const notional = getRuntimeOrderNotional(order);

  if (notional == null) {
    return null;
  }

  const entrySlippagePercent =
    typeof order.entrySlippagePercent === 'number' &&
    Number.isFinite(order.entrySlippagePercent)
      ? Math.abs(order.entrySlippagePercent)
      : 0;
  const exitSlippagePercent =
    typeof order.exitSlippagePercent === 'number' &&
    Number.isFinite(order.exitSlippagePercent)
      ? Math.abs(order.exitSlippagePercent)
      : 0;
  const totalSlippagePercent = entrySlippagePercent + exitSlippagePercent;

  return totalSlippagePercent > 0
    ? (notional * totalSlippagePercent) / 100
    : null;
};

const buildRuntimeAdvancedTrades = (
  orders: RuntimeOrderView[],
): AdvancedTradeInput[] =>
  orders.flatMap((order): AdvancedTradeInput[] => {
    const timestamp = order.exitTimestamp ?? order.entryTimestamp;

    if (
      typeof timestamp !== 'number' ||
      !Number.isFinite(timestamp) ||
      typeof order.pnl !== 'number' ||
      !Number.isFinite(order.pnl)
    ) {
      return [];
    }

    const slippageCost = getRuntimeOrderSlippageCost(order);

    return [
      {
        id: order.orderId,
        timestamp,
        pnl: order.pnl,
        symbol: order.symbol,
        direction: order.direction,
        exitReason: order.exitType ?? null,
        slippageCost,
        grossPnl: slippageCost == null ? order.pnl : order.pnl + slippageCost,
        approved: true,
        blocked: false,
      },
    ];
  });

const getOrdersSummary = (orders: RuntimeOrderView[]) => {
  const closedOrders = orders.filter((order) => order.status === 'closed');
  const winningOrders = closedOrders.filter(
    (order) =>
      typeof order.pnl === 'number' &&
      Number.isFinite(order.pnl) &&
      order.pnl > 0,
  );

  const sumPnl = (direction: RuntimeOrderView['direction']) =>
    closedOrders.reduce((total, order) => {
      if (
        order.direction !== direction ||
        typeof order.pnl !== 'number' ||
        !Number.isFinite(order.pnl)
      ) {
        return total;
      }

      return total + order.pnl;
    }, 0);

  return {
    closedOrders: closedOrders.length,
    winRate:
      closedOrders.length > 0
        ? (winningOrders.length / closedOrders.length) * 100
        : 0,
    longPnl: sumPnl('LONG'),
    shortPnl: sumPnl('SHORT'),
  };
};

const getRuntimeOrdersSummaryItems = (
  orders: RuntimeOrderView[],
): OrdersDrawerSummaryItem[] => {
  const summary = getOrdersSummary(orders);

  return [
    {
      title: 'Total Closed Orders',
      value: formatInteger(summary.closedOrders),
    },
    {
      title: 'Win Rate',
      value: formatPercent(summary.winRate, { signed: false }),
    },
    {
      title: 'P&L of Closed Long Orders (USDT)',
      value: formatSignedNumber(summary.longPnl),
      color: getPnlColor(summary.longPnl),
    },
    {
      title: 'P&L of Closed Short Orders (USDT)',
      value: formatSignedNumber(summary.shortPnl),
      color: getPnlColor(summary.shortPnl),
    },
  ];
};

const buildRuntimeDrawerMetrics = (
  strategy: RuntimeStrategyView,
): RuntimeDrawerMetric[] => {
  const getStatMetric = (
    id: TestThresholdsKey,
    label: string,
  ): RuntimeDrawerMetric => {
    const { formatted, level } = getFormatted(strategy.stat, id);

    return {
      id,
      label,
      value: formatted,
      level,
    };
  };

  const maxLossStreak = calculateMaxLossStreak(strategy.orderLog);

  return [
    getStatMetric('netProfit', 'P&L'),
    {
      id: 'closedPnl',
      label: 'Closed P&L',
      value: formatSignedNumber(strategy.summary.closedPnl),
      level:
        strategy.summary.closedPnl > 0
          ? 'success'
          : strategy.summary.closedPnl < 0
            ? 'error'
            : 'neutral',
    },
    {
      id: 'activePnl',
      label: 'Active P&L',
      value: formatSignedNumber(strategy.summary.activePnl),
      level:
        strategy.summary.activePnl > 0
          ? 'success'
          : strategy.summary.activePnl < 0
            ? 'error'
            : 'neutral',
    },
    getStatMetric('maxDrawdown', 'Max drawdown'),
    {
      id: 'maxLossStreak',
      label: 'Max loss streak',
      value: formatInteger(maxLossStreak),
      level: maxLossStreak > 0 ? 'warning' : 'success',
    },
    {
      id: 'totalTrades',
      label: 'Trades',
      value: formatInteger(strategy.summary.totalTrades),
      level: 'neutral',
    },
    {
      id: 'activeTrades',
      label: 'Active',
      value: formatInteger(strategy.summary.activeTrades),
      level: strategy.summary.activeTrades > 0 ? 'warning' : 'neutral',
    },
    {
      id: 'symbolTop1',
      label: 'Symbol top 1',
      value: formatPercent(strategy.summary.symbolConcentrationTop1),
      level:
        (strategy.summary.symbolConcentrationTop1 ?? 0) >= 60
          ? 'warning'
          : 'neutral',
    },
    {
      id: 'symbolTop5',
      label: 'Symbol top 5',
      value: formatPercent(strategy.summary.symbolConcentrationTop5),
      level: 'neutral',
    },
    getStatMetric('winRate', 'Win Rate'),
  ];
};

const buildRuntimeSymbolPnlRanking = (
  orders: RuntimeOrderView[],
): RuntimeSymbolPnlRank[] => {
  const grouped = new Map<
    string,
    { symbol: string; pnl: number; orders: number; wins: number }
  >();

  for (const order of orders) {
    if (typeof order.pnl !== 'number' || !Number.isFinite(order.pnl)) {
      continue;
    }

    const existing = grouped.get(order.symbol) ?? {
      symbol: order.symbol,
      pnl: 0,
      orders: 0,
      wins: 0,
    };

    existing.pnl += order.pnl;
    existing.orders += 1;
    existing.wins += order.pnl > 0 ? 1 : 0;
    grouped.set(order.symbol, existing);
  }

  return [...grouped.values()]
    .map((rank) => ({
      symbol: rank.symbol,
      pnl: rank.pnl,
      orders: rank.orders,
      winRate: rank.orders > 0 ? (rank.wins / rank.orders) * 100 : null,
      avgPnl: rank.orders > 0 ? rank.pnl / rank.orders : null,
    }))
    .sort(
      (left, right) =>
        Math.abs(right.pnl) - Math.abs(left.pnl) ||
        right.pnl - left.pnl ||
        left.symbol.localeCompare(right.symbol),
    );
};

const buildRuntimeSymbolConcentration = (
  orders: RuntimeOrderView[],
): RuntimeSymbolConcentrationRow[] => {
  const ranking = buildRuntimeSymbolPnlRanking(orders).map((rank) => ({
    ...rank,
    absPnl: Math.abs(rank.pnl),
  }));
  const totalAbsPnl = ranking.reduce((sum, rank) => sum + rank.absPnl, 0);
  const totalOrders = ranking.reduce((sum, rank) => sum + rank.orders, 0);

  if (totalAbsPnl <= 0 || totalOrders <= 0) {
    return [];
  }

  return ranking
    .map((rank) => ({
      ...rank,
      absPnlShare: (rank.absPnl / totalAbsPnl) * 100,
      orderShare: (rank.orders / totalOrders) * 100,
    }))
    .sort(
      (left, right) =>
        right.absPnlShare - left.absPnlShare ||
        right.orderShare - left.orderShare ||
        left.symbol.localeCompare(right.symbol),
    );
};

const buildRuntimeDirectionStats = (
  orders: RuntimeOrderView[],
): RuntimeDirectionStats[] =>
  (['LONG', 'SHORT'] as const).map((direction) => {
    const directionOrders = orders.filter(
      (order) => order.direction === direction,
    );
    const ordersWithPnl = directionOrders.filter(
      (order) => typeof order.pnl === 'number' && Number.isFinite(order.pnl),
    );
    const pnl = ordersWithPnl.reduce((sum, order) => sum + (order.pnl ?? 0), 0);

    return {
      direction,
      orders: directionOrders.length,
      active: directionOrders.filter((order) => order.status === 'active')
        .length,
      closed: directionOrders.filter((order) => order.status === 'closed')
        .length,
      wins: ordersWithPnl.filter((order) => (order.pnl ?? 0) > 0).length,
      pnl,
      avgPnl: ordersWithPnl.length > 0 ? pnl / ordersWithPnl.length : null,
    };
  });

const mapRuntimeOrder = (order: RuntimeOrderView): OrdersDrawerOrder => {
  const displayEntryPrice = order.actualEntryPrice ?? order.entryPrice;
  const displayExitPrice =
    order.status === 'active'
      ? order.currentPrice
      : order.actualExitPrice ?? order.exitPrice;
  const notional =
    typeof order.qty === 'number' &&
    Number.isFinite(order.qty) &&
    typeof displayEntryPrice === 'number' &&
    Number.isFinite(displayEntryPrice)
      ? order.qty * displayEntryPrice
      : null;

  return {
    id: order.orderId,
    title: order.symbol,
    reference: formatOrderReference(order.orderId),
    period: {
      start: order.entryTimestamp,
      end: order.status === 'active' ? null : order.exitTimestamp,
      durationHours: order.durationHours,
    },
    direction: order.direction,
    status: order.status,
    statusLabel: formatExitType(order).toUpperCase(),
    statusColor: order.status === 'active' ? 'orange' : 'gray',
    pnl: order.pnl,
    accentColor: getOrderAccentColor(order),
    metrics: [
      {
        title: 'Entry',
        value: formatPriceUsdt(displayEntryPrice),
        detail:
          order.actualEntryPrice == null
            ? 'actual n/a'
            : `plan ${formatPriceUsdt(order.entryPrice)} / slip ${formatPercent(order.entrySlippagePercent, { signed: true })}`,
      },
      {
        title: order.status === 'active' ? 'Current' : 'Exit',
        value: formatPriceUsdt(displayExitPrice),
        detailLines:
          order.status === 'active'
            ? [
                `TP ${formatPriceUsdt(order.takeProfitPrice)} (${formatPercent(order.takeProfitPercent, { signed: true })})`,
                `SL ${formatPriceUsdt(order.stopLossPrice)} (${formatPercent(order.stopLossPercent)})`,
              ]
            : [
                `slip ${formatPercent(order.exitSlippagePercent, { signed: true })}`,
              ],
      },
      {
        title: 'Notional',
        value: formatUsdt(notional),
      },
      {
        title: 'Fees',
        value: formatFee(order.totalFee),
        detailLines: [
          `open ${formatFee(order.openFee)}`,
          `close ${formatFee(order.closeFee)}`,
          `funding ${formatFee(order.fundingFee)}`,
        ],
      },
      {
        title: 'Qty',
        value: formatCompactNumber(order.qty),
      },
    ],
  };
};

export const buildRuntimeStrategyCardViewModel = (
  strategy: RuntimeStrategyView,
) => {
  const symbolPnlRanking = buildRuntimeSymbolPnlRanking(strategy.orders);
  const firstPoint = strategy.orderLog[0];
  const lastPoint = strategy.orderLog[strategy.orderLog.length - 1];

  return {
    lastTrade: strategy.recentTrades[0],
    runtimeOrders: strategy.orders.map(mapRuntimeOrder),
    runtimeOrderSummaryItems: getRuntimeOrdersSummaryItems(strategy.orders),
    drawerMetrics: buildRuntimeDrawerMetrics(strategy),
    performance: buildStrategyPerformanceViewModel(strategy.orderLog),
    symbolPnlRanking,
    symbolConcentration: buildRuntimeSymbolConcentration(strategy.orders).slice(
      0,
      8,
    ),
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
    directionStats: buildRuntimeDirectionStats(strategy.orders),
    advancedMetrics: calculateAdvancedTradeMetrics({
      trades: buildRuntimeAdvancedTrades(strategy.orders),
      orderLog: strategy.orderLog,
      startTimestamp: firstPoint?.[0] ?? null,
      endTimestamp: lastPoint?.[0] ?? null,
    }),
  };
};
