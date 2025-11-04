// supportResistance.ts
import { KlineChartData } from '@types'; // предполагаю что каждый элемент data это { timestamp, open, high, low, close, volume }

const MERGE_THRESHOLD_PCT = 0.01;
const WINDOW_SIZE = 500;

type Level = {
  id: string;
  price: number;
};

/** находим локальные минимумы (поддержка) и максимумы (сопротивление) */
export const detectRawSupportResistance = (
  data: KlineChartData,
  lookAround = 2, // сколько свечей слева/справа сравнивать
) => {
  const supports: number[] = [];
  const resistances: number[] = [];

  for (let i = lookAround; i < data.length - lookAround; i++) {
    const cur = data[i];
    const curLow = cur.low;
    const curHigh = cur.high;

    let isSupport = true;
    let isResistance = true;

    for (let j = i - lookAround; j <= i + lookAround; j++) {
      if (j === i) continue;
      if (data[j].low < curLow) isSupport = false;
      if (data[j].high > curHigh) isResistance = false;
    }

    if (isSupport) supports.push(curLow);
    if (isResistance) resistances.push(curHigh);
  }

  return { supports, resistances };
};

/** схлопываем близкие уровни и берём среднее */
const mergeCloseLevels = (levels: number[]): number[] => {
  if (!levels.length) return [];

  // сортируем по цене
  const sorted = [...levels].sort((a, b) => a - b);

  const merged: number[][] = [];
  let bucket: number[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = bucket[bucket.length - 1];
    const cur = sorted[i];

    // относительная разница
    const diffPct = Math.abs(cur - prev) / prev;

    if (diffPct <= MERGE_THRESHOLD_PCT) {
      bucket.push(cur);
    } else {
      merged.push(bucket);
      bucket = [cur];
    }
  }
  merged.push(bucket);

  // усредняем каждый кластер
  const averaged = merged.map((group) => {
    const sum = group.reduce((acc, v) => acc + v, 0);
    return sum / group.length;
  });

  return averaged;
};

/** итоговый вывод (поддержка/сопротивление) с id */
export const getSupportResistanceLevels = (data: KlineChartData) => {
  if (!data || data.length === 0) {
    return { supportLevels: [] as Level[], resistanceLevels: [] as Level[] };
  }

  const { supports, resistances } = detectRawSupportResistance(data, 2);

  const uniqSupports = mergeCloseLevels(supports);
  const uniqResistances = mergeCloseLevels(resistances);

  const supportLevels: Level[] = uniqSupports.slice(0, 5).map((price, idx) => ({
    id: `support-${idx}`,
    price,
  }));

  const resistanceLevels: Level[] = uniqResistances
    .slice(0, 5)
    .map((price, idx) => ({
      id: `resistance-${idx}`,
      price,
    }));

  return { supportLevels, resistanceLevels };
};
