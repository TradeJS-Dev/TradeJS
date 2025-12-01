import { Candle } from '@types';

export type SwingPoint = {
  type: 'HIGH' | 'LOW';
  price: number;
  time: number;
  index: number;
};

export type MarketStructure = {
  trend: 'BULL' | 'BEAR' | 'RANGE';
  swings: SwingPoint[];
  bos: boolean; // Break Of Structure
  choch: boolean; // Change Of Character
  lastHigh?: SwingPoint;
  lastLow?: SwingPoint;
};

export const findSwings = (candles: Candle[], lookback = 4): SwingPoint[] => {
  const swings: SwingPoint[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];

    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].high >= c.high) isHigh = false;
      if (candles[i + j].high >= c.high) isHigh = false;

      if (candles[i - j].low <= c.low) isLow = false;
      if (candles[i + j].low <= c.low) isLow = false;
    }

    if (isHigh) {
      swings.push({
        type: 'HIGH',
        price: c.high,
        time: c.timestamp,
        index: i,
      });
    }

    if (isLow) {
      swings.push({
        type: 'LOW',
        price: c.low,
        time: c.timestamp,
        index: i,
      });
    }
  }

  return swings;
};

const STRICT_CONFIG = {
  soft: {
    minSwings: 4,
    requireBOSConfirm: false,
    minImpulseRatio: 1.0,
  },
  normal: {
    minSwings: 6,
    requireBOSConfirm: true,
    minImpulseRatio: 1.3,
  },
  hard: {
    minSwings: 8,
    requireBOSConfirm: true,
    minImpulseRatio: 1.7,
  },
};

export type TrendStrictness = 'soft' | 'normal' | 'hard';

export const detectMarketStructure = (
  candles: Candle[],
  strictness: TrendStrictness = 'normal',
): MarketStructure => {
  const swings = findSwings(candles, 4);
  const config = STRICT_CONFIG[strictness];

  if (swings.length < config.minSwings) {
    return {
      trend: 'RANGE',
      swings,
      bos: false,
      choch: false,
    };
  }

  const last = swings.at(-1)!;
  const prev = swings.at(-2)!;
  const prev2 = swings.at(-3)!;
  const prev3 = swings.at(-4)!;

  let trend: MarketStructure['trend'] = 'RANGE';
  let bos = false;
  let choch = false;

  /* =========================
     ✅ Определение тренда
     ========================= */

  const isBull =
    prev3.type === 'HIGH' &&
    prev2.type === 'LOW' &&
    prev.type === 'HIGH' &&
    last.type === 'LOW' &&
    prev.price > prev3.price && // HH
    last.price > prev2.price; // HL

  const isBear =
    prev3.type === 'LOW' &&
    prev2.type === 'HIGH' &&
    prev.type === 'LOW' &&
    last.type === 'HIGH' &&
    prev.price < prev3.price && // LL
    last.price < prev2.price; // LH

  if (isBull) trend = 'BULL';
  if (isBear) trend = 'BEAR';

  /* =========================
     ✅ Импульс vs коррекция
     ========================= */

  const impulse =
    trend === 'BULL'
      ? Math.abs(prev.price - prev2.price)
      : trend === 'BEAR'
        ? Math.abs(prev2.price - prev.price)
        : 0;

  const correction =
    trend === 'BULL'
      ? Math.abs(prev2.price - last.price)
      : trend === 'BEAR'
        ? Math.abs(last.price - prev2.price)
        : 0;

  const impulseRatio = correction > 0 ? impulse / correction : 0;

  if (trend !== 'RANGE' && impulseRatio < config.minImpulseRatio) {
    trend = 'RANGE'; // ❌ слабая структура
  }

  /* =========================
     ✅ BOS — слом структуры
     ========================= */

  if (trend === 'BULL' && last.type === 'LOW' && last.price < prev2.price) {
    bos = true;
  }

  if (trend === 'BEAR' && last.type === 'HIGH' && last.price > prev2.price) {
    bos = true;
  }

  /* =========================
     ✅ CHoCH — смена фазы
     ========================= */

  if (bos && config.requireBOSConfirm) {
    choch = true;
  }

  const lastHigh = [...swings].reverse().find((s) => s.type === 'HIGH');
  const lastLow = [...swings].reverse().find((s) => s.type === 'LOW');

  return {
    trend,
    swings,
    bos,
    choch,
    lastHigh,
    lastLow,
  };
};
