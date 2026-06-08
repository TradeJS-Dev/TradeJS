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

const parseFormattedNumber = (value: string) => {
  const normalized = value
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/[^\d.+-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
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
    }))
    .sort(
      (left, right) =>
        Math.abs(right.pnl) - Math.abs(left.pnl) ||
        right.pnl - left.pnl ||
        left.symbol.localeCompare(right.symbol),
    )
    .slice(0, 10);
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
  const visibleDetails = useMemo(
    () =>
      (snapshot.details ?? []).filter((detail) => !isStructuredDetail(detail)),
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
  const symbolRankingMaxAbsPnl = useMemo(
    () => Math.max(...symbolPnlRanking.map((rank) => Math.abs(rank.pnl)), 1),
    [symbolPnlRanking],
  );
  const monthlyStats = useMemo(
    () => buildMonthlyStats(snapshot.orderLog),
    [snapshot.orderLog],
  );
  const symbolsLabel =
    snapshot.symbols.length > 3
      ? `${snapshot.symbols.slice(0, 3).join(', ')} +${snapshot.symbols.length - 3}`
      : snapshot.symbols.join(', ') || 'n/a';
  const sourceLabel =
    mode === 'ai' && snapshot.datasetId ? 'dataset:' : 'symbols:';
  const sourceValue =
    mode === 'ai' && snapshot.datasetId ? snapshot.datasetId : symbolsLabel;
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

        <Flex ml="auto" align="center" gap={3}>
          {displaySubtitle ? (
            <Box
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
                    <Box
                      p={4}
                      borderWidth="1px"
                      borderColor="gray.800"
                      borderRadius="md"
                      bg="gray.900"
                    >
                      <Flex justify="space-between" align="center" mb={4}>
                        <Text
                          fontSize="sm"
                          color="gray.300"
                          fontWeight="semibold"
                        >
                          P&L Ranking
                        </Text>
                        <Text fontSize="xs" color="gray.500">
                          Top 10 contracts
                        </Text>
                      </Flex>

                      {symbolPnlRanking.length ? (
                        <>
                          <Flex align="center" gap={4} mb={2}>
                            <Text
                              flex="0 0 180px"
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
                            {symbolPnlRanking.map((rank) => {
                              const barWidth = Math.max(
                                6,
                                (Math.abs(rank.pnl) / symbolRankingMaxAbsPnl) *
                                  100,
                              );

                              return (
                                <Flex
                                  key={rank.symbol}
                                  align="center"
                                  gap={4}
                                  minH="34px"
                                >
                                  <Box flex="0 0 180px" minW={0}>
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
                                      {formatInteger(rank.orders)} orders ·{' '}
                                      {formatPercent(rank.winRate)}
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

                  {visibleDetails.length ? (
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
                        Details
                      </Text>
                      <SimpleGrid columns={1} gap={3}>
                        {visibleDetails.map((detail) => (
                          <Flex
                            key={detail.id}
                            justify="space-between"
                            align="flex-start"
                            gap={4}
                            p={3}
                            borderRadius="md"
                            bg="blackAlpha.300"
                          >
                            <Text
                              fontSize="sm"
                              color="gray.400"
                              fontFamily="mono"
                              flex="0 0 220px"
                            >
                              {detail.label}
                            </Text>
                            <Text
                              fontSize="sm"
                              color={getMetricColor(detail.tone)}
                              fontWeight="semibold"
                              textAlign="right"
                              fontFamily="mono"
                              whiteSpace="pre-wrap"
                            >
                              {detail.value}
                            </Text>
                          </Flex>
                        ))}
                      </SimpleGrid>
                    </Box>
                  ) : null}
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

        {snapshot.tags?.length ? (
          <Text fontSize="sm" color="gray.500">
            {snapshot.tags.join(' · ')}
          </Text>
        ) : null}
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
