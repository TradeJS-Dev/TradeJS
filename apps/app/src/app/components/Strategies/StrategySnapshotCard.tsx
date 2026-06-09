'use client';

import {
  Box,
  Button,
  Checkbox,
  CloseButton,
  Dialog,
  Drawer,
  Flex,
  Menu,
  Portal,
  SimpleGrid,
  Stat,
  Text,
} from '@chakra-ui/react';
import { type ReactNode, useMemo, useState } from 'react';
import {
  calculateAdvancedTradeMetrics,
  type AdvancedTradeInput,
} from '@tradejs/core/backtest';
import type {
  StrategyChartDetail,
  StrategyChartMetric,
  StrategyChartOrder,
  StrategyChartSnapshot,
} from '@tradejs/types';
import {
  formatCompactNumber,
  formatFee,
  formatInteger,
  formatPercent,
  formatSignedNumber,
  getPnlColor,
  OrdersDrawerPanel,
  type OrdersDrawerOrder,
  type OrdersDrawerSummaryItem,
} from '#components/Shared/OrdersDrawer';
import { deleteStrategyCard } from '#actions/strategies';
import { toaster } from '#ui';
import { AdvancedMetricsPanel } from './AdvancedMetricsPanel';
import { StrategySnapshotChart } from './StrategySnapshotChart';

const MS_IN_HOUR = 60 * 60 * 1000;
const SNAPSHOT_ORDER_ROW_HEIGHT = 318;
const DIRECTION_DETAIL_PREFIX = 'direction:';
const SYMBOL_DETAIL_PREFIX = 'symbol:';
const AI_STAT_DIRECTIONS = ['LONG', 'SHORT'] as const;

type AiStatDirection = (typeof AI_STAT_DIRECTIONS)[number];

interface DirectionMetric {
  id: string;
  label: string;
  value: string;
  tone?: StrategyChartMetric['tone'];
}

interface DirectionStatGroup {
  direction: AiStatDirection;
  metrics: DirectionMetric[];
  hasData: boolean;
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

interface SymbolPnlRank {
  symbol: string;
  pnl: number;
  orders: number | null;
  winRate: number | null;
  avgPnl: number | null;
}

interface AiDiagnosticMetric {
  id: string;
  label: string;
  value: string;
  detail?: string;
  tone?: StrategyChartMetric['tone'];
}

interface AiDiagnosticGroup {
  id: string;
  title: string;
  description: string;
  columns: number;
  metrics: AiDiagnosticMetric[];
}

interface SnapshotTradePoint {
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

type TradingSession = 'Asia' | 'Europe' | 'US';

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

const getMetricColor = (tone: StrategyChartMetric['tone']) => {
  switch (tone) {
    case 'success':
      return 'teal.500';
    case 'warning':
      return 'fg.warning';
    case 'neutral':
      return 'gray.300';
    case 'error':
      return 'fg.error';
    default:
      return 'gray.200';
  }
};

const calculateMaxDrawdownPercent = (orderLog: Array<[number, number]>) => {
  if (!orderLog.length) {
    return null;
  }

  let peak = orderLog[0]?.[1] ?? 0;
  let maxDrawdownPercent = 0;

  for (const [, amount] of orderLog) {
    if (!Number.isFinite(amount)) {
      continue;
    }

    peak = Math.max(peak, amount);
    if (peak <= 0) {
      continue;
    }

    const drawdownPercent = ((peak - amount) / peak) * 100;
    maxDrawdownPercent = Math.max(maxDrawdownPercent, drawdownPercent);
  }

  return `${maxDrawdownPercent.toFixed(1)}%`;
};

const getSnapshotStepPnl = (
  orderLog: StrategyChartSnapshot['orderLog'],
  index: number,
) => {
  const current = orderLog[index];
  const previous = orderLog[index - 1];

  if (!current || !previous) {
    return null;
  }

  return current[1] - previous[1];
};

const calculateMaxLossStreak = (
  orderLog: StrategyChartSnapshot['orderLog'],
) => {
  let currentStreak = 0;
  let maxStreak = 0;

  for (let index = 1; index < orderLog.length; index += 1) {
    const pnl = getSnapshotStepPnl(orderLog, index);
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

const resolveTradingSession = (hour: number): TradingSession => {
  if (hour < 8) {
    return 'Asia';
  }

  if (hour < 16) {
    return 'Europe';
  }

  return 'US';
};

const buildSnapshotTradePoints = (
  orderLog: StrategyChartSnapshot['orderLog'],
): SnapshotTradePoint[] => {
  const points: SnapshotTradePoint[] = [];

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
  orderLog: StrategyChartSnapshot['orderLog'],
): DrawdownPoint[] => {
  let peak = orderLog[0]?.[1] ?? 0;

  return orderLog
    .map(([timestamp, equity]) => {
      if (!Number.isFinite(equity)) {
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
  trades: SnapshotTradePoint[],
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
  trades: SnapshotTradePoint[],
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
  trades: SnapshotTradePoint[],
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

const buildHourlyPnlStats = (trades: SnapshotTradePoint[]): HourlyPnlStat[] => {
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

const formatPrice = (value: number | null | undefined) =>
  formatCompactNumber(value, {
    maximumFractionDigits: 8,
    minimumFractionDigits: 0,
  });

const formatUsdt = (value: number | null | undefined) =>
  `${formatCompactNumber(value, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })} USDT`;

const formatBps = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  return `${formatCompactNumber(value, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })} bps`;
};

const formatAiExitReason = (reason: string | null | undefined) =>
  reason ? reason.replace(/_/g, ' ').toUpperCase() : 'CLOSED';

const CHART_WIDTH = 640;
const CHART_HEIGHT = 120;
const CHART_PADDING = 10;
const POSITIVE_CHART_COLOR = '#5eead4';
const NEGATIVE_CHART_COLOR = '#f87171';
const NEUTRAL_CHART_COLOR = '#6b7280';

const getChartPnlColor = (value: number) =>
  value > 0
    ? POSITIVE_CHART_COLOR
    : value < 0
      ? NEGATIVE_CHART_COLOR
      : NEUTRAL_CHART_COLOR;

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
  trades: SnapshotTradePoint[];
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

const getAiExitReasonColor = (reason: string | null | undefined) => {
  switch (reason) {
    case 'take_profit':
      return 'teal';
    case 'stop_loss':
      return 'red';
    default:
      return 'gray';
  }
};

const buildSlippageDetail = ({
  requestedPrice,
  slippageBps,
}: {
  requestedPrice?: number | null;
  slippageBps?: number | null;
}) => (
  <>
    plan {formatPrice(requestedPrice)}
    <br />
    slip {formatBps(slippageBps)}
  </>
);

const buildAiFeesDetail = (order: StrategyChartOrder) => (
  <>
    open {formatFee(order.openFee)}
    <br />
    close {formatFee(order.closeFee)}
    <br />
    funding {formatFee(order.fundingFee)}
  </>
);

const buildSnapshotOrders = (
  snapshot: StrategyChartSnapshot,
): OrdersDrawerOrder[] =>
  snapshot.orders
    .map((order, index) => ({ order, index }))
    .sort((left, right) => {
      const leftEntry =
        typeof left.order.entryTimestamp === 'number' &&
        Number.isFinite(left.order.entryTimestamp)
          ? left.order.entryTimestamp
          : Number.NEGATIVE_INFINITY;
      const rightEntry =
        typeof right.order.entryTimestamp === 'number' &&
        Number.isFinite(right.order.entryTimestamp)
          ? right.order.entryTimestamp
          : Number.NEGATIVE_INFINITY;

      return rightEntry - leftEntry || left.index - right.index;
    })
    .map(({ order, index }) => {
      const orderIndex = order.sequence ?? index + 1;
      const durationHours =
        typeof order.entryTimestamp === 'number' &&
        Number.isFinite(order.entryTimestamp) &&
        typeof order.exitTimestamp === 'number' &&
        Number.isFinite(order.exitTimestamp)
          ? (order.exitTimestamp - order.entryTimestamp) / MS_IN_HOUR
          : null;
      const title = order.symbol
        ? `${order.symbol} · AI step #${orderIndex}`
        : `AI step #${orderIndex}`;

      return {
        id: `${snapshot.cardId}:${order.id}`,
        title,
        period: {
          start: order.entryTimestamp,
          end: order.exitTimestamp,
          durationHours,
        },
        direction:
          order.direction === 'LONG' || order.direction === 'SHORT'
            ? order.direction
            : null,
        statusLabel: formatAiExitReason(order.exitReason),
        statusColor: getAiExitReasonColor(order.exitReason),
        pnl: order.pnl,
        metrics: [
          {
            title: 'Entry',
            value: formatPrice(order.entryPrice),
            detail: buildSlippageDetail({
              requestedPrice: order.requestedEntryPrice,
              slippageBps: order.entrySlippageBps,
            }),
          },
          {
            title: 'Exit',
            value: formatPrice(order.exitPrice),
            detail: buildSlippageDetail({
              requestedPrice: order.requestedExitPrice,
              slippageBps: order.exitSlippageBps,
            }),
          },
          {
            title: 'Notional',
            value: formatUsdt(order.notional),
          },
          {
            title: 'Fees',
            value: formatFee(order.totalFee),
            detail: buildAiFeesDetail(order),
          },
          {
            title: 'Qty',
            value: formatCompactNumber(order.qty, {
              maximumFractionDigits: 8,
              minimumFractionDigits: 0,
            }),
          },
          {
            title: 'Equity',
            value: formatCompactNumber(order.equityAfter, {
              maximumFractionDigits: 2,
              minimumFractionDigits: 2,
            }),
            detail: `prev ${formatCompactNumber(order.equityBefore, {
              maximumFractionDigits: 2,
              minimumFractionDigits: 2,
            })}`,
          },
        ],
      };
    });

const buildSnapshotAdvancedTrades = (
  snapshot: StrategyChartSnapshot,
): AdvancedTradeInput[] =>
  snapshot.orders.flatMap((order): AdvancedTradeInput[] => {
    const timestamp =
      order.exitTimestamp ?? order.timestamp ?? order.entryTimestamp;

    if (
      typeof timestamp !== 'number' ||
      !Number.isFinite(timestamp) ||
      typeof order.pnl !== 'number' ||
      !Number.isFinite(order.pnl)
    ) {
      return [];
    }

    const slippageCost =
      typeof order.totalSlippageCost === 'number' &&
      Number.isFinite(order.totalSlippageCost)
        ? Math.abs(order.totalSlippageCost)
        : null;

    return [
      {
        id: order.id,
        timestamp,
        pnl: order.pnl,
        symbol: order.symbol ?? null,
        direction: order.direction ?? null,
        slippageCost,
        grossPnl: slippageCost == null ? order.pnl : order.pnl + slippageCost,
        approved: true,
        blocked: false,
      },
    ];
  });

const buildSnapshotSummaryItems = (
  snapshot: StrategyChartSnapshot,
): OrdersDrawerSummaryItem[] => {
  const orders = snapshot.orderLog.slice(1);
  const winningOrders = orders.filter((_, index) => {
    const pnl = getSnapshotStepPnl(snapshot.orderLog, index + 1);
    return typeof pnl === 'number' && Number.isFinite(pnl) && pnl > 0;
  });
  const firstAmount = snapshot.orderLog[0]?.[1] ?? null;
  const lastAmount = snapshot.orderLog.at(-1)?.[1] ?? null;
  const totalPnl =
    typeof firstAmount === 'number' &&
    Number.isFinite(firstAmount) &&
    typeof lastAmount === 'number' &&
    Number.isFinite(lastAmount)
      ? lastAmount - firstAmount
      : null;
  const winRate =
    orders.length > 0 ? (winningOrders.length / orders.length) * 100 : 0;

  return [
    {
      title: 'Total Orders',
      value: formatInteger(orders.length),
    },
    {
      title: 'Win Rate',
      value: formatPercent(winRate),
    },
    {
      title: 'P&L',
      value: formatSignedNumber(totalPnl),
      color: getPnlColor(totalPnl),
    },
    {
      title: 'Max Drawdown',
      value: calculateMaxDrawdownPercent(snapshot.orderLog) ?? 'n/a',
      color: 'fg.warning',
    },
  ];
};

const directionMetricLabels: Record<string, string> = {
  approved: 'Approved',
  precision: 'Precision',
  monthlyPnl: 'Monthly P&L',
  pnl: 'P&L',
  avgProfit: 'Avg Profit',
};

const directionMetricOrder = [
  'approved',
  'precision',
  'monthlyPnl',
  'pnl',
  'avgProfit',
] as const;

const aiDrawerMetricOrder = [
  'monthlyPnl',
  'avgProfit',
  'maxDrawdown',
  'maxLossStreak',
  'approved',
  'approvedPerDay',
  'accuracy',
  'precision',
] as const;

const aiDrawerMetricOrderIndex = new Map<string, number>(
  aiDrawerMetricOrder.map((metricId, index) => [metricId, index]),
);

const sortAiDrawerMetrics = (metrics: StrategyChartMetric[]) =>
  metrics
    .filter((metric) => metric.id !== 'recall')
    .sort((left, right) => {
      const leftIndex = aiDrawerMetricOrderIndex.get(left.id) ?? 100;
      const rightIndex = aiDrawerMetricOrderIndex.get(right.id) ?? 100;

      return leftIndex - rightIndex || left.label.localeCompare(right.label);
    });

const isDirectionDetail = (detail: StrategyChartDetail) =>
  detail.id.startsWith(DIRECTION_DETAIL_PREFIX);

const isSymbolDetail = (detail: StrategyChartDetail) =>
  detail.id.startsWith(SYMBOL_DETAIL_PREFIX);

const isStructuredDetail = (detail: StrategyChartDetail) =>
  isDirectionDetail(detail) || isSymbolDetail(detail);

const getDetailById = (
  details: StrategyChartDetail[] | undefined,
  id: string,
) => details?.find((detail) => detail.id === id) ?? null;

const parseFormattedNumber = (value: string) => {
  const normalized = value
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/[^\d.+-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseConfusionDetail = (detail: StrategyChartDetail | null) => {
  if (!detail) {
    return null;
  }

  const values = detail.value
    .split('/')
    .map((part) => parseFormattedNumber(part))
    .filter((value): value is number => value !== null);

  return values.length === 4 ? values : null;
};

const getPnlBarColor = (value: number) => {
  if (value > 0) {
    return 'teal.500';
  }
  if (value < 0) {
    return 'red.500';
  }
  return 'gray.500';
};

const buildDirectionStatGroups = (
  details: StrategyChartDetail[] | undefined,
): DirectionStatGroup[] => {
  const grouped = new Map<AiStatDirection, Map<string, DirectionMetric>>();

  for (const direction of AI_STAT_DIRECTIONS) {
    grouped.set(direction, new Map());
  }

  for (const detail of details ?? []) {
    const [, direction, metricId] = detail.id.split(':');
    if (metricId == null) {
      continue;
    }

    if (direction !== 'LONG' && direction !== 'SHORT') {
      continue;
    }

    const metric: DirectionMetric = {
      id: metricId,
      label: directionMetricLabels[metricId] ?? detail.label,
      value: detail.value,
    };
    if (detail.tone) {
      metric.tone = detail.tone;
    }

    grouped.get(direction)?.set(metricId, metric);
  }

  return AI_STAT_DIRECTIONS.map((direction) => {
    const values = grouped.get(direction) ?? new Map<string, DirectionMetric>();
    const metrics = directionMetricOrder.map(
      (metricId): DirectionMetric =>
        values.get(metricId) ?? {
          id: metricId,
          label: directionMetricLabels[metricId],
          value: 'n/a',
          tone: 'default',
        },
    );

    return {
      direction,
      metrics,
      hasData: values.size > 0,
    };
  });
};

const buildAiDiagnosticGroups = (
  details: StrategyChartDetail[] | undefined,
): AiDiagnosticGroup[] => {
  const plainDetails = details?.filter((detail) => !isStructuredDetail(detail));
  const groups: AiDiagnosticGroup[] = [];
  const windowDetail = getDetailById(plainDetails, 'window');
  const confusion = parseConfusionDetail(
    getDetailById(plainDetails, 'confusion'),
  );
  const avgProfitAll = getDetailById(plainDetails, 'avgProfitAll');
  const expectancyDelta = getDetailById(plainDetails, 'expectancyDelta');

  if (windowDetail) {
    groups.push({
      id: 'window',
      title: 'Evaluation window',
      description: 'source rows used for this AI snapshot',
      columns: 1,
      metrics: [
        {
          id: windowDetail.id,
          label: 'Window',
          value: windowDetail.value,
          detail: 'UTC range',
          tone: windowDetail.tone,
        },
      ],
    });
  }

  if (confusion) {
    const [truePositive, falsePositive, trueNegative, falseNegative] =
      confusion;

    groups.push({
      id: 'confusion',
      title: 'Decision matrix',
      description: 'approved vs blocked outcomes',
      columns: 4,
      metrics: [
        {
          id: 'truePositive',
          label: 'TP',
          value: formatInteger(truePositive),
          detail: 'winner approved',
          tone: 'success',
        },
        {
          id: 'falsePositive',
          label: 'FP',
          value: formatInteger(falsePositive),
          detail: 'loser approved',
          tone: falsePositive > 0 ? 'warning' : 'neutral',
        },
        {
          id: 'trueNegative',
          label: 'TN',
          value: formatInteger(trueNegative),
          detail: 'loser blocked',
          tone: 'success',
        },
        {
          id: 'falseNegative',
          label: 'FN',
          value: formatInteger(falseNegative),
          detail: 'winner blocked',
          tone: falseNegative > 0 ? 'warning' : 'neutral',
        },
      ],
    });
  }

  const liftMetrics: AiDiagnosticMetric[] = [];

  if (avgProfitAll) {
    liftMetrics.push({
      id: avgProfitAll.id,
      label: 'Avg all candidates',
      value: avgProfitAll.value,
      detail: 'before AI approval',
      tone: avgProfitAll.tone,
    });
  }

  if (expectancyDelta) {
    liftMetrics.push({
      id: expectancyDelta.id,
      label: 'Expectancy lift',
      value: expectancyDelta.value,
      detail: 'approved avg minus all avg',
      tone: expectancyDelta.tone,
    });
  }

  if (liftMetrics.length) {
    groups.push({
      id: 'lift',
      title: 'Gate lift',
      description: 'what approval changes',
      columns: 2,
      metrics: liftMetrics,
    });
  }

  return groups;
};

const AiDiagnosticCard = ({ metric }: { metric: AiDiagnosticMetric }) => (
  <Box
    p={3}
    borderWidth="1px"
    borderColor="gray.800"
    borderRadius="md"
    bg="blackAlpha.200"
    minW="0"
  >
    <Text
      fontSize="2xs"
      color="gray.500"
      fontWeight="bold"
      textTransform="uppercase"
      lineHeight="1.2"
    >
      {metric.label}
    </Text>
    <Text
      mt={2}
      fontSize="lg"
      color={getMetricColor(metric.tone)}
      fontWeight="bold"
      fontFamily="mono"
      lineHeight="1.15"
      whiteSpace="nowrap"
      overflow="hidden"
      textOverflow="ellipsis"
    >
      {metric.value}
    </Text>
    {metric.detail ? (
      <Text
        mt={2}
        fontSize="xs"
        color="gray.500"
        lineHeight="1.25"
        whiteSpace="nowrap"
        overflow="hidden"
        textOverflow="ellipsis"
      >
        {metric.detail}
      </Text>
    ) : null}
  </Box>
);

const AiDiagnosticGroupBlock = ({ group }: { group: AiDiagnosticGroup }) => (
  <Box>
    <Flex justify="space-between" align="baseline" gap={3} mb={3}>
      <Text color="gray.300" fontSize="sm" fontWeight="semibold">
        {group.title}
      </Text>
      <Text color="gray.600" fontSize="xs" textAlign="right">
        {group.description}
      </Text>
    </Flex>
    <SimpleGrid
      columns={{ base: 1, md: Math.min(group.columns, 3), xl: group.columns }}
      gap={3}
    >
      {group.metrics.map((metric) => (
        <AiDiagnosticCard key={metric.id} metric={metric} />
      ))}
    </SimpleGrid>
  </Box>
);

const AiDiagnosticsPanel = ({ groups }: { groups: AiDiagnosticGroup[] }) => {
  if (!groups.length) {
    return null;
  }

  return (
    <Box
      p={4}
      borderWidth="1px"
      borderColor="gray.800"
      borderRadius="md"
      bg="gray.900"
    >
      <Flex justify="space-between" align="baseline" gap={4}>
        <Text fontSize="md" fontWeight="semibold" color="gray.100">
          AI diagnostics
        </Text>
        <Text color="gray.600" fontSize="xs" textAlign="right">
          classifier-only details
        </Text>
      </Flex>
      <Flex direction="column" gap={5} mt={4}>
        {groups.map((group) => (
          <AiDiagnosticGroupBlock key={group.id} group={group} />
        ))}
      </Flex>
    </Box>
  );
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
  orderLog: StrategyChartSnapshot['orderLog'],
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
      typeof timestamp !== 'number' ||
      !Number.isFinite(timestamp) ||
      typeof amount !== 'number' ||
      !Number.isFinite(amount) ||
      typeof previousAmount !== 'number' ||
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

const buildSymbolPnlRanking = (
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

export const StrategySnapshotCard = ({
  snapshot,
  emptyText,
  mode,
  onDeleted,
  selected = false,
  onToggleSelection,
}: {
  snapshot: StrategyChartSnapshot;
  emptyText: string;
  mode: 'replay' | 'ai';
  onDeleted?: (cardId: string) => void;
  selected?: boolean;
  onToggleSelection?: (cardId: string, checked: boolean) => void;
}) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const snapshotOrders = useMemo(
    () => buildSnapshotOrders(snapshot),
    [snapshot],
  );
  const snapshotSummaryItems = useMemo(
    () => buildSnapshotSummaryItems(snapshot),
    [snapshot],
  );
  const aiDiagnosticGroups = useMemo(
    () => buildAiDiagnosticGroups(snapshot.details),
    [snapshot.details],
  );
  const directionStatGroups = useMemo(
    () => buildDirectionStatGroups(snapshot.details),
    [snapshot.details],
  );
  const symbolPnlRanking = useMemo(
    () => buildSymbolPnlRanking(snapshot.details),
    [snapshot.details],
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
  const monthlyStats = useMemo(
    () => buildMonthlyStats(snapshot.orderLog),
    [snapshot.orderLog],
  );
  const snapshotTradePoints = useMemo(
    () => buildSnapshotTradePoints(snapshot.orderLog),
    [snapshot.orderLog],
  );
  const drawdownPoints = useMemo(
    () => buildDrawdownPoints(snapshot.orderLog),
    [snapshot.orderLog],
  );
  const rollingPerformancePoints = useMemo(
    () => buildRollingPerformance(snapshotTradePoints, 50),
    [snapshotTradePoints],
  );
  const pnlDistributionBins = useMemo(
    () => buildPnlDistribution(snapshotTradePoints),
    [snapshotTradePoints],
  );
  const sessionPnlStats = useMemo(
    () => buildSessionPnlStats(snapshotTradePoints),
    [snapshotTradePoints],
  );
  const hourlyPnlStats = useMemo(
    () => buildHourlyPnlStats(snapshotTradePoints),
    [snapshotTradePoints],
  );
  const symbolsLabel =
    snapshot.symbols.length > 3
      ? `${snapshot.symbols.slice(0, 3).join(', ')} +${snapshot.symbols.length - 3}`
      : snapshot.symbols.join(', ') || 'n/a';
  const sourceLabel =
    mode === 'ai' && snapshot.datasetId ? 'dataset:' : 'symbols:';
  const sourceValue =
    mode === 'ai' && snapshot.datasetId ? snapshot.datasetId : symbolsLabel;
  const tagsLabel = snapshot.tags?.join(' · ') ?? '';
  const displaySubtitle =
    mode === 'ai'
      ? snapshot.subtitle?.replace(/^q\d+\+\s*(?:·\s*)?/i, '').trim()
      : snapshot.subtitle;
  const metrics =
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
  const maxLossStreak = useMemo(
    () => calculateMaxLossStreak(snapshot.orderLog),
    [snapshot.orderLog],
  );
  const drawerMetrics = useMemo(
    () =>
      mode === 'ai'
        ? sortAiDrawerMetrics([
            ...metrics,
            {
              id: 'maxLossStreak',
              label: 'Max loss streak',
              value: formatInteger(maxLossStreak),
              tone:
                maxLossStreak > 0 ? ('warning' as const) : ('success' as const),
            },
          ])
        : metrics,
    [maxLossStreak, metrics, mode],
  );
  const advancedMetrics = useMemo(() => {
    const firstPoint = snapshot.orderLog[0];
    const lastPoint = snapshot.orderLog[snapshot.orderLog.length - 1];

    return calculateAdvancedTradeMetrics({
      trades: buildSnapshotAdvancedTrades(snapshot),
      orderLog: snapshot.orderLog,
      startTimestamp: firstPoint?.[0] ?? null,
      endTimestamp: lastPoint?.[0] ?? null,
    });
  }, [snapshot]);
  const hasStatDrawer = mode === 'ai' || Boolean(snapshot.details?.length);

  const handleDelete = async () => {
    if (isDeleting) {
      return;
    }

    setIsDeleting(true);
    try {
      const deleted = await deleteStrategyCard(mode, snapshot.cardId);
      if (!deleted) {
        toaster.error({
          title: 'Delete failed',
          description: 'Strategy card was not deleted.',
        });
        return;
      }

      onDeleted?.(snapshot.cardId);
      setDeleteOpen(false);
      toaster.success({
        title: 'Strategy card deleted',
        description: snapshot.title,
      });
    } catch {
      toaster.error({
        title: 'Delete failed',
        description: 'Unexpected error while deleting strategy card.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const renderSymbolPnlRanking = ({
    title,
    subtitle,
    ranking,
  }: {
    title: string;
    subtitle: string;
    ranking: SymbolPnlRank[];
  }) => (
    <Box
      p={4}
      borderWidth="1px"
      borderColor="gray.800"
      borderRadius="md"
      bg="gray.900"
    >
      <Flex justify="space-between" align="center" mb={4}>
        <Text fontSize="sm" color="gray.300" fontWeight="semibold">
          {title}
        </Text>
        <Text fontSize="xs" color="gray.500">
          {subtitle}
        </Text>
      </Flex>

      {ranking.length ? (
        <>
          <Flex align="center" gap={4} mb={2}>
            <Text
              flex="0 0 220px"
              fontSize="xs"
              color="gray.500"
              fontWeight="semibold"
            >
              Contracts
            </Text>
            <Box flex="1" />
            <Text
              flex="0 0 96px"
              fontSize="xs"
              color="gray.500"
              fontWeight="semibold"
              textAlign="right"
            >
              P&L (USDT)
            </Text>
          </Flex>

          <Flex direction="column" gap={3}>
            {ranking.map((rank) => {
              const barWidth = Math.max(
                6,
                (Math.abs(rank.pnl) / symbolRankingMaxAbsPnl) * 100,
              );

              return (
                <Flex key={rank.symbol} align="center" gap={4} minH="34px">
                  <Box flex="0 0 220px" minW={0}>
                    <Text
                      fontSize="sm"
                      color="gray.100"
                      fontWeight="semibold"
                      lineHeight="1.2"
                      overflow="hidden"
                      textOverflow="ellipsis"
                      whiteSpace="nowrap"
                    >
                      {rank.symbol}
                    </Text>
                    <Text
                      mt={1}
                      fontSize="xs"
                      color="gray.500"
                      fontFamily="mono"
                    >
                      {formatInteger(rank.orders)} orders · win{' '}
                      {formatPercent(rank.winRate)} · avg{' '}
                      {rank.avgPnl == null
                        ? 'n/a'
                        : formatSignedNumber(rank.avgPnl)}
                    </Text>
                  </Box>

                  <Box flex="1" h="12px" bg="gray.800">
                    <Box
                      h="full"
                      w={`${barWidth}%`}
                      bg={getPnlBarColor(rank.pnl)}
                    />
                  </Box>

                  <Text
                    flex="0 0 96px"
                    color={getPnlColor(rank.pnl)}
                    fontSize="lg"
                    fontFamily="mono"
                    fontWeight="bold"
                    textAlign="right"
                  >
                    {formatSignedNumber(rank.pnl)}
                  </Text>
                </Flex>
              );
            })}
          </Flex>
        </>
      ) : (
        <Box
          p={3}
          borderWidth="1px"
          borderColor="gray.800"
          borderRadius="md"
          bg="blackAlpha.300"
        >
          <Text fontSize="sm" color="gray.500">
            No symbol P&L data
          </Text>
        </Box>
      )}
    </Box>
  );

  return (
    <Box
      p={2}
      mb={4}
      maxW="1400px"
      borderRadius="md"
      shadow="sm"
      borderWidth="1px"
      borderColor="gray.800"
      overflowX="auto"
    >
      <Flex gap="4" p={4} mb={3} alignItems="center" wrap="wrap">
        {onToggleSelection ? (
          <Checkbox.Root
            size="sm"
            colorPalette="teal"
            checked={selected}
            onCheckedChange={(details) =>
              onToggleSelection(snapshot.cardId, details.checked === true)
            }
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control bg="gray.800" borderColor="gray.500" />
          </Checkbox.Root>
        ) : null}

        <Text fontSize="lg" fontWeight="bold" color="gray.200">
          {snapshot.title}
        </Text>

        <Flex gap="1">
          <Text fontSize="sm" fontWeight="bold" color="gray.400" mt={1}>
            {sourceLabel}
          </Text>
          <Text fontSize="lg" fontWeight="bold" color="gray.200">
            {sourceValue}
          </Text>
        </Flex>

        {tagsLabel ? (
          <Box
            px={2}
            py={1}
            borderWidth="1px"
            borderColor="teal.900"
            borderRadius="sm"
            bg="teal.950"
            color="teal.300"
            fontFamily="mono"
            fontSize="sm"
            fontWeight="semibold"
            lineHeight="1"
          >
            {tagsLabel}
          </Box>
        ) : null}

        <Flex ml="auto" align="center" gap={3}>
          {displaySubtitle ? (
            <Box
              order={0}
              px={2}
              py={1}
              borderWidth="1px"
              borderColor="gray.700"
              borderRadius="sm"
              bg="gray.800"
              color="gray.200"
              fontFamily="mono"
              fontSize="sm"
              fontWeight="semibold"
              lineHeight="1"
            >
              {displaySubtitle}
            </Box>
          ) : null}

          <Box order={1}>
            <Menu.Root positioning={{ placement: 'bottom-end' }}>
              <Menu.Trigger asChild>
                <Button size="sm" variant="outline">
                  Actions
                </Button>
              </Menu.Trigger>
              <Portal>
                <Menu.Positioner>
                  <Menu.Content minW="160px">
                    {mode === 'ai' && snapshotOrders.length ? (
                      <Menu.Item
                        value="orders"
                        onClick={() => setOrdersOpen(true)}
                      >
                        Orders
                      </Menu.Item>
                    ) : null}
                    {hasStatDrawer ? (
                      <Menu.Item
                        value="stat"
                        onClick={() => setDetailsOpen(true)}
                      >
                        Stat
                      </Menu.Item>
                    ) : null}
                    {hasStatDrawer ? <Menu.Separator /> : null}
                    <Menu.Item
                      value="delete"
                      color="fg.error"
                      onClick={() => setDeleteOpen(true)}
                    >
                      Delete
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Positioner>
              </Portal>
            </Menu.Root>
          </Box>
        </Flex>

        <OrdersDrawerPanel
          title={`${snapshot.title} orders`}
          open={ordersOpen}
          orders={snapshotOrders}
          summaryItems={snapshotSummaryItems}
          rowHeight={SNAPSHOT_ORDER_ROW_HEIGHT}
          emptyText="No AI order points for this card."
          onOpenChange={setOrdersOpen}
        />

        <Drawer.Root
          size="xl"
          open={detailsOpen}
          onOpenChange={(e) => setDetailsOpen(e.open)}
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
                  <Drawer.Title>{snapshot.title}</Drawer.Title>
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
                  <Box
                    p={4}
                    borderWidth="1px"
                    borderColor="gray.800"
                    borderRadius="md"
                    bg="gray.900"
                  >
                    <Text fontSize="sm" color="gray.500" mb={3}>
                      {snapshot.subtitle || 'AI train details'}
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
                            color={getMetricColor(metric.tone)}
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

                  <AdvancedMetricsPanel metrics={advancedMetrics} />

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
                                              ? (month.wins / month.orders) *
                                                100
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
                                                    {formatInteger(
                                                      month.orders,
                                                    )}
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

                  {mode === 'ai' ? (
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
                        <WinLossStreakTimelineChart
                          trades={snapshotTradePoints}
                        />
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
                  ) : null}

                  {mode === 'ai' ? (
                    <Flex direction="column" gap={4}>
                      {renderSymbolPnlRanking({
                        title: 'P&L Ranking',
                        subtitle: 'Top 10 contracts',
                        ranking: topSymbolPnlRanking,
                      })}
                      {renderSymbolPnlRanking({
                        title: 'Worst Contracts',
                        subtitle: 'Worst 10 contracts',
                        ranking: worstSymbolPnlRanking,
                      })}
                    </Flex>
                  ) : null}

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
                      {directionStatGroups.map((group) => (
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
                            {!group.hasData ? (
                              <Text fontSize="xs" color="gray.500">
                                no data
                              </Text>
                            ) : null}
                          </Flex>

                          <SimpleGrid columns={1} gap={2}>
                            {group.metrics.map((metric) => (
                              <Flex
                                key={metric.id}
                                justify="space-between"
                                align="baseline"
                                gap={3}
                              >
                                <Text fontSize="xs" color="gray.500">
                                  {metric.label}
                                </Text>
                                <Text
                                  fontSize="sm"
                                  color={getMetricColor(metric.tone)}
                                  fontFamily="mono"
                                  fontWeight="semibold"
                                  textAlign="right"
                                >
                                  {metric.value}
                                </Text>
                              </Flex>
                            ))}
                          </SimpleGrid>
                        </Box>
                      ))}
                    </SimpleGrid>
                  </Box>

                  <AiDiagnosticsPanel groups={aiDiagnosticGroups} />
                </Drawer.Body>
              </Drawer.Content>
            </Drawer.Positioner>
          </Portal>
        </Drawer.Root>

        <Dialog.Root
          open={deleteOpen}
          onOpenChange={(e) => setDeleteOpen(e.open)}
        >
          <Portal>
            <Dialog.Backdrop />
            <Dialog.Positioner>
              <Dialog.Content>
                <Dialog.Header>
                  <Dialog.Title>Delete card</Dialog.Title>
                  <Dialog.CloseTrigger asChild>
                    <CloseButton position="absolute" right="3" top="3" />
                  </Dialog.CloseTrigger>
                </Dialog.Header>
                <Dialog.Body>
                  <Text fontSize="sm" color="gray.200">
                    Delete strategy card <b>{snapshot.title}</b>?
                  </Text>
                  <Text fontSize="sm" color="gray.400" mt={2}>
                    This action cannot be undone.
                  </Text>
                </Dialog.Body>
                <Dialog.Footer>
                  <Dialog.ActionTrigger asChild>
                    <Button variant="outline" size="sm" disabled={isDeleting}>
                      Cancel
                    </Button>
                  </Dialog.ActionTrigger>
                  <Button
                    colorPalette="red"
                    size="sm"
                    onClick={handleDelete}
                    loading={isDeleting}
                  >
                    Delete
                  </Button>
                </Dialog.Footer>
              </Dialog.Content>
            </Dialog.Positioner>
          </Portal>
        </Dialog.Root>
      </Flex>

      <StrategySnapshotChart
        orderLog={snapshot.orderLog}
        emptyText={emptyText}
      />

      <SimpleGrid columns={{ base: 4, md: 8 }} p={4}>
        {metrics.map((metric) => (
          <Stat.Root key={metric.id} size="md">
            <Stat.Label>{metric.label}</Stat.Label>
            <Stat.ValueText color={getMetricColor(metric.tone)}>
              {metric.value}
            </Stat.ValueText>
          </Stat.Root>
        ))}
      </SimpleGrid>
    </Box>
  );
};
