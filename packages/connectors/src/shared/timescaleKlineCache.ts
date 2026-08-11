import { PRELOAD_FALLBACK_DAYS } from '@tradejs/core/constants';
import { mergeData } from '@tradejs/core/data';
import { getItemTimestamp, getTimestamp } from '@tradejs/core/time';
import { delay } from '@tradejs/core/async';
import { logger } from '@tradejs/infra/logger';
import {
  getCandlesRange,
  getDataEdges,
  toRows,
  upsertCandles,
} from '@tradejs/infra/timescale/candles';
import { Interval, Kline, KlineChartData, KlineRequest } from '@tradejs/types';

type ExchangeKlineRequest = (request: KlineRequest) => Promise<KlineChartData>;
type LoadDataResult = {
  data: KlineChartData;
  loaded: boolean;
};

type TimescaleKlineCacheOptions = {
  provider: string;
  request: ExchangeKlineRequest;
  intervalToMinutes: (interval: Interval) => number | null;
  limit?: number;
  cacheFallbackWindow?: number;
};

const DEFAULT_LIMIT = 1000;
const DEFAULT_CACHE_FALLBACK_WINDOW = 1000;
const DEFAULT_TIMESCALE_RETRIES = 2;
const DEFAULT_TIMESCALE_RETRY_DELAY_MS = 1_000;

const resolveNonNegativeInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const getTimescaleRetryCount = () =>
  resolveNonNegativeInt(
    process.env.TIMESCALE_KLINE_RETRIES,
    DEFAULT_TIMESCALE_RETRIES,
  );

const getTimescaleRetryDelayMs = () =>
  resolveNonNegativeInt(
    process.env.TIMESCALE_KLINE_RETRY_DELAY_MS,
    DEFAULT_TIMESCALE_RETRY_DELAY_MS,
  );

const intervalMsOf = (interval: number) => interval * 60_000;

const clampToClosedCandle = (value: number, intervalMs: number) =>
  Math.floor(value / intervalMs) * intervalMs;

const normalizeRangeToClosed = (
  intervalMs: number,
  start?: number,
  end?: number,
) => {
  const lastClosed = Math.floor(Date.now() / intervalMs) * intervalMs;
  const normStart =
    start !== undefined ? clampToClosedCandle(start, intervalMs) : 0;
  const cappedEnd = Math.min(end ?? Date.now(), lastClosed);
  const normEnd = clampToClosedCandle(cappedEnd, intervalMs);
  return { normStart, normEnd };
};

const rowsToKline = (rows: Array<{ ts: Date } & Record<string, unknown>>) =>
  rows.map(({ ts, ...data }) => ({
    timestamp: new Date(ts).getTime(),
    ...data,
  })) as KlineChartData;

export const createTimescaleCachedKline = ({
  provider,
  request,
  intervalToMinutes,
  limit = DEFAULT_LIMIT,
  cacheFallbackWindow = DEFAULT_CACHE_FALLBACK_WINDOW,
}: TimescaleKlineCacheOptions): Kline => {
  let isTimescaleFallbackMode = false;

  const runTimescaleOperation = async <T>(operation: () => Promise<T>) => {
    const retries = getTimescaleRetryCount();
    const retryDelayMs = getTimescaleRetryDelayMs();

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (attempt >= retries) {
          throw error;
        }

        const waitMs = retryDelayMs * 2 ** attempt;
        if (waitMs > 0) {
          await delay(waitMs);
        }
      }
    }
  };

  const loadData = async (
    direction: 'older' | 'newer',
    pointer: number | undefined,
    limitBoundary: number | undefined,
    requestParams: KlineRequest,
    intervalMs: number,
    options: {
      accumulate?: boolean;
      onPartData?: (partData: KlineChartData) => Promise<void>;
    } = {},
  ): Promise<LoadDataResult> => {
    if (pointer === undefined) return { data: [], loaded: false };

    let accumulated: KlineChartData = [];
    let fulfilled = false;
    let loaded = false;
    const shouldAccumulate = options.accumulate ?? true;

    while (!fulfilled) {
      const currentPointer: number = pointer;
      const params: KlineRequest = {
        symbol: requestParams.symbol,
        interval: requestParams.interval,
        silent: requestParams.silent,
        end: requestParams.end,
      };

      if (direction === 'older') {
        params.end = pointer;
        if (limitBoundary !== undefined) params.start = limitBoundary;
      } else {
        params.start = pointer;
        if (limitBoundary !== undefined) params.end = limitBoundary;
      }

      const partData = await request(params);

      if (!partData.length) {
        fulfilled = true;
        break;
      }
      loaded = true;

      if (options.onPartData) {
        await options.onPartData(partData);
      }

      if (shouldAccumulate) {
        accumulated =
          direction === 'older'
            ? mergeData(partData, accumulated)
            : mergeData(accumulated, partData);
      }

      const boundaryReached =
        limitBoundary !== undefined &&
        ((direction === 'older' && currentPointer <= limitBoundary) ||
          (direction === 'newer' && currentPointer >= limitBoundary));

      if (partData.length < limit || boundaryReached) {
        fulfilled = true;
        break;
      }

      const nextPointer =
        direction === 'older'
          ? getItemTimestamp(partData[0]) - intervalMs
          : getItemTimestamp(partData[partData.length - 1]) + intervalMs;

      if (!Number.isFinite(nextPointer) || nextPointer === currentPointer) {
        fulfilled = true;
        break;
      }

      pointer = nextPointer;
    }

    return { data: accumulated, loaded };
  };

  const refreshTail = async ({
    symbol,
    interval,
    silent,
    tailCount = 2,
  }: {
    symbol: string;
    interval: Interval;
    silent: boolean;
    tailCount?: number;
  }) => {
    const intMinutes = intervalToMinutes(interval);
    if (!intMinutes) {
      logger.log('error', 'refreshTail: invalid interval %s', interval);
      return;
    }
    const intervalMs = intervalMsOf(intMinutes);

    const lastClosed = Math.floor(Date.now() / intervalMs) * intervalMs;
    const tailEnd = lastClosed + intervalMs;
    const tailStart = tailEnd - tailCount * intervalMs;

    const part = await request({
      symbol,
      interval,
      start: tailStart,
      end: tailEnd,
      silent,
    });

    if (part.length) {
      await runTimescaleOperation(() =>
        upsertCandles(toRows(provider, symbol, intMinutes, part)),
      );
    }
  };

  return async ({
    symbol,
    interval,
    start: defaultStart,
    end: defaultEnd,
    silent = false,
    cacheOnly = false,
    warmOnly = false,
  }: KlineRequest) => {
    const intMinutes = intervalToMinutes(interval);
    if (!intMinutes) {
      logger.log('error', 'kline: invalid interval %s', interval);
      return [];
    }

    if (
      defaultStart !== undefined &&
      defaultEnd !== undefined &&
      defaultEnd <= defaultStart
    ) {
      return [];
    }

    const intervalMs = intervalMsOf(intMinutes);

    try {
      const edges = await runTimescaleOperation(() =>
        getDataEdges(provider, symbol, intMinutes),
      );
      let dataStart = edges.min;
      let dataEnd = edges.max;

      const { normStart, normEnd } = normalizeRangeToClosed(
        intervalMs,
        defaultStart,
        defaultEnd,
      );

      if (cacheOnly) {
        const base = edges.max ?? Date.now();
        const s = Math.max(
          defaultStart ?? base - cacheFallbackWindow * intervalMs,
          0,
        );
        const e = defaultEnd ?? base;
        const dbData = await runTimescaleOperation(() =>
          getCandlesRange(provider, symbol, intMinutes, s, e),
        );
        return rowsToKline(dbData);
      }

      const needOlderData =
        defaultStart !== undefined &&
        (dataStart === undefined || normStart < dataStart);

      const persistPartData = warmOnly
        ? (partData: KlineChartData) =>
            runTimescaleOperation(() =>
              upsertCandles(toRows(provider, symbol, intMinutes, partData)),
            )
        : undefined;

      if (needOlderData) {
        const pointerForOlder = dataStart ?? normEnd ?? Date.now();
        const olderResult = await loadData(
          'older',
          pointerForOlder,
          normStart,
          {
            symbol,
            interval,
            silent,
            start: normStart,
            end: pointerForOlder,
          },
          intervalMs,
          {
            accumulate: !warmOnly,
            onPartData: persistPartData,
          },
        );

        if (warmOnly && olderResult.loaded) {
          dataStart = normStart;
          if (dataEnd === undefined) {
            dataEnd = normEnd;
          }
        } else if (olderResult.data.length) {
          await runTimescaleOperation(() =>
            upsertCandles(
              toRows(provider, symbol, intMinutes, olderResult.data),
            ),
          );
          dataStart = normStart;
          if (dataEnd === undefined) {
            dataEnd = normEnd;
          }
        }
      }

      const needNewerData =
        defaultEnd !== undefined &&
        (dataEnd === undefined || normEnd > dataEnd);

      if (needNewerData) {
        const fallbackStart = getTimestamp(PRELOAD_FALLBACK_DAYS);
        const pointerForNewer =
          dataEnd ??
          (defaultStart !== undefined ? normStart : fallbackStart) ??
          0;
        const newerResult = await loadData(
          'newer',
          pointerForNewer,
          normEnd,
          {
            symbol,
            interval,
            silent,
            start: pointerForNewer,
            end: normEnd,
          },
          intervalMs,
          {
            accumulate: !warmOnly,
            onPartData: persistPartData,
          },
        );

        if (warmOnly && newerResult.loaded) {
          dataEnd = normEnd;
        } else if (newerResult.data.length) {
          await runTimescaleOperation(() =>
            upsertCandles(
              toRows(provider, symbol, intMinutes, newerResult.data),
            ),
          );
          dataEnd = normEnd;
        }
      }

      const isRightEdgeQuery =
        defaultEnd === undefined ||
        (defaultEnd && defaultEnd >= Date.now() - intervalMs);

      if (!cacheOnly && isRightEdgeQuery) {
        await refreshTail({ symbol, interval, silent });
      }

      if (warmOnly) {
        if (isTimescaleFallbackMode) {
          isTimescaleFallbackMode = false;
          logger.log('info', 'TimescaleDB connection restored for kline cache');
        }
        return [];
      }

      const rangeStart = defaultStart ?? dataStart ?? 0;
      const rangeEnd = defaultEnd ?? dataEnd ?? Date.now();
      const { normStart: finalStart, normEnd: finalEnd } =
        normalizeRangeToClosed(intervalMs, rangeStart, rangeEnd);

      const dbData = await runTimescaleOperation(() =>
        getCandlesRange(provider, symbol, intMinutes, finalStart, finalEnd),
      );

      if (isTimescaleFallbackMode) {
        isTimescaleFallbackMode = false;
        logger.log('info', 'TimescaleDB connection restored for kline cache');
      }

      return rowsToKline(dbData);
    } catch (error) {
      if (!isTimescaleFallbackMode) {
        isTimescaleFallbackMode = true;
        logger.log(
          'warn',
          'TimescaleDB unavailable for %s %s: %s. Falling back to exchange API.',
          symbol,
          interval,
          String(error),
        );
      }

      if (cacheOnly || warmOnly) {
        return [];
      }

      return request({
        symbol,
        interval,
        start: defaultStart,
        end: defaultEnd,
        silent,
      });
    }
  };
};
