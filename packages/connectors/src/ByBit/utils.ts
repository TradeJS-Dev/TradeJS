import { OHLCVKlineV5, RestClientV5, PositionV5 } from 'bybit-api';
import { formatUnix } from '@tradejs/core/time';

import { KlineChartItem, Position, Direction } from '@tradejs/types';

const BYBIT_CATEGORY = 'linear' as const;

const parseKlineItem = (item: OHLCVKlineV5): KlineChartItem => ({
  dt: formatUnix(parseInt(item[0])),
  timestamp: parseInt(item[0]),
  open: parseFloat(item[1]),
  high: parseFloat(item[2]),
  low: parseFloat(item[3]),
  close: parseFloat(item[4]),
  volume: parseFloat(item[5]),
  turnover: parseFloat(item[6]),
});

export const mapKlineToChartData = (data: OHLCVKlineV5[]) =>
  data.map(parseKlineItem);

type SymbolMeta = {
  tickSize: number;
  qtyStep: number;
  minOrderQty: number;
  maxMarketOrderQty?: number | null;
  maxLimitOrderQty?: number | null;
  pricePrecision: number;
  qtyPrecision: number;
  maxLeverage?: number | null;
  minLeverage?: number | null;
  leverageStep?: number | null;
};

const SYMBOL_META_TTL_MS = 60_000;
const symbolMetaCache = new WeakMap<
  RestClientV5,
  Map<string, { value: SymbolMeta; expiresAt: number }>
>();

/** Округление к шагу биржи */
const roundByStep = (
  value: number,
  step: number,
  mode: 'floor' | 'ceil' | 'round' = 'floor',
): number => {
  if (!step || !Number.isFinite(value)) return value;

  const ratio = value / step;
  const fn =
    mode === 'ceil' ? Math.ceil : mode === 'round' ? Math.round : Math.floor;

  const res = fn(ratio) * step;
  return Number(res.toFixed(12)); // режем двоичную погрешность
};

/** Кол-во знаков после запятой у шага */
const stepToPrecision = (raw: string): number => {
  const [, decimals = ''] = raw.split('.');
  return decimals.length;
};

export const getSymbolMeta = async (
  client: RestClientV5,
  symbol: string,
  refresh = false,
): Promise<SymbolMeta> => {
  let cache = symbolMetaCache.get(client);
  if (!cache) {
    cache = new Map();
    symbolMetaCache.set(client, cache);
  }
  const cached = cache.get(symbol);
  if (!refresh && cached && cached.expiresAt > Date.now()) return cached.value;

  const res = await client.getInstrumentsInfo({
    category: BYBIT_CATEGORY,
    symbol,
  });

  const item = res?.result?.list?.[0];
  if (res.retCode !== 0 || !item || item.symbol !== symbol) {
    throw new Error(`No instrument info for symbol ${symbol}`);
  }

  const tickSizeStr = item.priceFilter?.tickSize ?? '0.01';
  const qtyStepStr = item.lotSizeFilter?.qtyStep ?? '0.001';
  const minOrderQtyStr = item.lotSizeFilter?.minOrderQty ?? '0.001';

  const meta: SymbolMeta = {
    tickSize: Number(tickSizeStr),
    qtyStep: Number(qtyStepStr),
    minOrderQty: Number(minOrderQtyStr),
    maxMarketOrderQty:
      'maxMktOrderQty' in item.lotSizeFilter
        ? Number(item.lotSizeFilter.maxMktOrderQty)
        : null,
    maxLimitOrderQty: Number(item.lotSizeFilter.maxOrderQty),
    pricePrecision: stepToPrecision(tickSizeStr),
    qtyPrecision: stepToPrecision(qtyStepStr),
    minLeverage:
      'leverageFilter' in item ? Number(item.leverageFilter.minLeverage) : null,
    maxLeverage:
      'leverageFilter' in item ? Number(item.leverageFilter.maxLeverage) : null,
    leverageStep:
      'leverageFilter' in item
        ? Number(item.leverageFilter.leverageStep)
        : null,
  };

  cache.set(symbol, {
    value: meta,
    expiresAt: Date.now() + SYMBOL_META_TTL_MS,
  });
  return meta;
};

/** Нормализуем qty под биржу: шаг + строка нужной точности */
export const normalizeQty = (rawQty: number, meta: SymbolMeta) => {
  const qtyNum = roundByStep(rawQty, meta.qtyStep, 'floor');
  const qtyStr = qtyNum.toFixed(meta.qtyPrecision);
  return { qtyNum, qtyStr };
};

/** Entry-only ceiling: protective orders must continue to cover the full position. */
export const normalizeEntryQty = (
  rawQty: number,
  meta: SymbolMeta,
  isLimit: boolean,
) => {
  const maxQty = isLimit ? meta.maxLimitOrderQty : meta.maxMarketOrderQty;
  if (typeof maxQty !== 'number' || !Number.isFinite(maxQty) || maxQty <= 0)
    throw new Error('BYBIT_INVALID_ORDER_QTY_LIMIT');
  if (!Number.isFinite(rawQty) || rawQty <= 0)
    throw new Error('BYBIT_INVALID_ORDER_QTY');
  if (!Number.isFinite(meta.qtyStep) || meta.qtyStep <= 0)
    throw new Error('BYBIT_INVALID_QTY_STEP');
  const normalized = normalizeQty(Math.min(rawQty, maxQty), meta);
  if (
    !Number.isFinite(normalized.qtyNum) ||
    normalized.qtyNum > rawQty ||
    normalized.qtyNum > maxQty
  )
    throw new Error('BYBIT_INVALID_NORMALIZED_ORDER_QTY');
  return normalized;
};

/**
 * Нормализуем цену под биржу:
 *  - step = tickSize
 *  - режим округления зависит от назначения
 */
type PriceRole = 'ENTRY' | 'TP_LONG' | 'TP_SHORT' | 'SL_LONG' | 'SL_SHORT';

export const normalizePrice = (
  rawPrice: number,
  role: PriceRole,
  meta: SymbolMeta,
) => {
  let mode: 'floor' | 'ceil' = 'floor';

  switch (role) {
    case 'TP_LONG':
      mode = 'ceil'; // TP для лонга — лучше вверх
      break;
    case 'TP_SHORT':
      mode = 'floor'; // TP для шорта — лучше вниз
      break;
    case 'SL_LONG':
      mode = 'floor'; // SL для лонга — ниже цены
      break;
    case 'SL_SHORT':
      mode = 'ceil'; // SL для шорта — выше цены
      break;
    case 'ENTRY':
    default:
      mode = 'floor';
  }

  const priceNum = roundByStep(rawPrice, meta.tickSize, mode);
  const priceStr = priceNum.toFixed(meta.pricePrecision);

  return { priceNum, priceStr };
};

export const mapPositionData = (data: PositionV5[]): Position[] => {
  if (!data) {
    return [];
  }

  return data
    .filter((item) => parseFloat(item.size) > 0)
    .map((item) => ({
      symbol: item.symbol,
      price: parseFloat(item.avgPrice),
      slPrice: parseFloat(item.stopLoss || ''),
      tpPrice: parseFloat(item.takeProfit || ''),
      qty: parseFloat(item.size),
      direction: (item.side === 'Buy' ? 'LONG' : 'SHORT') as Direction,
    }));
};
