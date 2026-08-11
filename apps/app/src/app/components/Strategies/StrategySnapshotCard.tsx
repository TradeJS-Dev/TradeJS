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
import { useMemo, useState } from 'react';
import {
  calculateAdvancedTradeMetrics,
  getFormatted,
  type AdvancedTradeInput,
} from '@tradejs/core/backtest';
import type {
  StrategyChartDetail,
  StrategyChartMetric,
  StrategyChartOrder,
  StrategyChartSnapshot,
  TestStat,
  TestThresholdsKey,
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
  OrdersDrawerPanel,
  type OrdersDrawerOrder,
} from '#components/Shared/OrdersDrawer';
import { deleteStrategyCard } from '#actions/strategies';
import {
  buildQuarterlyMonthlyStats,
  buildStrategyPerformanceViewModel,
  calculateMaxDrawdownValue,
  calculateMaxGrossStreak,
  calculateMaxLossStreak,
  formatMaxDrawdownPercent as calculateMaxDrawdownPercent,
  getEquityStepPnl as getSnapshotStepPnl,
} from '#app/lib/strategyPerformance';
import { toaster } from '#ui';
import { AdvancedMetricsPanel } from './AdvancedMetricsPanel';
import { StrategySnapshotChart } from './StrategySnapshotChart';
import {
  ChartPanel,
  DrawdownTimelineChart,
  PnlDistributionChart,
  RollingPerformanceChart,
  TimeOfDaySessionChart,
  WinLossStreakTimelineChart,
} from './StrategyPerformanceCharts';

const MS_IN_HOUR = 60 * 60 * 1000;
const SNAPSHOT_ORDER_ROW_HEIGHT = 318;
const DIRECTION_DETAIL_PREFIX = 'direction:';
const SYMBOL_DETAIL_PREFIX = 'symbol:';
const AI_STAT_DIRECTIONS = ['LONG', 'SHORT'] as const;
const SNAPSHOT_SUMMARY_METRICS: {
  id: TestThresholdsKey;
  label: string;
}[] = [
  { id: 'netProfit', label: 'P&L' },
  { id: 'minAmount', label: 'Min Amount' },
  { id: 'maxDrawdown', label: 'Drawdown' },
  { id: 'orders', label: 'Orders' },
  { id: 'winRate', label: 'Win Rate' },
  { id: 'riskRewardRatio', label: 'Risk Ratio' },
  { id: 'maxConsecutiveWins', label: 'Max Gross Streak' },
  { id: 'maxConsecutiveLosses', label: 'Max Loss Streak' },
];

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

const asFiniteNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const getSnapshotTradePnls = (snapshot: StrategyChartSnapshot) => {
  const orderPnls = snapshot.orders
    .map((order) => asFiniteNumber(order.pnl))
    .filter((pnl): pnl is number => pnl != null);

  if (orderPnls.length) {
    return orderPnls;
  }

  return snapshot.orderLog
    .map((_, index) =>
      index === 0
        ? null
        : asFiniteNumber(getSnapshotStepPnl(snapshot.orderLog, index)),
    )
    .filter((pnl): pnl is number => pnl != null);
};

const calculateSnapshotRiskRewardRatio = (pnls: number[]) => {
  const wins = pnls.filter((pnl) => pnl > 0);
  const losses = pnls.filter((pnl) => pnl < 0);

  if (!wins.length || !losses.length) {
    return null;
  }

  const avgWin = wins.reduce((sum, pnl) => sum + pnl, 0) / wins.length;
  const avgLossAbs = Math.abs(
    losses.reduce((sum, pnl) => sum + pnl, 0) / losses.length,
  );

  return avgLossAbs > 0 ? avgWin / avgLossAbs : null;
};

const buildSnapshotSummaryStat = (
  snapshot: StrategyChartSnapshot,
): Partial<TestStat> => {
  const amounts = snapshot.orderLog
    .map(([, amount]) => asFiniteNumber(amount))
    .filter((amount): amount is number => amount != null);
  const firstAmount = amounts[0] ?? null;
  const lastAmount = amounts.at(-1) ?? null;
  const pnls = getSnapshotTradePnls(snapshot);
  const wins = pnls.filter((pnl) => pnl > 0).length;
  const orders =
    asFiniteNumber(snapshot.stat?.orders) ??
    (snapshot.orders.length || pnls.length);
  const netProfit =
    asFiniteNumber(snapshot.stat?.netProfit) ??
    (firstAmount != null && lastAmount != null
      ? lastAmount - firstAmount
      : pnls.reduce((sum, pnl) => sum + pnl, 0));
  const minAmount =
    asFiniteNumber(snapshot.stat?.minAmount) ??
    (amounts.length ? Math.min(...amounts) : null);
  const maxDrawdown =
    asFiniteNumber(snapshot.stat?.maxDrawdown) ??
    calculateMaxDrawdownValue(snapshot.orderLog);
  const winRate =
    asFiniteNumber(snapshot.stat?.winRate) ??
    (orders > 0 ? (wins / orders) * 100 : 0);
  const riskRewardRatio =
    asFiniteNumber(snapshot.stat?.riskRewardRatio) ??
    calculateSnapshotRiskRewardRatio(pnls);
  const maxConsecutiveWins =
    asFiniteNumber(snapshot.stat?.maxConsecutiveWins) ??
    calculateMaxGrossStreak(snapshot.orderLog);
  const maxConsecutiveLosses =
    asFiniteNumber(snapshot.stat?.maxConsecutiveLosses) ??
    calculateMaxLossStreak(snapshot.orderLog);

  return {
    netProfit,
    minAmount: minAmount ?? undefined,
    maxDrawdown: maxDrawdown ?? undefined,
    orders,
    winRate,
    riskRewardRatio,
    maxConsecutiveWins,
    maxConsecutiveLosses,
  };
};

const buildSnapshotSummaryMetrics = (snapshot: StrategyChartSnapshot) => {
  const stat = buildSnapshotSummaryStat(snapshot);

  return SNAPSHOT_SUMMARY_METRICS.map(({ id, label }) => {
    const { formatted, level } = getFormatted(stat, id);

    return {
      id,
      label,
      value: formatted,
      tone: level,
    };
  });
};

const formatPrice = (value: number | null | undefined) =>
  formatPriceUsdt(value);

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

const normalizeSnapshotDirection = (
  direction: StrategyChartOrder['direction'],
): OrdersDrawerOrder['direction'] =>
  direction === 'LONG' || direction === 'SHORT' ? direction : null;

const getSnapshotOrderTimestamp = (order: StrategyChartOrder) => {
  const timestamp =
    order.timestamp ?? order.entryTimestamp ?? order.exitTimestamp;
  return typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? timestamp
    : null;
};

const getReplayOrderStatus = (type: string | null | undefined) => {
  if (type?.startsWith('OPEN')) {
    return { label: 'ACTIVE', color: 'orange', status: 'active' as const };
  }

  if (type?.startsWith('TAKE_PROFIT')) {
    return { label: 'TAKE PROFIT', color: 'teal', status: 'closed' as const };
  }

  if (type?.startsWith('STOP_LOSS')) {
    return { label: 'STOP LOSS', color: 'red', status: 'closed' as const };
  }

  if (type?.startsWith('CLOSE')) {
    return { label: 'CLOSE', color: 'gray', status: 'closed' as const };
  }

  return { label: 'REPLAY', color: 'gray', status: 'closed' as const };
};

const isReplayOpenOrder = (order: StrategyChartOrder) =>
  order.exitReason?.startsWith('OPEN') === true;

const getReplayPairKey = (order: StrategyChartOrder) => {
  const direction = normalizeSnapshotDirection(order.direction);
  if (!order.symbol || !direction) {
    return null;
  }

  return `${order.symbol}:${direction}`;
};

const getFiniteNumber = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const sumFiniteNumbers = (
  ...values: Array<number | null | undefined>
): number | null => {
  let total = 0;
  let hasValue = false;

  for (const value of values) {
    const finiteValue = getFiniteNumber(value);
    if (finiteValue == null) {
      continue;
    }

    total += finiteValue;
    hasValue = true;
  }

  return hasValue ? total : null;
};

const multiplyFiniteNumber = (
  value: number | null | undefined,
  multiplier: number,
) => {
  const finiteValue = getFiniteNumber(value);
  return finiteValue == null ? null : finiteValue * multiplier;
};

const buildReplayFeesDetail = ({
  openFee,
  closeFee,
  fundingFee,
}: {
  openFee?: number | null;
  closeFee?: number | null;
  fundingFee?: number | null;
}) => (
  <>
    open {formatFee(openFee)}
    <br />
    close {formatFee(closeFee)}
    <br />
    funding {formatFee(fundingFee)}
  </>
);

type ReplayOpenPosition = {
  order: StrategyChartOrder;
  remainingQty: number | null;
};

const getReplayExitShare = (
  entry: ReplayOpenPosition,
  exitOrder: StrategyChartOrder,
) => {
  const entryQty = getFiniteNumber(entry.order.qty);
  const exitQty = getFiniteNumber(exitOrder.qty);

  if (entryQty == null || entryQty <= 0 || exitQty == null || exitQty <= 0) {
    return 1;
  }

  const remainingQty = entry.remainingQty ?? entryQty;
  return Math.min(exitQty, remainingQty) / entryQty;
};

const consumeReplayEntryQty = (
  entry: ReplayOpenPosition,
  exitOrder: StrategyChartOrder,
) => {
  const exitQty = getFiniteNumber(exitOrder.qty);
  if (entry.remainingQty == null || exitQty == null) {
    return;
  }

  entry.remainingQty = Math.max(0, entry.remainingQty - exitQty);
};

const isReplayEntryConsumed = (entry: ReplayOpenPosition) =>
  entry.remainingQty != null && entry.remainingQty <= 0.00000001;

const buildReplayTradeCard = ({
  snapshot,
  entryOrder,
  exitOrder,
  tradeIndex,
  entryShare = 1,
}: {
  snapshot: StrategyChartSnapshot;
  entryOrder: StrategyChartOrder;
  exitOrder?: StrategyChartOrder;
  tradeIndex: number;
  entryShare?: number;
}): OrdersDrawerOrder => {
  const orderStatus = getReplayOrderStatus(
    exitOrder?.exitReason ?? entryOrder.exitReason,
  );
  const entryTimestamp = getSnapshotOrderTimestamp(entryOrder);
  const exitTimestamp = exitOrder ? getSnapshotOrderTimestamp(exitOrder) : null;
  const durationHours =
    entryTimestamp != null && exitTimestamp != null
      ? (exitTimestamp - entryTimestamp) / MS_IN_HOUR
      : null;
  const openFee = multiplyFiniteNumber(entryOrder.openFee, entryShare);
  const openPnl = multiplyFiniteNumber(entryOrder.pnl, entryShare);
  const closeFee = exitOrder?.closeFee ?? exitOrder?.totalFee ?? null;
  const fundingFee = sumFiniteNumbers(
    multiplyFiniteNumber(entryOrder.fundingFee, entryShare),
    exitOrder?.fundingFee,
  );
  const totalFee = sumFiniteNumbers(openFee, closeFee, fundingFee);
  const pnl = sumFiniteNumbers(openPnl, exitOrder?.pnl);
  const qty = exitOrder?.qty ?? entryOrder.qty;
  const notional =
    entryOrder.notional != null
      ? multiplyFiniteNumber(entryOrder.notional, entryShare)
      : exitOrder?.notional;

  return {
    id: `${snapshot.cardId}:replay-trade:${tradeIndex}:${entryOrder.id}:${exitOrder?.id ?? 'active'}`,
    title: entryOrder.symbol
      ? `${entryOrder.symbol} · Replay #${tradeIndex}`
      : `Replay #${tradeIndex}`,
    period: {
      start: entryTimestamp,
      end: exitTimestamp,
      durationHours,
    },
    direction: normalizeSnapshotDirection(entryOrder.direction),
    status: orderStatus.status,
    statusLabel: orderStatus.label,
    statusColor: orderStatus.color,
    pnl,
    metrics: [
      {
        title: 'Entry',
        value: formatPrice(entryOrder.entryPrice),
        detail: buildSlippageDetail({
          requestedPrice: entryOrder.requestedEntryPrice,
          slippageBps: entryOrder.entrySlippageBps,
        }),
      },
      {
        title: 'Exit',
        value: formatPrice(exitOrder?.exitPrice),
        detail: buildSlippageDetail({
          requestedPrice: exitOrder?.requestedExitPrice,
          slippageBps: exitOrder?.exitSlippageBps,
        }),
      },
      {
        title: 'Notional',
        value: formatUsdt(notional),
      },
      {
        title: 'Fees',
        value: formatFee(totalFee),
        detail: buildReplayFeesDetail({ openFee, closeFee, fundingFee }),
      },
      {
        title: 'Qty',
        value: formatCompactNumber(qty, {
          maximumFractionDigits: 8,
          minimumFractionDigits: 0,
        }),
      },
      {
        title: 'Equity',
        value: formatUsdt(exitOrder?.equityAfter ?? entryOrder.equityAfter),
        detail: `prev ${formatUsdt(entryOrder.equityBefore)}`,
      },
    ],
  };
};

const buildReplaySnapshotOrders = (
  snapshot: StrategyChartSnapshot,
): OrdersDrawerOrder[] => {
  const persistedOrders = snapshot.orders
    .map((order, index) => ({ order, index }))
    .sort((left, right) => {
      const leftTimestamp =
        getSnapshotOrderTimestamp(left.order) ?? Number.NEGATIVE_INFINITY;
      const rightTimestamp =
        getSnapshotOrderTimestamp(right.order) ?? Number.NEGATIVE_INFINITY;

      return leftTimestamp - rightTimestamp || left.index - right.index;
    });

  if (persistedOrders.length) {
    const openPositions = new Map<string, ReplayOpenPosition[]>();
    const tradeCards: OrdersDrawerOrder[] = [];

    for (const { order } of persistedOrders) {
      const pairKey = getReplayPairKey(order);
      if (!pairKey) {
        continue;
      }

      if (isReplayOpenOrder(order)) {
        const bucket = openPositions.get(pairKey) ?? [];
        bucket.push({
          order,
          remainingQty: getFiniteNumber(order.qty),
        });
        openPositions.set(pairKey, bucket);
        continue;
      }

      const bucket = openPositions.get(pairKey);
      const entry = bucket?.[0];
      if (!entry) {
        continue;
      }

      const entryShare = getReplayExitShare(entry, order);
      tradeCards.push(
        buildReplayTradeCard({
          snapshot,
          entryOrder: entry.order,
          exitOrder: order,
          tradeIndex: tradeCards.length + 1,
          entryShare,
        }),
      );
      consumeReplayEntryQty(entry, order);

      if (entry.remainingQty == null || isReplayEntryConsumed(entry)) {
        bucket.shift();
      }
    }

    for (const bucket of openPositions.values()) {
      for (const entry of bucket) {
        if (isReplayEntryConsumed(entry)) {
          continue;
        }

        tradeCards.push(
          buildReplayTradeCard({
            snapshot,
            entryOrder: entry.order,
            tradeIndex: tradeCards.length + 1,
          }),
        );
      }
    }

    return tradeCards.reverse();
  }

  return snapshot.orderLog
    .slice(1)
    .map<OrdersDrawerOrder | null>((current, index) => {
      const previous = snapshot.orderLog[index];
      if (!previous) {
        return null;
      }

      const [timestamp, equityAfter] = current;
      const [, equityBefore] = previous;
      const pnl = equityAfter - equityBefore;
      if (
        !Number.isFinite(timestamp) ||
        !Number.isFinite(equityBefore) ||
        !Number.isFinite(equityAfter) ||
        !Number.isFinite(pnl)
      ) {
        return null;
      }

      const orderIndex = index + 1;

      return {
        id: `${snapshot.cardId}:replay:${orderIndex}:${timestamp}`,
        title: `Replay #${orderIndex}`,
        period: {
          start: timestamp,
        },
        status: 'closed',
        statusLabel: 'REPLAY',
        statusColor: 'gray',
        pnl,
        metrics: [
          {
            title: 'Entry',
            value: 'n/a',
            detail: buildSlippageDetail({}),
          },
          {
            title: 'Exit',
            value: 'n/a',
            detail: buildSlippageDetail({}),
          },
          {
            title: 'Notional',
            value: formatUsdt(null),
          },
          {
            title: 'Fees',
            value: formatFee(null),
            detail: buildReplayFeesDetail({}),
          },
          {
            title: 'Qty',
            value: formatCompactNumber(null),
          },
          {
            title: 'Equity',
            value: formatUsdt(equityAfter),
            detail: `prev ${formatUsdt(equityBefore)}`,
          },
        ],
      };
    })
    .filter((order): order is OrdersDrawerOrder => order != null)
    .reverse();
};

const buildAiSnapshotOrders = (
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
        direction: normalizeSnapshotDirection(order.direction),
        status:
          typeof order.exitTimestamp === 'number' &&
          Number.isFinite(order.exitTimestamp)
            ? 'closed'
            : 'active',
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
            value: formatUsdt(order.equityAfter),
            detail: `prev ${formatUsdt(order.equityBefore)}`,
          },
        ],
      };
    });

const buildSnapshotOrders = (
  snapshot: StrategyChartSnapshot,
  mode: 'replay' | 'ai',
): OrdersDrawerOrder[] =>
  mode === 'replay'
    ? buildReplaySnapshotOrders(snapshot)
    : buildAiSnapshotOrders(snapshot);

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
        exitReason: order.exitReason ?? null,
        slippageCost,
        grossPnl: slippageCost == null ? order.pnl : order.pnl + slippageCost,
        approved: true,
        blocked: false,
      },
    ];
  });

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
    () => buildSnapshotOrders(snapshot, mode),
    [mode, snapshot],
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
  const performanceViewModel = useMemo(
    () => buildStrategyPerformanceViewModel(snapshot.orderLog),
    [snapshot.orderLog],
  );
  const {
    monthlyStats,
    tradePoints: snapshotTradePoints,
    drawdownPoints,
    rollingPerformancePoints,
    pnlDistributionBins,
    sessionPnlStats,
    hourlyPnlStats,
  } = performanceViewModel;
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
  const metrics = useMemo(
    () => buildSnapshotSummaryMetrics(snapshot),
    [snapshot],
  );
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
  const maxLossStreak = useMemo(
    () => calculateMaxLossStreak(snapshot.orderLog),
    [snapshot.orderLog],
  );
  const drawerMetrics = useMemo(
    () =>
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
    [drawerBaseMetrics, maxLossStreak, mode],
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
  const hasOrdersDrawer = snapshotOrders.length > 0;
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
                    {hasOrdersDrawer ? (
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
          rowHeight={SNAPSHOT_ORDER_ROW_HEIGHT}
          showStatusFilter={false}
          emptyText={
            mode === 'replay'
              ? 'No replay order points for this card.'
              : 'No AI order points for this card.'
          }
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
