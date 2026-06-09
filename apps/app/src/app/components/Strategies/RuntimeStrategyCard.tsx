'use client';

import { type ReactNode, useMemo, useState } from 'react';
import {
  Box,
  Button,
  CloseButton,
  Drawer,
  Flex,
  Grid,
  Menu,
  Portal,
  SimpleGrid,
  Stat,
  Text,
} from '@chakra-ui/react';
import { getFormatted } from '@tradejs/core/backtest';
import type { TestThresholdsKey, ThresholdLevel } from '@tradejs/types';
import {
  formatCompactNumber,
  formatDateTime,
  formatFee,
  formatInteger,
  formatPercent,
  formatSignedNumber,
  getPnlColor,
  OrdersDrawerPanel,
  type OrdersDrawerOrder,
  type OrdersDrawerSummaryItem,
} from '#components/Shared/OrdersDrawer';
import type { RuntimeStrategyView } from '#app/lib/runtimeStrategies';
import { RuntimeStrategyChart } from './RuntimeStrategyChart';

type RuntimeOrderView = RuntimeStrategyView['orders'][number];
const RUNTIME_ORDER_ROW_HEIGHT = 306;
const CHART_WIDTH = 640;
const CHART_HEIGHT = 120;
const CHART_PADDING = 10;
const POSITIVE_CHART_COLOR = '#5eead4';
const NEGATIVE_CHART_COLOR = '#f87171';
const NEUTRAL_CHART_COLOR = '#6b7280';

type TradingSession = 'Asia' | 'Europe' | 'US';

interface RuntimeTradePoint {
  index: number;
  timestamp: number;
  pnl: number;
  equity: number;
  hour: number;
  session: TradingSession;
}

interface DrawdownPoint {
  timestamp: number;
  drawdownPercent: number;
}

interface RollingPerformancePoint {
  index: number;
  winRate: number;
  pnl: number;
}

interface DistributionBin {
  id: string;
  min: number;
  max: number;
  count: number;
}

interface MonthlyStat {
  id: string;
  year: number;
  monthIndex: number;
  monthLabel: string;
  orders: number;
  wins: number;
  pnl: number;
}

interface YearlyMonthlyStats {
  year: number;
  months: MonthlyStat[];
}

interface QuarterlyMonthlyStats {
  label: string;
  monthIndexes: readonly number[];
  months: (MonthlyStat | null)[];
  hasData: boolean;
}

interface SessionPnlStat {
  session: TradingSession;
  pnl: number;
  orders: number;
}

interface HourlyPnlStat {
  hour: number;
  pnl: number;
  orders: number;
}

interface RuntimeSymbolPnlRank {
  symbol: string;
  pnl: number;
  orders: number;
  winRate: number | null;
  avgPnl: number | null;
}

interface RuntimeDirectionStats {
  direction: RuntimeOrderView['direction'];
  orders: number;
  active: number;
  closed: number;
  wins: number;
  pnl: number;
  avgPnl: number | null;
}

interface RuntimeDrawerMetric {
  id: string;
  label: string;
  value: string;
  level: ThresholdLevel;
}

const getColorByLevel = (level: ThresholdLevel) => {
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

const getMetricColor = (level: ThresholdLevel) => getColorByLevel(level);

const getChartPnlColor = (value: number) =>
  value > 0
    ? POSITIVE_CHART_COLOR
    : value < 0
      ? NEGATIVE_CHART_COLOR
      : NEUTRAL_CHART_COLOR;

const getPnlBarColor = (value: number) => {
  if (value > 0) {
    return 'teal.500';
  }
  if (value < 0) {
    return 'red.500';
  }
  return 'gray.500';
};

const resolveTradingSession = (hour: number): TradingSession => {
  if (hour < 8) {
    return 'Asia';
  }

  if (hour < 16) {
    return 'Europe';
  }

  return 'US';
};

const getStepPnl = (
  orderLog: RuntimeStrategyView['orderLog'],
  index: number,
) => {
  const current = orderLog[index];
  const previous = orderLog[index - 1];

  if (!current || !previous) {
    return null;
  }

  const pnl = current[1] - previous[1];
  return Number.isFinite(pnl) ? pnl : null;
};

const calculateMaxLossStreak = (orderLog: RuntimeStrategyView['orderLog']) => {
  let currentStreak = 0;
  let maxStreak = 0;

  for (let index = 1; index < orderLog.length; index += 1) {
    const pnl = getStepPnl(orderLog, index);
    if (typeof pnl !== 'number' || !Number.isFinite(pnl)) {
      continue;
    }

    if (pnl < 0) {
      currentStreak += 1;
      maxStreak = Math.max(maxStreak, currentStreak);
      continue;
    }

    currentStreak = 0;
  }

  return maxStreak;
};

const buildRuntimeTradePoints = (
  orderLog: RuntimeStrategyView['orderLog'],
): RuntimeTradePoint[] => {
  const points: RuntimeTradePoint[] = [];

  for (let index = 1; index < orderLog.length; index += 1) {
    const current = orderLog[index];
    const previous = orderLog[index - 1];
    if (!current || !previous) {
      continue;
    }

    const [timestamp, equity] = current;
    const pnl = equity - previous[1];
    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(equity) ||
      !Number.isFinite(pnl)
    ) {
      continue;
    }

    const hour = new Date(timestamp).getUTCHours();
    points.push({
      index,
      timestamp,
      pnl,
      equity,
      hour,
      session: resolveTradingSession(hour),
    });
  }

  return points;
};

const buildDrawdownPoints = (
  orderLog: RuntimeStrategyView['orderLog'],
): DrawdownPoint[] => {
  let peak = orderLog[0]?.[1] ?? 0;

  return orderLog
    .map(([timestamp, equity]) => {
      if (!Number.isFinite(timestamp) || !Number.isFinite(equity)) {
        return null;
      }

      peak = Math.max(peak, equity);
      const drawdownPercent = peak > 0 ? ((peak - equity) / peak) * 100 : 0;

      return {
        timestamp,
        drawdownPercent,
      };
    })
    .filter((point): point is DrawdownPoint => point != null);
};

const buildRollingPerformance = (
  trades: RuntimeTradePoint[],
  windowSize = 50,
): RollingPerformancePoint[] =>
  trades.map((trade, index) => {
    const windowTrades = trades.slice(
      Math.max(0, index - windowSize + 1),
      index + 1,
    );
    const wins = windowTrades.filter((item) => item.pnl > 0).length;
    const pnl = windowTrades.reduce((sum, item) => sum + item.pnl, 0);

    return {
      index: trade.index,
      winRate: windowTrades.length > 0 ? (wins / windowTrades.length) * 100 : 0,
      pnl,
    };
  });

const buildPnlDistribution = (
  trades: RuntimeTradePoint[],
  binCount = 12,
): DistributionBin[] => {
  if (!trades.length) {
    return [];
  }

  const pnlValues = trades.map((trade) => trade.pnl);
  const min = Math.min(...pnlValues);
  const max = Math.max(...pnlValues);

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [];
  }

  if (min === max) {
    return [
      {
        id: `${min}:${max}`,
        min,
        max,
        count: trades.length,
      },
    ];
  }

  const step = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    id: String(index),
    min: min + step * index,
    max: index === binCount - 1 ? max : min + step * (index + 1),
    count: 0,
  }));

  for (const pnl of pnlValues) {
    const rawIndex = Math.floor((pnl - min) / step);
    const index = Math.max(0, Math.min(binCount - 1, rawIndex));
    const bin = bins[index];
    if (bin) {
      bin.count += 1;
    }
  }

  return bins;
};

const buildSessionPnlStats = (
  trades: RuntimeTradePoint[],
): SessionPnlStat[] => {
  const stats = new Map<TradingSession, SessionPnlStat>(
    (['Asia', 'Europe', 'US'] as const).map((session) => [
      session,
      { session, pnl: 0, orders: 0 },
    ]),
  );

  for (const trade of trades) {
    const stat = stats.get(trade.session);
    if (!stat) {
      continue;
    }

    stat.pnl += trade.pnl;
    stat.orders += 1;
  }

  return [...stats.values()];
};

const buildHourlyPnlStats = (trades: RuntimeTradePoint[]): HourlyPnlStat[] => {
  const stats = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    pnl: 0,
    orders: 0,
  }));

  for (const trade of trades) {
    const stat = stats[trade.hour];
    if (!stat) {
      continue;
    }

    stat.pnl += trade.pnl;
    stat.orders += 1;
  }

  return stats;
};

const getMonthLabel = (monthIndex: number) =>
  new Date(Date.UTC(2026, monthIndex - 1, 1)).toLocaleString('en-US', {
    month: 'short',
  });

const monthQuarters = [
  { label: 'Q1', months: [1, 2, 3] },
  { label: 'Q2', months: [4, 5, 6] },
  { label: 'Q3', months: [7, 8, 9] },
  { label: 'Q4', months: [10, 11, 12] },
] as const;

const buildQuarterlyMonthlyStats = (
  months: MonthlyStat[],
): QuarterlyMonthlyStats[] => {
  const byMonth = new Map(months.map((month) => [month.monthIndex, month]));

  return monthQuarters
    .map((quarter) => {
      const quarterMonths = quarter.months.map(
        (monthIndex) => byMonth.get(monthIndex) ?? null,
      );

      return {
        label: quarter.label,
        monthIndexes: quarter.months,
        months: quarterMonths,
        hasData: quarterMonths.some((month) => month != null),
      };
    })
    .filter((quarter) => quarter.hasData);
};

const buildMonthlyStats = (
  orderLog: RuntimeStrategyView['orderLog'],
): YearlyMonthlyStats[] => {
  const grouped = new Map<string, MonthlyStat>();

  for (let index = 1; index < orderLog.length; index += 1) {
    const current = orderLog[index];
    const previous = orderLog[index - 1];
    if (!current || !previous) {
      continue;
    }

    const [timestamp, amount] = current;
    const previousAmount = previous[1];
    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(amount) ||
      !Number.isFinite(previousAmount)
    ) {
      continue;
    }

    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const monthIndex = date.getUTCMonth() + 1;
    const id = `${year}-${String(monthIndex).padStart(2, '0')}`;
    const pnl = amount - previousAmount;
    const existing = grouped.get(id) ?? {
      id,
      year,
      monthIndex,
      monthLabel: getMonthLabel(monthIndex),
      orders: 0,
      wins: 0,
      pnl: 0,
    };

    existing.orders += 1;
    existing.wins += pnl > 0 ? 1 : 0;
    existing.pnl += pnl;
    grouped.set(id, existing);
  }

  const monthlyStats = [...grouped.values()].sort(
    (left, right) =>
      left.year - right.year || left.monthIndex - right.monthIndex,
  );
  const yearlyStats = new Map<number, MonthlyStat[]>();

  for (const month of monthlyStats) {
    const months = yearlyStats.get(month.year) ?? [];
    months.push(month);
    yearlyStats.set(month.year, months);
  }

  return [...yearlyStats.entries()]
    .sort(([leftYear], [rightYear]) => leftYear - rightYear)
    .map(([year, months]) => ({
      year,
      months,
    }));
};

const StatItem = ({
  stat,
  id,
  title,
}: {
  stat: RuntimeStrategyView['stat'];
  id: TestThresholdsKey;
  title: string;
}) => {
  const { formatted, level } = getFormatted(stat, id);

  return (
    <Stat.Root size="md">
      <Stat.Label>{title}</Stat.Label>
      <Stat.ValueText color={getColorByLevel(level)}>
        {formatted}
      </Stat.ValueText>
    </Stat.Root>
  );
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

const RiskLevelsDetail = ({ order }: { order: RuntimeOrderView }) => (
  <Box>
    <Text>
      TP {formatCompactNumber(order.takeProfitPrice)} (
      {formatPercent(order.takeProfitPercent, { signed: true })})
    </Text>
    <Text>
      SL {formatCompactNumber(order.stopLossPrice)} (
      {formatPercent(order.stopLossPercent)})
    </Text>
  </Box>
);

const FeesDetail = ({ order }: { order: RuntimeOrderView }) => (
  <Box>
    <Text>open {formatFee(order.openFee)}</Text>
    <Text>close {formatFee(order.closeFee)}</Text>
    <Text>funding {formatFee(order.fundingFee)}</Text>
  </Box>
);

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

const RuntimeOrdersSummaryBlock = ({
  items,
}: {
  items: OrdersDrawerSummaryItem[];
}) => (
  <Box
    p={4}
    borderWidth="1px"
    borderColor="gray.800"
    borderRadius="md"
    bg="gray.900"
  >
    <SimpleGrid columns={{ base: 1, md: 2 }} gap={4}>
      {items.map((item) => (
        <Box key={item.title}>
          <Text fontSize="sm" color="gray.500">
            {item.title}
          </Text>
          <Text
            mt={1}
            fontSize="2xl"
            color={item.color ?? 'gray.100'}
            fontWeight="bold"
            fontFamily="mono"
            lineHeight="1.1"
          >
            {item.value}
          </Text>
        </Box>
      ))}
    </SimpleGrid>
  </Box>
);

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

const buildPolylinePoints = (values: number[]) => {
  if (!values.length) {
    return '';
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const drawableWidth = CHART_WIDTH - CHART_PADDING * 2;
  const drawableHeight = CHART_HEIGHT - CHART_PADDING * 2;

  return values
    .map((value, index) => {
      const x =
        CHART_PADDING +
        (values.length === 1
          ? 0
          : (index / (values.length - 1)) * drawableWidth);
      const y = CHART_PADDING + ((max - value) / range) * drawableHeight;

      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
};

const ChartPanel = ({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) => (
  <Box
    p={4}
    borderWidth="1px"
    borderColor="gray.800"
    borderRadius="md"
    bg="gray.900"
    minH="210px"
  >
    <Flex justify="space-between" align="baseline" gap={3} mb={3}>
      <Text fontSize="sm" color="gray.300" fontWeight="semibold">
        {title}
      </Text>
      {subtitle ? (
        <Text fontSize="xs" color="gray.500" textAlign="right">
          {subtitle}
        </Text>
      ) : null}
    </Flex>
    {children}
  </Box>
);

const EmptyChart = () => (
  <Flex h="140px" align="center" justify="center">
    <Text fontSize="sm" color="gray.500">
      No trade data
    </Text>
  </Flex>
);

const DrawdownTimelineChart = ({ points }: { points: DrawdownPoint[] }) => {
  if (points.length < 2) {
    return <EmptyChart />;
  }

  const values = points.map((point) => -point.drawdownPercent);
  const maxDrawdown = Math.max(...points.map((point) => point.drawdownPercent));
  const linePoints = buildPolylinePoints(values);

  return (
    <Box>
      <svg
        width="100%"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label="Drawdown timeline"
      >
        <line
          x1={CHART_PADDING}
          x2={CHART_WIDTH - CHART_PADDING}
          y1={CHART_PADDING}
          y2={CHART_PADDING}
          stroke="#374151"
          strokeDasharray="4 4"
        />
        <polyline
          points={linePoints}
          fill="none"
          stroke={NEGATIVE_CHART_COLOR}
          strokeWidth="2"
        />
      </svg>
      <Flex justify="space-between" align="center" mt={2}>
        <Text fontSize="xs" color="gray.500">
          max drawdown
        </Text>
        <Text
          fontSize="sm"
          color="orange.300"
          fontFamily="mono"
          fontWeight="bold"
        >
          {formatPercent(maxDrawdown)}
        </Text>
      </Flex>
    </Box>
  );
};

const WinLossStreakTimelineChart = ({
  trades,
}: {
  trades: RuntimeTradePoint[];
}) => {
  if (!trades.length) {
    return <EmptyChart />;
  }

  const maxAbsPnl = Math.max(...trades.map((trade) => Math.abs(trade.pnl)), 1);
  const centerY = CHART_HEIGHT / 2;
  const barWidth = CHART_WIDTH / trades.length;

  return (
    <Box>
      <svg
        width="100%"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label="Win loss streak timeline"
      >
        <line
          x1="0"
          x2={CHART_WIDTH}
          y1={centerY}
          y2={centerY}
          stroke="#374151"
        />
        {trades.map((trade, index) => {
          const height = Math.max(2, (Math.abs(trade.pnl) / maxAbsPnl) * 48);
          const isWin = trade.pnl > 0;
          const y = isWin ? centerY - height : centerY;

          return (
            <rect
              key={`${trade.timestamp}-${index}`}
              x={index * barWidth}
              y={y}
              width={Math.max(1, barWidth - 0.4)}
              height={height}
              fill={getChartPnlColor(trade.pnl)}
              opacity="0.9"
            />
          );
        })}
      </svg>
      <Flex justify="space-between" align="center" mt={2}>
        <Text fontSize="xs" color="gray.500">
          wins above line, losses below
        </Text>
        <Text
          fontSize="sm"
          color="gray.300"
          fontFamily="mono"
          fontWeight="bold"
        >
          {formatInteger(trades.length)} trades
        </Text>
      </Flex>
    </Box>
  );
};

const PnlDistributionChart = ({ bins }: { bins: DistributionBin[] }) => {
  if (!bins.length) {
    return <EmptyChart />;
  }

  const maxCount = Math.max(...bins.map((bin) => bin.count), 1);
  const barWidth = CHART_WIDTH / bins.length;

  return (
    <Box>
      <svg
        width="100%"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label="P and L distribution"
      >
        {bins.map((bin, index) => {
          const height = Math.max(2, (bin.count / maxCount) * 92);
          const x = index * barWidth + 2;
          const y = CHART_HEIGHT - height - CHART_PADDING;
          const midpoint = (bin.min + bin.max) / 2;

          return (
            <rect
              key={bin.id}
              x={x}
              y={y}
              width={Math.max(2, barWidth - 4)}
              height={height}
              fill={getChartPnlColor(midpoint)}
            />
          );
        })}
      </svg>
      <Flex justify="space-between" align="center" mt={2}>
        <Text fontSize="xs" color="gray.500">
          trade P&L buckets
        </Text>
        <Text
          fontSize="sm"
          color="gray.300"
          fontFamily="mono"
          fontWeight="bold"
        >
          {formatInteger(bins.reduce((sum, bin) => sum + bin.count, 0))}
        </Text>
      </Flex>
    </Box>
  );
};

const RollingPerformanceChart = ({
  points,
}: {
  points: RollingPerformancePoint[];
}) => {
  if (points.length < 2) {
    return <EmptyChart />;
  }

  const winRateLine = buildPolylinePoints(points.map((point) => point.winRate));
  const pnlLine = buildPolylinePoints(points.map((point) => point.pnl));
  const latest = points[points.length - 1];

  return (
    <Box>
      <svg
        width="100%"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label="Rolling win rate and rolling P and L"
      >
        <line
          x1={CHART_PADDING}
          x2={CHART_WIDTH - CHART_PADDING}
          y1={CHART_HEIGHT / 2}
          y2={CHART_HEIGHT / 2}
          stroke="#374151"
          strokeDasharray="4 4"
        />
        <polyline
          points={pnlLine}
          fill="none"
          stroke={POSITIVE_CHART_COLOR}
          strokeWidth="2"
        />
        <polyline
          points={winRateLine}
          fill="none"
          stroke="#fbbf24"
          strokeWidth="2"
          opacity="0.9"
        />
      </svg>
      <Flex justify="space-between" align="center" mt={2}>
        <Text fontSize="xs" color="gray.500">
          teal P&L, yellow win rate
        </Text>
        <Text
          fontSize="sm"
          color="gray.300"
          fontFamily="mono"
          fontWeight="bold"
        >
          {formatPercent(latest?.winRate)} /{' '}
          {formatSignedNumber(latest?.pnl ?? null)}
        </Text>
      </Flex>
    </Box>
  );
};

const TimeOfDaySessionChart = ({
  sessions,
  hours,
}: {
  sessions: SessionPnlStat[];
  hours: HourlyPnlStat[];
}) => {
  if (!sessions.some((session) => session.orders > 0)) {
    return <EmptyChart />;
  }

  const maxSessionAbsPnl = Math.max(
    ...sessions.map((session) => Math.abs(session.pnl)),
    1,
  );
  const maxHourAbsPnl = Math.max(...hours.map((hour) => Math.abs(hour.pnl)), 1);

  return (
    <Flex direction="column" gap={4}>
      <SimpleGrid columns={3} gap={3}>
        {sessions.map((session) => {
          const width = Math.max(
            4,
            (Math.abs(session.pnl) / maxSessionAbsPnl) * 100,
          );

          return (
            <Box key={session.session}>
              <Flex justify="space-between" align="center" mb={1}>
                <Text fontSize="xs" color="gray.400" fontWeight="semibold">
                  {session.session}
                </Text>
                <Text
                  fontSize="xs"
                  color={getPnlColor(session.pnl)}
                  fontFamily="mono"
                  fontWeight="bold"
                >
                  {formatSignedNumber(session.pnl)}
                </Text>
              </Flex>
              <Box h="8px" bg="gray.800">
                <Box
                  h="full"
                  w={`${width}%`}
                  bg={getChartPnlColor(session.pnl)}
                />
              </Box>
              <Text mt={1} fontSize="xs" color="gray.500" fontFamily="mono">
                {formatInteger(session.orders)} orders
              </Text>
            </Box>
          );
        })}
      </SimpleGrid>

      <svg
        width="100%"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label="P and L by UTC hour"
      >
        <line
          x1="0"
          x2={CHART_WIDTH}
          y1={CHART_HEIGHT / 2}
          y2={CHART_HEIGHT / 2}
          stroke="#374151"
        />
        {hours.map((hour) => {
          const barWidth = CHART_WIDTH / 24;
          const height = Math.max(1, (Math.abs(hour.pnl) / maxHourAbsPnl) * 46);
          const isPositive = hour.pnl >= 0;
          const y = isPositive ? CHART_HEIGHT / 2 - height : CHART_HEIGHT / 2;

          return (
            <rect
              key={hour.hour}
              x={hour.hour * barWidth + 2}
              y={y}
              width={Math.max(2, barWidth - 4)}
              height={height}
              fill={getChartPnlColor(hour.pnl)}
              opacity={hour.orders > 0 ? 0.95 : 0.2}
            />
          );
        })}
      </svg>
      <Text fontSize="xs" color="gray.500">
        UTC hours, sessions: Asia 00-07, Europe 08-15, US 16-23
      </Text>
    </Flex>
  );
};

const renderPnlRanking = ({
  title,
  subtitle,
  ranking,
  maxAbsPnl,
}: {
  title: string;
  subtitle: string;
  ranking: RuntimeSymbolPnlRank[];
  maxAbsPnl: number;
}) => (
  <Box
    p={4}
    borderWidth="1px"
    borderColor="gray.800"
    borderRadius="md"
    bg="gray.900"
  >
    <Flex justify="space-between" align="baseline" gap={3} mb={4}>
      <Text fontSize="sm" color="gray.300" fontWeight="semibold">
        {title}
      </Text>
      <Text fontSize="xs" color="gray.500">
        {subtitle}
      </Text>
    </Flex>

    {ranking.length ? (
      <Flex direction="column" gap={3}>
        {ranking.map((rank) => {
          const width = Math.max(4, (Math.abs(rank.pnl) / maxAbsPnl) * 100);

          return (
            <Grid
              key={rank.symbol}
              templateColumns="1.1fr 2fr 0.8fr"
              alignItems="center"
              gap={3}
            >
              <Box minW={0}>
                <Text
                  fontSize="sm"
                  color="gray.200"
                  fontWeight="bold"
                  overflow="hidden"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                >
                  {rank.symbol}
                </Text>
                <Text fontSize="xs" color="gray.500" fontFamily="mono">
                  {formatInteger(rank.orders)} orders ·{' '}
                  {formatPercent(rank.winRate)}
                </Text>
                <Text fontSize="xs" color="gray.600" fontFamily="mono">
                  avg {formatSignedNumber(rank.avgPnl)}
                </Text>
              </Box>
              <Box h="10px" bg="gray.800">
                <Box h="full" w={`${width}%`} bg={getPnlBarColor(rank.pnl)} />
              </Box>
              <Text
                fontSize="sm"
                color={getPnlColor(rank.pnl)}
                fontWeight="bold"
                fontFamily="mono"
                textAlign="right"
              >
                {formatSignedNumber(rank.pnl)}
              </Text>
            </Grid>
          );
        })}
      </Flex>
    ) : (
      <Text fontSize="sm" color="gray.500">
        No symbol P&L data
      </Text>
    )}
  </Box>
);

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
    period: {
      start: order.entryTimestamp,
      end: order.status === 'active' ? null : order.exitTimestamp,
      durationHours: order.durationHours,
    },
    direction: order.direction,
    statusLabel: formatExitType(order).toUpperCase(),
    statusColor: order.status === 'active' ? 'orange' : 'gray',
    pnl: order.pnl,
    accentColor: getOrderAccentColor(order),
    metrics: [
      {
        title: 'Entry',
        value: formatCompactNumber(displayEntryPrice),
        detail:
          order.actualEntryPrice == null
            ? 'actual n/a'
            : `plan ${formatCompactNumber(order.entryPrice)} / slip ${formatPercent(order.entrySlippagePercent, { signed: true })}`,
      },
      {
        title: order.status === 'active' ? 'Current' : 'Exit',
        value: formatCompactNumber(displayExitPrice),
        detail:
          order.status === 'active' ? (
            <RiskLevelsDetail order={order} />
          ) : (
            `slip ${formatPercent(order.exitSlippagePercent, { signed: true })}`
          ),
      },
      {
        title: 'Fees',
        value: formatFee(order.totalFee),
        detail: <FeesDetail order={order} />,
      },
      {
        title: 'Notional',
        value:
          notional == null
            ? 'n/a'
            : `${formatCompactNumber(notional, {
                maximumFractionDigits: 2,
                minimumFractionDigits: 2,
              })} USDT`,
      },
      {
        title: 'Qty',
        value: formatCompactNumber(order.qty),
        detail: `ref ${formatOrderReference(order.orderId)}`,
      },
    ],
  };
};

export const RuntimeStrategyCard = ({
  strategy,
  provider,
}: {
  strategy: RuntimeStrategyView;
  provider: string;
}) => {
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const lastTrade = strategy.recentTrades[0];
  const runtimeOrders = useMemo(
    () => strategy.orders.map(mapRuntimeOrder),
    [strategy.orders],
  );
  const runtimeOrderSummaryItems = useMemo(
    () => getRuntimeOrdersSummaryItems(strategy.orders),
    [strategy.orders],
  );
  const drawerMetrics = useMemo(
    () => buildRuntimeDrawerMetrics(strategy),
    [strategy],
  );
  const monthlyStats = useMemo(
    () => buildMonthlyStats(strategy.orderLog),
    [strategy.orderLog],
  );
  const runtimeTradePoints = useMemo(
    () => buildRuntimeTradePoints(strategy.orderLog),
    [strategy.orderLog],
  );
  const drawdownPoints = useMemo(
    () => buildDrawdownPoints(strategy.orderLog),
    [strategy.orderLog],
  );
  const rollingPerformancePoints = useMemo(
    () => buildRollingPerformance(runtimeTradePoints, 50),
    [runtimeTradePoints],
  );
  const pnlDistributionBins = useMemo(
    () => buildPnlDistribution(runtimeTradePoints),
    [runtimeTradePoints],
  );
  const sessionPnlStats = useMemo(
    () => buildSessionPnlStats(runtimeTradePoints),
    [runtimeTradePoints],
  );
  const hourlyPnlStats = useMemo(
    () => buildHourlyPnlStats(runtimeTradePoints),
    [runtimeTradePoints],
  );
  const symbolPnlRanking = useMemo(
    () => buildRuntimeSymbolPnlRanking(strategy.orders),
    [strategy.orders],
  );
  const topSymbolPnlRanking = useMemo(
    () =>
      [...symbolPnlRanking]
        .sort(
          (left, right) =>
            right.pnl - left.pnl || left.symbol.localeCompare(right.symbol),
        )
        .slice(0, 10),
    [symbolPnlRanking],
  );
  const worstSymbolPnlRanking = useMemo(
    () =>
      [...symbolPnlRanking]
        .sort(
          (left, right) =>
            left.pnl - right.pnl || left.symbol.localeCompare(right.symbol),
        )
        .slice(0, 10),
    [symbolPnlRanking],
  );
  const symbolRankingMaxAbsPnl = useMemo(
    () => Math.max(...symbolPnlRanking.map((rank) => Math.abs(rank.pnl)), 1),
    [symbolPnlRanking],
  );
  const directionStats = useMemo(
    () => buildRuntimeDirectionStats(strategy.orders),
    [strategy.orders],
  );

  return (
    <Box
      p={2}
      mb={4}
      maxW="1400px"
      borderRadius="md"
      shadow="sm"
      borderWidth="1px"
      borderColor={strategy.connected ? 'gray.800' : 'orange.900'}
      overflowX="auto"
    >
      <Flex gap="4" p={4} mb={3} alignItems="center" wrap="wrap">
        <Text fontSize="lg" fontWeight="bold" color="gray.200">
          {strategy.strategyName}
        </Text>

        <Flex gap="1">
          <Text fontSize="sm" fontWeight="bold" color="gray.400" mt={1}>
            connector:
          </Text>
          <Text fontSize="lg" fontWeight="bold" color="gray.200">
            {provider}
          </Text>
        </Flex>

        <Flex gap="1">
          <Text fontSize="sm" fontWeight="bold" color="gray.400" mt={1}>
            trades:
          </Text>
          <Text fontSize="lg" fontWeight="bold" color="gray.200">
            {strategy.summary.totalTrades}
          </Text>
        </Flex>

        <Flex gap="1">
          <Text fontSize="sm" fontWeight="bold" color="gray.400" mt={1}>
            active:
          </Text>
          <Text
            fontSize="lg"
            fontWeight="bold"
            color={
              strategy.summary.activeTrades > 0 ? 'orange.300' : 'gray.200'
            }
          >
            {strategy.summary.activeTrades}
          </Text>
        </Flex>

        <Flex ml="auto" gap={3} alignItems="center">
          <Text fontSize="sm" color="gray.500">
            {lastTrade
              ? `last trade: ${lastTrade.symbol} ${formatDateTime(lastTrade.entryTimestamp)}`
              : strategy.connected
                ? 'connected, no runtime trades yet'
                : 'runtime trades only'}
          </Text>

          <Menu.Root positioning={{ placement: 'bottom-end' }}>
            <Menu.Trigger asChild>
              <Button size="sm" variant="outline">
                Actions
              </Button>
            </Menu.Trigger>
            <Portal>
              <Menu.Positioner>
                <Menu.Content minW="160px">
                  <Menu.Item value="orders" onClick={() => setOrdersOpen(true)}>
                    Orders
                  </Menu.Item>
                  <Menu.Item value="stat" onClick={() => setStatsOpen(true)}>
                    Stat
                  </Menu.Item>
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
        </Flex>
      </Flex>

      <OrdersDrawerPanel
        title={`${strategy.strategyName} orders`}
        open={ordersOpen}
        orders={runtimeOrders}
        rowHeight={RUNTIME_ORDER_ROW_HEIGHT}
        onOpenChange={setOrdersOpen}
      />

      <Drawer.Root
        size="xl"
        open={statsOpen}
        onOpenChange={(e) => setStatsOpen(e.open)}
      >
        <Portal>
          <Drawer.Backdrop />
          <Drawer.Positioner>
            <Drawer.Content
              display="flex"
              flexDirection="column"
              w="50vw"
              minW="640px"
              maxW="50vw"
              bg="gray.950"
            >
              <Drawer.Header>
                <Drawer.Title>{strategy.strategyName}</Drawer.Title>
                <Drawer.CloseTrigger asChild>
                  <CloseButton size="sm" />
                </Drawer.CloseTrigger>
              </Drawer.Header>

              <Drawer.Body
                display="flex"
                flexDirection="column"
                gap={4}
                overflowY="auto"
                flex="1"
                minH="0"
                w="full"
              >
                <RuntimeOrdersSummaryBlock items={runtimeOrderSummaryItems} />

                <Box
                  p={4}
                  borderWidth="1px"
                  borderColor="gray.800"
                  borderRadius="md"
                  bg="gray.900"
                >
                  <Text fontSize="sm" color="gray.500" mb={3}>
                    connector: {provider}
                  </Text>

                  <SimpleGrid columns={{ base: 2, md: 4 }} gap={3}>
                    {drawerMetrics.map((metric) => (
                      <Box
                        key={metric.id}
                        p={3}
                        borderWidth="1px"
                        borderColor="gray.800"
                        borderRadius="md"
                        bg="blackAlpha.300"
                      >
                        <Text
                          fontSize="xs"
                          color="gray.400"
                          fontWeight="semibold"
                          textTransform="uppercase"
                        >
                          {metric.label}
                        </Text>
                        <Text
                          mt={1}
                          fontSize="xl"
                          color={getMetricColor(metric.level)}
                          fontWeight="bold"
                          fontFamily="mono"
                          lineHeight="1.2"
                        >
                          {metric.value}
                        </Text>
                      </Box>
                    ))}
                  </SimpleGrid>
                </Box>

                {monthlyStats.length ? (
                  <Box
                    p={4}
                    borderWidth="1px"
                    borderColor="gray.800"
                    borderRadius="md"
                    bg="gray.900"
                  >
                    <Text
                      fontSize="sm"
                      color="gray.300"
                      fontWeight="semibold"
                      mb={3}
                    >
                      Monthly Performance
                    </Text>

                    <Flex direction="column" gap={4}>
                      {monthlyStats.map((yearGroup) => (
                        <Box key={yearGroup.year}>
                          <Flex align="center" gap={3} mb={3}>
                            <Text
                              fontSize="lg"
                              color="gray.100"
                              fontWeight="bold"
                              fontFamily="mono"
                            >
                              {yearGroup.year}
                            </Text>
                            <Box flex="1" h="1px" bg="gray.800" />
                          </Flex>

                          <Flex direction="column" gap={3}>
                            {buildQuarterlyMonthlyStats(yearGroup.months).map(
                              (quarter) => (
                                <Flex
                                  key={`${yearGroup.year}-${quarter.label}`}
                                  align="stretch"
                                  gap={3}
                                >
                                  <Flex
                                    w="34px"
                                    flexShrink={0}
                                    align="center"
                                    justify="center"
                                  >
                                    <Text
                                      fontSize="xs"
                                      color="gray.500"
                                      fontFamily="mono"
                                      fontWeight="bold"
                                    >
                                      {quarter.label}
                                    </Text>
                                  </Flex>

                                  <SimpleGrid columns={3} gap={3} flex="1">
                                    {quarter.months.map(
                                      (month, monthOffset) => {
                                        const monthIndex =
                                          quarter.monthIndexes[monthOffset] ??
                                          0;

                                        if (!month) {
                                          return (
                                            <Box
                                              key={`${quarter.label}-${monthIndex}-empty`}
                                              minH="116px"
                                              visibility="hidden"
                                            />
                                          );
                                        }

                                        const winRate =
                                          month.orders > 0
                                            ? (month.wins / month.orders) * 100
                                            : null;

                                        return (
                                          <Box
                                            key={month.id}
                                            p={3}
                                            minH="116px"
                                            borderWidth="1px"
                                            borderColor="gray.800"
                                            borderLeftWidth="3px"
                                            borderLeftColor={getPnlColor(
                                              month.pnl,
                                            )}
                                            borderRadius="md"
                                            bg="blackAlpha.300"
                                          >
                                            <Flex
                                              justify="space-between"
                                              align="baseline"
                                              gap={2}
                                            >
                                              <Text
                                                fontSize="sm"
                                                color="gray.200"
                                                fontWeight="bold"
                                              >
                                                {month.monthLabel}
                                              </Text>
                                              <Text
                                                fontSize="xs"
                                                color="gray.500"
                                                fontFamily="mono"
                                              >
                                                {String(
                                                  month.monthIndex,
                                                ).padStart(2, '0')}
                                              </Text>
                                            </Flex>
                                            <Text
                                              mt={3}
                                              fontSize="xl"
                                              color={getPnlColor(month.pnl)}
                                              fontWeight="bold"
                                              fontFamily="mono"
                                              lineHeight="1.2"
                                            >
                                              {formatSignedNumber(month.pnl)}
                                            </Text>
                                            <Flex
                                              mt={3}
                                              justify="space-between"
                                              gap={3}
                                            >
                                              <Box>
                                                <Text
                                                  fontSize="xs"
                                                  color="gray.500"
                                                >
                                                  Orders
                                                </Text>
                                                <Text
                                                  fontSize="sm"
                                                  color="gray.300"
                                                  fontFamily="mono"
                                                  fontWeight="semibold"
                                                >
                                                  {formatInteger(month.orders)}
                                                </Text>
                                              </Box>
                                              <Box textAlign="right">
                                                <Text
                                                  fontSize="xs"
                                                  color="gray.500"
                                                >
                                                  Win rate
                                                </Text>
                                                <Text
                                                  fontSize="sm"
                                                  color="gray.300"
                                                  fontFamily="mono"
                                                  fontWeight="semibold"
                                                >
                                                  {formatPercent(winRate)}
                                                </Text>
                                              </Box>
                                            </Flex>
                                          </Box>
                                        );
                                      },
                                    )}
                                  </SimpleGrid>
                                </Flex>
                              ),
                            )}
                          </Flex>
                        </Box>
                      ))}
                    </Flex>
                  </Box>
                ) : null}

                <Flex direction="column" gap={4}>
                  <ChartPanel
                    title="Drawdown Timeline"
                    subtitle="equity peak to current equity"
                  >
                    <DrawdownTimelineChart points={drawdownPoints} />
                  </ChartPanel>

                  <ChartPanel
                    title="Rolling Performance"
                    subtitle="last 50 trades"
                  >
                    <RollingPerformanceChart
                      points={rollingPerformancePoints}
                    />
                  </ChartPanel>

                  <ChartPanel
                    title="Win / Loss Streak Timeline"
                    subtitle="trade sequence"
                  >
                    <WinLossStreakTimelineChart trades={runtimeTradePoints} />
                  </ChartPanel>

                  <ChartPanel
                    title="P&L Distribution"
                    subtitle="trade result buckets"
                  >
                    <PnlDistributionChart bins={pnlDistributionBins} />
                  </ChartPanel>

                  <ChartPanel
                    title="P&L by Time of Day / Session"
                    subtitle="UTC"
                  >
                    <TimeOfDaySessionChart
                      sessions={sessionPnlStats}
                      hours={hourlyPnlStats}
                    />
                  </ChartPanel>
                </Flex>

                <Flex direction="column" gap={4}>
                  {renderPnlRanking({
                    title: 'P&L Ranking',
                    subtitle: 'Top 10 contracts',
                    ranking: topSymbolPnlRanking,
                    maxAbsPnl: symbolRankingMaxAbsPnl,
                  })}
                  {renderPnlRanking({
                    title: 'Worst Contracts',
                    subtitle: 'Worst 10 contracts',
                    ranking: worstSymbolPnlRanking,
                    maxAbsPnl: symbolRankingMaxAbsPnl,
                  })}
                </Flex>

                <Box
                  p={4}
                  borderWidth="1px"
                  borderColor="gray.800"
                  borderRadius="md"
                  bg="gray.900"
                >
                  <Text
                    fontSize="sm"
                    color="gray.300"
                    fontWeight="semibold"
                    mb={3}
                  >
                    LONG / SHORT
                  </Text>
                  <SimpleGrid columns={{ base: 1, md: 2 }} gap={3}>
                    {directionStats.map((group) => {
                      const ordersWithPnl = group.closed + group.active;
                      const winRate =
                        ordersWithPnl > 0
                          ? (group.wins / ordersWithPnl) * 100
                          : null;

                      return (
                        <Box
                          key={group.direction}
                          p={3}
                          borderWidth="1px"
                          borderColor="gray.800"
                          borderRadius="md"
                          bg="blackAlpha.300"
                        >
                          <Flex justify="space-between" align="center" mb={3}>
                            <Text
                              fontSize="sm"
                              color={
                                group.direction === 'LONG'
                                  ? 'teal.400'
                                  : 'pink.300'
                              }
                              fontWeight="bold"
                            >
                              {group.direction}
                            </Text>
                            {!group.orders ? (
                              <Text fontSize="xs" color="gray.500">
                                no data
                              </Text>
                            ) : null}
                          </Flex>

                          <SimpleGrid columns={1} gap={2}>
                            {[
                              [
                                'Orders',
                                formatInteger(group.orders),
                                'neutral',
                              ],
                              [
                                'Active',
                                formatInteger(group.active),
                                'warning',
                              ],
                              [
                                'Closed',
                                formatInteger(group.closed),
                                'neutral',
                              ],
                              ['Win rate', formatPercent(winRate), 'neutral'],
                              [
                                'P&L',
                                formatSignedNumber(group.pnl),
                                group.pnl > 0
                                  ? 'success'
                                  : group.pnl < 0
                                    ? 'error'
                                    : 'neutral',
                              ],
                              [
                                'Avg Profit',
                                formatSignedNumber(group.avgPnl),
                                (group.avgPnl ?? 0) > 0
                                  ? 'success'
                                  : (group.avgPnl ?? 0) < 0
                                    ? 'error'
                                    : 'neutral',
                              ],
                            ].map(([label, value, level]) => (
                              <Flex
                                key={label}
                                justify="space-between"
                                align="baseline"
                                gap={3}
                              >
                                <Text fontSize="xs" color="gray.500">
                                  {label}
                                </Text>
                                <Text
                                  fontSize="sm"
                                  color={getMetricColor(
                                    level as ThresholdLevel,
                                  )}
                                  fontFamily="mono"
                                  fontWeight="semibold"
                                  textAlign="right"
                                >
                                  {value}
                                </Text>
                              </Flex>
                            ))}
                          </SimpleGrid>
                        </Box>
                      );
                    })}
                  </SimpleGrid>
                </Box>
              </Drawer.Body>
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>

      <RuntimeStrategyChart orderLog={strategy.orderLog} stat={strategy.stat} />

      <SimpleGrid columns={{ base: 4, md: 8 }} p={4}>
        <StatItem stat={strategy.stat} id="netProfit" title="P&L" />
        <StatItem stat={strategy.stat} id="minAmount" title="Min Amount" />
        <StatItem stat={strategy.stat} id="maxDrawdown" title="Drawdown" />
        <StatItem stat={strategy.stat} id="orders" title="Orders" />
        <StatItem stat={strategy.stat} id="winRate" title="Win Rate" />
        <StatItem
          stat={strategy.stat}
          id="riskRewardRatio"
          title="Risk Ratio"
        />
        <StatItem stat={strategy.stat} id="sharpeRatio" title="Sharpe" />
        <StatItem stat={strategy.stat} id="exposure" title="Exposure" />
      </SimpleGrid>
    </Box>
  );
};
