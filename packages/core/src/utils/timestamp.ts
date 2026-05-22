import { format } from 'date-fns';
import { getUnixTime, subDays } from 'date-fns';
import { BACKTEST_DEFAULT_DAYS, BACKTEST_PRELOAD_DAYS } from '../constants';
import {
  KlineChartItem,
  KlineChartData,
  OrderLogData,
  SimpleOrderLogData,
} from '@tradejs/types';

const TIMELINE_STEP = 86_400_000;
const DAY_MS = 86_400_000;
const RUNTIME_STORAGE_DAY_OFFSET_MS = 5 * 60 * 60 * 1000;

export const toMs = (ts: number) => (ts < 1e12 ? ts * 1000 : ts);

export const getTimestamp = (days: number = 0) => {
  if (days > 0) {
    return getUnixTime(subDays(new Date(), days)) * 1000;
  }

  return getUnixTime(new Date()) * 1000;
};

export const getItemTimestamp = (item: KlineChartItem) => item.timestamp;

export const getDataTimestamp = (data: KlineChartData) => {
  if (!data.length) {
    return null;
  }

  return getItemTimestamp(data[data.length - 1]);
};

export const formatUnix = (dt: number) => {
  return format(new Date(dt), 'd MMM u HH:mm:ss');
};

export const getBacktestPreloadStart = (
  start: number,
  preloadDays = BACKTEST_PRELOAD_DAYS,
) => Math.max(0, Math.trunc(start - preloadDays * DAY_MS));

export const getTimeline = (
  start = getTimestamp(BACKTEST_DEFAULT_DAYS),
  end = getTimestamp(),
  step = TIMELINE_STEP,
) => {
  const res = new Array<number>();

  for (let ind = start; ind <= end; ind += step) {
    res.push(ind);
  }

  return res;
};

const toIsoDayKey = (timestamp: number) =>
  new Date(timestamp).toISOString().slice(0, 10);

const toRuntimeStorageDayTimestamp = (timestamp: number) =>
  Math.floor((timestamp + RUNTIME_STORAGE_DAY_OFFSET_MS) / DAY_MS) * DAY_MS;

export const getRuntimeStorageDayKey = (timestamp: number) =>
  toIsoDayKey(toRuntimeStorageDayTimestamp(timestamp));

export const getRuntimeStorageDayKeys = (
  startTime: number,
  endTime: number,
): string[] => {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return [];
  }

  const start = Math.min(startTime, endTime);
  const endExclusive = Math.max(startTime, endTime);
  const normalizedEnd = Math.max(start, endExclusive - 1);
  const keys: string[] = [];
  const startDay = toRuntimeStorageDayTimestamp(start);
  const endDay = toRuntimeStorageDayTimestamp(normalizedEnd);

  for (let current = startDay; current <= endDay; current += DAY_MS) {
    keys.push(toIsoDayKey(current));
  }

  return keys;
};

export const compactOrderLog = (
  timeline: number[],
  orderLog: OrderLogData,
): SimpleOrderLogData => {
  const result: SimpleOrderLogData = [];

  // Стартовое значение, как в исходнике
  let currentAmount =
    orderLog.length > 0 && orderLog[0].amount != null
      ? orderLog[0].amount
      : 100;

  // Курсор в orderLog (глобальный)
  let orderLogCursor = 0;

  for (
    let timelineIndex = 0;
    timelineIndex < timeline.length;
    timelineIndex++
  ) {
    const currentTimestamp = timeline[timelineIndex];

    // Мы будем проходить orderLog начиная с текущего курсора,
    // собирать все ордера с timestamp <= currentTimestamp
    // и запоминать последний из них.
    let lastApplicableOrderIndex = -1;

    // Локальная позиция, с которой мы начнём следующий цикл timeline.
    // То есть "докуда мы реально дошли"
    let nextCursor = orderLogCursor;

    for (
      let checkIndex = orderLogCursor;
      checkIndex < orderLog.length;
      checkIndex++
    ) {
      const checkOrder = orderLog[checkIndex];

      if (checkOrder.timestamp <= currentTimestamp) {
        // этот ордер уже вступил в силу к currentTimestamp
        lastApplicableOrderIndex = checkIndex;
        nextCursor = checkIndex + 1;
      } else {
        // дальше все timestamps будут только больше (массив отсортирован),
        // можно остановиться
        break;
      }
    }

    if (lastApplicableOrderIndex !== -1) {
      currentAmount = orderLog[lastApplicableOrderIndex].amount;
      orderLogCursor = nextCursor;
    }

    result.push([currentTimestamp, currentAmount]);
  }

  return result;
};
