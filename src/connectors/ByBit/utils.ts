import { OHLCVKlineV5, RestClientV5, PositionV5 } from 'bybit-api';
import { MARKET_CATEGORY } from '@constants';
import { formatUnix } from '@utils/timestamp';
import { KlineChartItem, Position, Direction } from '@types';

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
  pricePrecision: number;
  qtyPrecision: number;
};

const symbolMetaCache = new Map<string, SymbolMeta>();

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
): Promise<SymbolMeta> => {
  const cached = symbolMetaCache.get(symbol);
  if (cached) return cached;

  const res = await client.getInstrumentsInfo({
    category: MARKET_CATEGORY,
    symbol,
  });

  const item = res?.result?.list?.[0];
  if (!item) {
    throw new Error(`No instrument info for symbol ${symbol}`);
  }

  const tickSizeStr = item.priceFilter?.tickSize ?? '0.01';
  const qtyStepStr = item.lotSizeFilter?.qtyStep ?? '0.001';
  const minOrderQtyStr = item.lotSizeFilter?.minOrderQty ?? '0.001';

  const meta: SymbolMeta = {
    tickSize: Number(tickSizeStr),
    qtyStep: Number(qtyStepStr),
    minOrderQty: Number(minOrderQtyStr),
    pricePrecision: stepToPrecision(tickSizeStr),
    qtyPrecision: stepToPrecision(qtyStepStr),
  };

  symbolMetaCache.set(symbol, meta);
  return meta;
};

/** Нормализуем qty под биржу: шаг + строка нужной точности */
export const normalizeQty = (rawQty: number, meta: SymbolMeta) => {
  const qtyNum = roundByStep(rawQty, meta.qtyStep, 'floor');
  const qtyStr = qtyNum.toFixed(meta.qtyPrecision);
  return { qtyNum, qtyStr };
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
      qty: parseFloat(item.size),
      direction: (item.side === 'Buy' ? 'LONG' : 'SHORT') as Direction,
    }));
};
