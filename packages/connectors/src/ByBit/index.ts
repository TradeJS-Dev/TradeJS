'use server';

import _ from 'lodash';
import chalk from 'chalk';
import { delay } from '@tradejs/core/async';
import {
  MARKET_CATEGORY,
  PRELOAD_FALLBACK_DAYS,
} from '@tradejs/core/constants';
import { mergeData } from '@tradejs/core/data';
import { toJson } from '@tradejs/core/data';
import { round } from '@tradejs/core/math';
import { normalizeTickerData } from '@tradejs/core/tickers';
import { formatUnix, getItemTimestamp, getTimestamp } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';
import {
  getCandlesRange,
  getDataEdges,
  upsertCandles,
  toRows,
} from '@tradejs/infra/timescale';

import { getClient } from './client';
import {
  mapKlineToChartData,
  normalizePrice,
  normalizeQty,
  getSymbolMeta,
  mapPositionData,
} from './utils';
import {
  KlineChartData,
  KlineRequest,
  ConnectorCreator,
  Direction,
  Interval,
  Position,
  Tp,
} from '@tradejs/types';

const LIMIT = 1000;
const CACHE_FALLBACK_WINDOW = 1_000;
const BYBIT_RATE_LIMIT_RETCODE = 10_006;
const BYBIT_TRADING_STOP_NOT_MODIFIED_RETCODE = 34_040;
const KLINE_RATE_LIMIT_MAX_ATTEMPTS = 3;
const KLINE_RATE_LIMIT_BASE_DELAY_MS = 800;
const KLINE_RATE_LIMIT_MAX_DELAY_MS = 10_000;
const KLINE_RATE_LIMIT_RESET_BUFFER_MS = 50;
const INTERVAL_TO_MINUTES: Record<string, number> = {
  '1': 1,
  '3': 3,
  '5': 5,
  '15': 15,
  '30': 30,
  '60': 60,
  '120': 120,
  '240': 240,
  '360': 360,
  '720': 720,
  D: 1_440,
  W: 10_080,
  M: 43_200,
};

const getLogLevel = (res: any) => (res.retCode === 0 ? 'info' : 'error');
const isTradingStopNotModified = (res: any) =>
  res?.retCode === BYBIT_TRADING_STOP_NOT_MODIFIED_RETCODE;
const isTradingStopAccepted = (res: any) =>
  res?.retCode === 0 || isTradingStopNotModified(res);
const isKlineRateLimited = (res: any) =>
  res?.retCode === BYBIT_RATE_LIMIT_RETCODE;

const resolveKlineRetryDelayMs = (res: any, attempt: number) => {
  const resetAtRaw = Number(res?.rateLimitApi?.resetAtTimestamp);
  if (Number.isFinite(resetAtRaw) && resetAtRaw > 0) {
    return Math.max(
      KLINE_RATE_LIMIT_RESET_BUFFER_MS,
      resetAtRaw - Date.now() + KLINE_RATE_LIMIT_RESET_BUFFER_MS,
    );
  }

  const jitterMs = Math.round(Math.random() * 250);
  const backoffMs = Math.min(
    KLINE_RATE_LIMIT_MAX_DELAY_MS,
    KLINE_RATE_LIMIT_BASE_DELAY_MS * 2 ** (attempt - 1),
  );
  return backoffMs + jitterMs;
};

export const ByBitConnectorCreator: ConnectorCreator = async (config) => {
  let state: Record<string, unknown> = {};
  let isTimescaleFallbackMode = false;
  let publicClientPromise: Promise<
    Awaited<ReturnType<typeof getClient>>
  > | null = null;
  let privateClientPromise: Promise<
    Awaited<ReturnType<typeof getClient>>
  > | null = null;

  const getPublicClient = async () => {
    publicClientPromise ??= getClient(config, 'public');
    return publicClientPromise;
  };

  const getPrivateClient = async () => {
    privateClientPromise ??= getClient(config, 'private');
    return privateClientPromise;
  };

  /** -------------------- low-level fetch from exchange -------------------- */
  const request = async ({
    symbol,
    interval,
    start,
    end,
    silent,
  }: KlineRequest) => {
    // Fallback к PRELOAD_FALLBACK_DAYS, если не передали явный старт
    const normalizedStart = round(
      start || getTimestamp(PRELOAD_FALLBACK_DAYS),
      0,
    );
    const normalizedEnd = round(end || Date.now());

    try {
      const client = await getPublicClient();
      if (!client) return [];

      if (normalizedEnd <= normalizedStart) {
        return [];
      }

      for (
        let attempt = 1;
        attempt <= KLINE_RATE_LIMIT_MAX_ATTEMPTS;
        attempt += 1
      ) {
        const kline = await client.getKline({
          category: MARKET_CATEGORY,
          symbol,
          interval,
          start: normalizedStart,
          end: normalizedEnd,
          limit: LIMIT,
        });

        if (isKlineRateLimited(kline)) {
          if (attempt < KLINE_RATE_LIMIT_MAX_ATTEMPTS) {
            const waitMs = resolveKlineRetryDelayMs(kline, attempt);
            logger.log(
              'warn',
              'kline rate limited for %s %s: attempt=%s/%s waitMs=%s',
              symbol,
              interval,
              attempt,
              KLINE_RATE_LIMIT_MAX_ATTEMPTS,
              waitMs,
            );
            await delay(waitMs);
            continue;
          }
        }

        if (!kline?.result?.list) {
          const responseError =
            typeof kline?.retMsg === 'string' && kline.retMsg !== 'OK'
              ? `${kline.retMsg}${
                  typeof kline?.retCode === 'number'
                    ? ` (retCode: ${kline.retCode})`
                    : ''
                }`
              : typeof kline?.retCode === 'number' && kline.retCode !== 0
                ? `retCode: ${kline.retCode}`
                : '';

          logger.log(
            'error',
            'empty kline.list for %s %s%s',
            symbol,
            interval,
            responseError ? `: ${responseError}` : '',
          );
          return [];
        }

        if (!silent) {
          logger.log(
            'info',
            '%s %s %s %s',
            chalk.yellow(formatUnix(normalizedEnd)),
            chalk.cyan(symbol),
            chalk.cyan(interval),
            chalk.yellow(kline.result.list.length),
          );
        }

        // reverse() -> по возрастанию времени
        return mapKlineToChartData(kline.result.list.reverse());
      }

      return [];
    } catch (error) {
      logger.log(
        'error',
        'request kline: %s %s %s',
        normalizedStart,
        normalizedEnd,
        error,
      );
      return [];
    }
  };

  /** -------------------- batched loader (keeps your while) -------------------- */
  const loadData = async (
    direction: 'older' | 'newer',
    pointer: number | undefined,
    limitBoundary: number | undefined,
    requestParams: KlineRequest,
    intervalMs: number,
  ): Promise<KlineChartData> => {
    if (pointer === undefined) return [];

    let accumulated: KlineChartData = [];
    let fulfilled = false;

    while (!fulfilled) {
      const currentPointer: number = pointer;
      const params: KlineRequest = {
        symbol: requestParams.symbol,
        interval: requestParams.interval,
        silent: requestParams.silent,
      } as KlineRequest;

      if (direction === 'older') {
        params.end = pointer;
        if (limitBoundary !== undefined) params.start = limitBoundary;
      } else {
        params.start = pointer;
        if (limitBoundary !== undefined) params.end = limitBoundary;
      }

      const partData = await request(params);

      if (_.isEmpty(partData)) {
        fulfilled = true;
        break;
      }

      accumulated =
        direction === 'older'
          ? mergeData(partData, accumulated)
          : mergeData(accumulated, partData);

      const boundaryReached =
        limitBoundary !== undefined &&
        ((direction === 'older' && currentPointer <= limitBoundary) ||
          (direction === 'newer' && currentPointer >= limitBoundary));

      if (partData.length < LIMIT || boundaryReached) {
        fulfilled = true;
        break;
      }

      // Смещаем курсор на шаг интервала, чтобы не зациклиться на границах LIMIT
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

    return accumulated;
  };

  /** -------------------- small helpers -------------------- */
  const intervalMsOf = (interval: number) => interval * 60_000;
  const intervalToMinutes = (interval: Interval): number | null => {
    return INTERVAL_TO_MINUTES[String(interval)] ?? null;
  };

  const clampToClosedCandle = (value: number, intervalMs: number) =>
    Math.floor(value / intervalMs) * intervalMs;

  // clamp end к последней закрытой свече, чтобы не перефетчить «текущую» бесконечно
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
    return { normStart, normEnd, lastClosed };
  };

  const rowsToKline = (rows: Array<{ ts: Date } & any>) =>
    rows.map(({ ts, ...data }) => ({
      timestamp: new Date(ts).getTime(),
      ...data,
    })) as KlineChartData;

  // Обновляем хвост из двух свечей (последняя закрытая + текущая формирующаяся)
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
    const tailEnd = lastClosed + intervalMs; // захватываем и текущую формирующуюся
    const tailStart = tailEnd - tailCount * intervalMs;

    const part = await request({
      symbol,
      interval,
      start: tailStart,
      end: tailEnd,
      silent,
    });

    if (part.length) {
      await upsertCandles(toRows(symbol, intMinutes, part));
    }
  };

  const getPositionSnapshot = async (
    symbol: string,
  ): Promise<Position | null> => {
    const client = await getPrivateClient();

    if (!client) {
      return null;
    }

    const positionRes = await client.getPositionInfo({
      symbol,
      category: MARKET_CATEGORY,
    });

    if (positionRes.retCode !== 0) {
      logger.log(
        getLogLevel(positionRes),
        'position retCode: %s, %s',
        symbol,
        positionRes.retCode,
      );
      return null;
    }

    const positions = mapPositionData(positionRes.result.list);

    if (!positions || _.isEmpty(positions)) {
      return null;
    }

    const position = positions[0] as Position;

    logger.log(
      'debug',
      'position: %s %s qty=%s price=%s',
      position.symbol,
      position.direction,
      position.qty,
      position.price,
    );

    return {
      ...position,
    };
  };

  const setTakeProfits = async ({
    symbol,
    direction,
    qty,
    takeProfits,
  }: {
    symbol: string;
    direction: Direction;
    qty?: number;
    takeProfits: Tp[];
  }) => {
    const client = await getPrivateClient();
    const marketDataClient = await getPublicClient();

    if (!client || !marketDataClient) {
      return false;
    }

    if (!Array.isArray(takeProfits) || takeProfits.length === 0) {
      return true;
    }

    const meta = await getSymbolMeta(marketDataClient, symbol);
    const positionQty = qty ?? (await getPositionSnapshot(symbol))?.qty ?? 0;

    if (!Number.isFinite(positionQty) || positionQty <= 0) {
      logger.log(
        'warn',
        'setTakeProfits: missing position qty: %s',
        toJson({ symbol, qty, positionQty, takeProfits }, true),
      );
      return false;
    }

    const isLong = direction === 'LONG';

    for (const tp of takeProfits) {
      const tpSizeRaw = positionQty * tp.rate;
      const { qtyNum: tpSizeNum, qtyStr: tpSizeStr } = normalizeQty(
        tpSizeRaw,
        meta,
      );

      if (!tpSizeNum || tpSizeNum < meta.minOrderQty) {
        logger.log(
          'warn',
          'tp skipped: size too small %s',
          toJson(
            { symbol, tp, tpSizeNum, minOrderQty: meta.minOrderQty },
            true,
          ),
        );
        continue;
      }

      const tpPriceNorm = normalizePrice(
        tp.price,
        isLong ? 'TP_LONG' : 'TP_SHORT',
        meta,
      );
      const isFullMode = takeProfits.length === 1 && tp.rate === 1;

      const tpRes = await client.setTradingStop({
        category: MARKET_CATEGORY,
        symbol,
        tpSize: isFullMode ? undefined : tpSizeStr,
        tpslMode: isFullMode ? 'Full' : 'Partial',
        takeProfit: tpPriceNorm.priceStr,
        tpTriggerBy: 'MarkPrice',
        tpOrderType: 'Market',
        positionIdx: 0,
      });

      if (isTradingStopNotModified(tpRes)) {
        logger.log(
          'debug',
          'tp unchanged: %s %s price=%s rate=%s',
          symbol,
          direction,
          tpPriceNorm.priceStr,
          tp.rate,
        );
      } else if (tpRes.retCode === 0) {
        logger.log(
          'info',
          'tp updated: %s %s price=%s rate=%s',
          symbol,
          direction,
          tpPriceNorm.priceStr,
          tp.rate,
        );
      } else {
        logger.log(
          'error',
          'tp failed: %s %s price=%s rate=%s %s',
          symbol,
          direction,
          tpPriceNorm.priceStr,
          tp.rate,
          toJson(tpRes, true),
        );
      }

      if (!isTradingStopAccepted(tpRes)) {
        return false;
      }
    }

    return true;
  };

  const setStopLoss = async ({
    symbol,
    direction,
    stopLossPrice,
  }: {
    symbol: string;
    direction: Direction;
    stopLossPrice: number | null;
  }) => {
    const client = await getPrivateClient();
    const marketDataClient = await getPublicClient();

    if (!client || !marketDataClient) {
      return false;
    }

    if (typeof stopLossPrice !== 'number' || !Number.isFinite(stopLossPrice)) {
      return true;
    }

    const meta = await getSymbolMeta(marketDataClient, symbol);
    const isLong = direction === 'LONG';
    const slNormalized = normalizePrice(
      stopLossPrice,
      isLong ? 'SL_LONG' : 'SL_SHORT',
      meta,
    );

    const slRes = await client.setTradingStop({
      category: MARKET_CATEGORY,
      symbol,
      tpslMode: 'Full',
      stopLoss: slNormalized.priceStr,
      slTriggerBy: 'LastPrice',
      positionIdx: 0,
    });

    if (isTradingStopNotModified(slRes)) {
      logger.log(
        'debug',
        'sl unchanged: %s %s stopLoss=%s',
        symbol,
        direction,
        slNormalized.priceStr,
      );
    } else if (slRes.retCode === 0) {
      logger.log(
        'info',
        'sl updated: %s %s stopLoss=%s',
        symbol,
        direction,
        slNormalized.priceStr,
      );
    } else {
      logger.log(
        'error',
        'sl failed: %s %s stopLoss=%s %s',
        symbol,
        direction,
        slNormalized.priceStr,
        toJson(slRes, true),
      );
    }

    return isTradingStopAccepted(slRes);
  };

  /** -------------------- public API -------------------- */
  return {
    getState: async () => state,

    setState: async (newState: object) => {
      state = { ...state, ...newState };
    },

    kline: async ({
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
        // 1) что уже есть в БД
        const edges = await getDataEdges(symbol, intMinutes);
        let dataStart = edges.min; // ms | undefined
        let dataEnd = edges.max; // ms | undefined

        // 2) нормализуем требуемый диапазон к закрытым свечам
        const { normStart, normEnd } = normalizeRangeToClosed(
          intervalMs,
          defaultStart,
          defaultEnd,
        );

        // 3) cacheOnly — только из БД
        if (cacheOnly) {
          const base = edges.max ?? Date.now();
          const s = Math.max(
            defaultStart ?? base - CACHE_FALLBACK_WINDOW * intervalMs,
            0,
          );
          const e = defaultEnd ?? base;
          const dbData = await getCandlesRange(symbol, intMinutes, s, e);
          return rowsToKline(dbData);
        }

        // 4) решаем, надо ли дозагружать
        const needOlderData =
          defaultStart !== undefined &&
          (dataStart === undefined || normStart < dataStart);

        const needNewerData =
          defaultEnd !== undefined &&
          (dataEnd === undefined || normEnd > dataEnd);

        // 5) дозагрузка старого хвоста (батчами по 1000, через loadData/while)
        if (needOlderData) {
          const pointerForOlder = dataStart ?? normEnd ?? Date.now();
          const olderData = await loadData(
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
          );

          if (olderData.length) {
            await upsertCandles(toRows(symbol, intMinutes, olderData));
            dataStart = normStart;
          }
        }

        // 6) дозагрузка нового хвоста (батчами по 1000)
        if (needNewerData) {
          const pointerForNewer = dataEnd ?? normStart ?? 0;
          const newerData = await loadData(
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
          );

          if (newerData.length) {
            await upsertCandles(toRows(symbol, intMinutes, newerData));
            dataEnd = normEnd;
          }
        }

        // 7) точечное «освежение хвоста» из 2 свечей, если мы запрашиваем «правый край»
        const isRightEdgeQuery =
          defaultEnd === undefined ||
          (defaultEnd && defaultEnd >= Date.now() - intervalMs);

        if (!cacheOnly && isRightEdgeQuery) {
          await refreshTail({ symbol, interval, silent });
        }

        if (warmOnly) {
          if (isTimescaleFallbackMode) {
            isTimescaleFallbackMode = false;
            logger.log(
              'info',
              'TimescaleDB connection restored for kline cache',
            );
          }
          return [];
        }

        // 8) финальный SELECT из БД — источник истины
        const rangeStart = defaultStart ?? dataStart ?? 0;
        const rangeEnd = defaultEnd ?? dataEnd ?? Date.now();
        const { normStart: finalStart, normEnd: finalEnd } =
          normalizeRangeToClosed(intervalMs, rangeStart, rangeEnd);

        const dbData = await getCandlesRange(
          symbol,
          intMinutes,
          finalStart,
          finalEnd,
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
    },

    getPosition: async (symbol) => getPositionSnapshot(symbol),

    getPositions: async () => {
      const client = await getPrivateClient();

      if (!client) {
        return [];
      }

      const positionRes = await client.getPositionInfo({
        category: MARKET_CATEGORY,
        settleCoin: 'USDT',
      });

      if (positionRes.retCode !== 0) {
        logger.log(
          getLogLevel(positionRes),
          'positions retCode: %s, %s',
          positionRes.retCode,
        );
        return [];
      }

      const positions = mapPositionData(positionRes.result.list);

      if (!positions || _.isEmpty(positions)) {
        return [];
      }

      return positions;
    },

    placeOrder: async ({ symbol, price, qty, direction, isLimit }) => {
      const client = await getPrivateClient();
      const marketDataClient = await getPublicClient();

      if (!client || !marketDataClient) {
        return false;
      }

      const isLong = direction === 'LONG';

      const meta = await getSymbolMeta(marketDataClient, symbol);

      const { qtyNum: orderQty, qtyStr: orderQtyStr } = normalizeQty(qty, meta);

      if (orderQty < meta.minOrderQty) {
        logger.log(
          'warn',
          'placeOrder: qty too small: %s',
          toJson(
            { symbol, qty, orderQty, minOrderQty: meta.minOrderQty },
            true,
          ),
        );
        return false;
      }

      const entryNormalized = isLimit
        ? normalizePrice(price, 'ENTRY', meta)
        : undefined;

      logger.log(
        'info',
        'placeOrder: %s',
        toJson(
          {
            symbol,
            price,
            qty,
            direction,
            orderQty,
            orderQtyStr,
          },
          true,
        ),
      );

      await client.setLeverage({
        category: MARKET_CATEGORY,
        symbol,
        buyLeverage: '10',
        sellLeverage: '10',
      });

      const orderRes = await client.submitOrder({
        category: MARKET_CATEGORY,
        symbol,
        price: entryNormalized?.priceStr || undefined,
        side: isLong ? 'Buy' : 'Sell',
        orderType: isLimit ? 'Limit' : 'Market',
        qty: orderQtyStr,
        orderFilter: 'Order',
      });

      logger.log(
        getLogLevel(orderRes),
        'placeOrder:response: %s',
        toJson(orderRes, true),
      );

      if (orderRes.retCode !== 0) {
        return false;
      }

      return true;
    },

    setTakeProfits,

    setStopLoss,

    closePosition: async ({ symbol, direction }) => {
      const client = await getPrivateClient();

      if (!client) {
        return false;
      }

      const closeRes = await client.submitOrder({
        category: MARKET_CATEGORY,
        symbol,
        side: direction === 'LONG' ? 'Sell' : 'Buy',
        orderType: 'Market',
        qty: '0',
        reduceOnly: true,
      });

      logger.log(
        getLogLevel(closeRes),
        'closePosition: %s, %s, %s',
        symbol,
        direction,
        toJson(closeRes, true),
      );

      if (closeRes.retCode !== 0) {
        return false;
      }

      return true;
    },

    getTickers: async () => {
      const client = await getPublicClient();

      if (!client) {
        return [];
      }

      const data = await client.getTickers({
        category: MARKET_CATEGORY,
      });

      return data.result.list.map((item) => normalizeTickerData(item as any));
    },
  };
};
