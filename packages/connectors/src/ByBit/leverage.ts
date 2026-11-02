import type { RestClientV5 } from 'bybit-api';
import type { Direction, OrderLeverage } from '@tradejs/types';
import { getSymbolMeta } from './utils';

type Client = Pick<
  RestClientV5,
  'getPositionInfo' | 'getRiskLimit' | 'getActiveOrders' | 'setLeverage'
>;

const CATEGORY = 'linear' as const;
const REFRESH_CODES = new Set([110013, 110085, 110086, 110089, 110090]);
const orderQueues = new Map<string, Promise<void>>();

/** Shared by connector instances for the same account, independent of deployment. */
export const withBybitOrderLock = async <T>(
  key: string,
  action: () => Promise<T>,
): Promise<T> => {
  const previous = orderQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  orderQueues.set(key, pending);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (orderQueues.get(key) === pending) orderQueues.delete(key);
  }
};

const positive = (value: unknown, label: string): number => {
  const parsed = Number(value);
  if (
    !['string', 'number'].includes(typeof value) ||
    value === '' ||
    !Number.isFinite(parsed) ||
    parsed <= 0
  ) {
    throw new Error(`BYBIT_INVALID_${label}`);
  }
  return parsed;
};

const nonNegative = (value: unknown, label: string): number => {
  if (value === '0' || value === 0) return 0;
  return positive(value, label);
};

const loadPositions = async (client: Client, symbol: string) => {
  const response = await client.getPositionInfo({ category: CATEGORY, symbol });
  if (
    response.retCode !== 0 ||
    !Array.isArray(response.result?.list) ||
    !response.result.list.length
  ) {
    throw new Error('BYBIT_LEVERAGE_POSITION_UNAVAILABLE');
  }
  const rows = response.result.list;
  // Order placement currently supports one-way positions only.
  if (rows.some((row) => row.symbol !== symbol || row.positionIdx !== 0)) {
    throw new Error('BYBIT_LEVERAGE_POSITION_MODE_UNSUPPORTED');
  }
  return rows;
};

const loadRiskMaximum = async (
  client: Client,
  symbol: string,
  positionValue: number,
  riskIds: number[],
) => {
  let cursor: string | undefined;
  const tiers: { id: number; value: number; leverage: number }[] = [];
  for (let page = 0; page < 20; page += 1) {
    const response = await client.getRiskLimit({
      category: CATEGORY,
      symbol,
      ...(cursor ? { cursor } : {}),
    });
    if (response.retCode !== 0 || !Array.isArray(response.result?.list)) {
      throw new Error('BYBIT_LEVERAGE_RISK_LIMIT_UNAVAILABLE');
    }
    for (const row of response.result.list) {
      if (row.symbol !== symbol) continue;
      tiers.push({
        id: row.id,
        value: positive(row.riskLimitValue, 'RISK_LIMIT'),
        leverage: positive(row.maxLeverage, 'RISK_LEVERAGE'),
      });
    }
    const nextCursor =
      'nextPageCursor' in response.result
        ? response.result.nextPageCursor
        : undefined;
    if (nextCursor != null && typeof nextCursor !== 'string')
      throw new Error('BYBIT_LEVERAGE_INVALID_CURSOR');
    cursor = nextCursor ?? undefined;
    if (!cursor) break;
    if (page === 19) throw new Error('BYBIT_LEVERAGE_RISK_LIMIT_INCOMPLETE');
  }
  const tier = tiers
    .sort((left, right) => left.value - right.value)
    .find((row) => row.value >= positionValue);
  if (!tier) throw new Error('BYBIT_LEVERAGE_RISK_LIMIT_EXCEEDED');
  const currentTiers = riskIds.map((id) => {
    const current = tiers.find((row) => row.id === id);
    if (!current) throw new Error('BYBIT_LEVERAGE_RISK_TIER_UNKNOWN');
    return current;
  });
  return Math.min(tier.leverage, ...currentTiers.map((row) => row.leverage));
};

const loadPendingValue = async (
  client: Client,
  symbol: string,
  price: number,
) => {
  const total = { Buy: 0, Sell: 0 };
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const response = await client.getActiveOrders({
      category: CATEGORY,
      symbol,
      openOnly: 0,
      orderFilter: 'Order',
      limit: 50,
      ...(cursor ? { cursor } : {}),
    });
    if (response.retCode !== 0 || !Array.isArray(response.result?.list))
      throw new Error('BYBIT_LEVERAGE_OPEN_ORDERS_UNAVAILABLE');
    for (const order of response.result.list) {
      if (order.symbol !== symbol || order.reduceOnly) continue;
      if (order.side !== 'Buy' && order.side !== 'Sell')
        throw new Error('BYBIT_INVALID_OPEN_ORDER_SIDE');
      const qty = nonNegative(order.leavesQty, 'OPEN_ORDER_QTY');
      const orderPrice = nonNegative(order.price, 'OPEN_ORDER_PRICE');
      total[order.side] += qty * Math.max(price, orderPrice);
    }
    cursor = response.result.nextPageCursor;
    if (!cursor) return total;
  }
  throw new Error('BYBIT_LEVERAGE_OPEN_ORDERS_INCOMPLETE');
};

const normalizeLeverage = (
  requested: number,
  max: number,
  min: number,
  step: number,
) => {
  const cap = Math.min(requested, max);
  const result = Number(
    (min + Math.floor((cap - min + step * 1e-9) / step) * step).toFixed(12),
  );
  if (result < min || result > cap + 1e-9)
    throw new Error('BYBIT_LEVERAGE_NOT_AVAILABLE');
  return result;
};

/** Never changes quantity or margin mode. Unknown exchange state blocks entry. */
export const prepareBybitLeverage = async ({
  client,
  marketClient,
  symbol,
  requested,
  direction,
  qty,
  price,
}: {
  client: Client;
  marketClient: RestClientV5;
  symbol: string;
  requested: number;
  direction: Direction;
  qty: number;
  price: number;
}): Promise<OrderLeverage> => {
  positive(requested, 'REQUESTED_LEVERAGE');
  positive(qty, 'ORDER_QTY');
  positive(price, 'ORDER_PRICE');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const meta = await getSymbolMeta(marketClient, symbol, attempt > 0);
    const min = positive(meta.minLeverage, 'MIN_LEVERAGE');
    const max = positive(meta.maxLeverage, 'MAX_LEVERAGE');
    const step = positive(meta.leverageStep, 'LEVERAGE_STEP');
    if (max < min) throw new Error('BYBIT_INVALID_LEVERAGE_RANGE');
    const positions = await loadPositions(client, symbol);
    const exposure = {
      Buy: direction === 'LONG' ? qty * price : 0,
      Sell: direction === 'SHORT' ? qty * price : 0,
    };
    const riskIds: number[] = [];
    for (const position of positions) {
      positive(position.leverage, 'POSITION_LEVERAGE');
      const size = nonNegative(position.size, 'POSITION_SIZE');
      if (size > 0) {
        if (position.side !== 'Buy' && position.side !== 'Sell')
          throw new Error('BYBIT_INVALID_POSITION_SIDE');
        exposure[position.side] += Math.max(
          nonNegative(position.positionValue, 'POSITION_VALUE'),
          size * price,
        );
        riskIds.push(positive(position.riskId, 'POSITION_RISK_ID'));
      }
    }
    const pending = await loadPendingValue(client, symbol, price);
    const positionValue = Math.max(
      exposure.Buy + pending.Buy,
      exposure.Sell + pending.Sell,
    );
    const riskMax = await loadRiskMaximum(
      client,
      symbol,
      positionValue,
      riskIds,
    );
    const effective = normalizeLeverage(
      requested,
      Math.min(max, riskMax),
      min,
      step,
    );
    const response = await client.setLeverage({
      category: CATEGORY,
      symbol,
      buyLeverage: String(effective),
      sellLeverage: String(effective),
    });
    if (response.retCode !== 0 && response.retCode !== 110043) {
      if (attempt === 0 && REFRESH_CODES.has(response.retCode)) continue;
      throw new Error(
        `BYBIT_SET_LEVERAGE_${response.retCode ?? 'INVALID_RESPONSE'}`,
      );
    }
    const confirmed = await loadPositions(client, symbol);
    if (confirmed.some((row) => Number(row.leverage) !== effective))
      throw new Error('BYBIT_LEVERAGE_NOT_CONFIRMED');
    return {
      requested,
      effective,
      maxAllowed: Math.min(max, riskMax),
      reductionReason:
        effective === requested
          ? null
          : riskMax < Math.min(requested, max)
            ? 'risk_limit'
            : max < requested
              ? 'instrument_limit'
              : 'leverage_step',
      verifiedAt: Date.now(),
    };
  }
  throw new Error('BYBIT_LEVERAGE_NOT_CONFIRMED');
};
