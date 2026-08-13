import { getFormatted, type AdvancedTradeInput } from '@tradejs/core/backtest';
import type {
  StrategyChartOrder,
  StrategyChartSnapshot,
  TestStat,
  TestThresholdsKey,
} from '@tradejs/types';
import {
  formatCompactNumber,
  formatFee,
  formatPriceUsdt,
  formatUsdt,
  type OrdersDrawerOrder,
} from '#components/Shared/OrdersDrawer';
import {
  calculateMaxDrawdownValue,
  calculateMaxGrossStreak,
  calculateMaxLossStreak,
  getEquityStepPnl as getSnapshotStepPnl,
} from '#app/lib/strategyPerformance';

const MS_IN_HOUR = 60 * 60 * 1000;
export const SNAPSHOT_ORDER_ROW_HEIGHT = 318;
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

export const buildSnapshotSummaryMetrics = (
  snapshot: StrategyChartSnapshot,
) => {
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
}) => [`plan ${formatPrice(requestedPrice)}`, `slip ${formatBps(slippageBps)}`];

const buildAiFeesDetail = (order: StrategyChartOrder) => [
  `open ${formatFee(order.openFee)}`,
  `close ${formatFee(order.closeFee)}`,
  `funding ${formatFee(order.fundingFee)}`,
];

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
}) => [
  `open ${formatFee(openFee)}`,
  `close ${formatFee(closeFee)}`,
  `funding ${formatFee(fundingFee)}`,
];

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
        detailLines: buildSlippageDetail({
          requestedPrice: entryOrder.requestedEntryPrice,
          slippageBps: entryOrder.entrySlippageBps,
        }),
      },
      {
        title: 'Exit',
        value: formatPrice(exitOrder?.exitPrice),
        detailLines: buildSlippageDetail({
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
        detailLines: buildReplayFeesDetail({ openFee, closeFee, fundingFee }),
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
            detailLines: buildSlippageDetail({}),
          },
          {
            title: 'Exit',
            value: 'n/a',
            detailLines: buildSlippageDetail({}),
          },
          {
            title: 'Notional',
            value: formatUsdt(null),
          },
          {
            title: 'Fees',
            value: formatFee(null),
            detailLines: buildReplayFeesDetail({}),
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
            detailLines: buildSlippageDetail({
              requestedPrice: order.requestedEntryPrice,
              slippageBps: order.entrySlippageBps,
            }),
          },
          {
            title: 'Exit',
            value: formatPrice(order.exitPrice),
            detailLines: buildSlippageDetail({
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
            detailLines: buildAiFeesDetail(order),
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

export const buildSnapshotOrders = (
  snapshot: StrategyChartSnapshot,
  mode: 'replay' | 'ai',
): OrdersDrawerOrder[] =>
  mode === 'replay'
    ? buildReplaySnapshotOrders(snapshot)
    : buildAiSnapshotOrders(snapshot);

export const buildSnapshotAdvancedTrades = (
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
