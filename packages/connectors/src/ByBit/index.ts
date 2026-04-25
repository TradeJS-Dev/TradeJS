'use server';

import _ from 'lodash';
import chalk from 'chalk';
import { delay } from '@tradejs/core/async';
import {
  MARKET_CATEGORY,
  PRELOAD_FALLBACK_DAYS,
} from '@tradejs/core/constants';
import { toJson } from '@tradejs/core/data';
import { round } from '@tradejs/core/math';
import { normalizeTickerData } from '@tradejs/core/tickers';
import { formatUnix, getTimestamp } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';

import { getClient } from './client';
import { createTimescaleCachedKline } from '../shared/timescaleKlineCache';
import {
  mapKlineToChartData,
  normalizePrice,
  normalizeQty,
  getSymbolMeta,
  mapPositionData,
} from './utils';
import {
  ClosedPnlRecord,
  KlineRequest,
  ConnectorCreator,
  Direction,
  GetClosedPnlParams,
  Interval,
  Position,
  PositionPnlSnapshot,
  Tp,
} from '@tradejs/types';

const LIMIT = 1000;
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

        if (
          !silent &&
          (process.stdout.isTTY ||
            process.env.TRADEJS_LOG_KLINE_REQUESTS === '1')
        ) {
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

  /** -------------------- small helpers -------------------- */
  const intervalToMinutes = (interval: Interval): number | null => {
    return INTERVAL_TO_MINUTES[String(interval)] ?? null;
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

    kline: createTimescaleCachedKline({
      provider: 'bybit',
      request,
      intervalToMinutes,
      limit: LIMIT,
    }),

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

    getOpenPositionPnl: async () => {
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
          'positions pnl retCode: %s, %s',
          positionRes.retCode,
        );
        return [];
      }

      return (
        (positionRes.result?.list ?? []) as unknown as Array<
          Record<string, unknown>
        >
      )
        .map((item) => {
          const qty = Number(item.size ?? Number.NaN);
          const entryPrice = Number(item.avgPrice ?? Number.NaN);
          const currentPrice = Number(item.markPrice ?? Number.NaN);
          const unrealizedPnl = Number(item.unrealisedPnl ?? Number.NaN);
          const side = String(item.side ?? '');

          if (
            !Number.isFinite(qty) ||
            qty <= 0 ||
            !Number.isFinite(entryPrice) ||
            !Number.isFinite(currentPrice) ||
            !Number.isFinite(unrealizedPnl) ||
            (side !== 'Buy' && side !== 'Sell')
          ) {
            return null;
          }

          return {
            symbol: String(item.symbol ?? ''),
            qty,
            price: entryPrice,
            currentPrice,
            unrealizedPnl,
            direction: (side === 'Buy' ? 'LONG' : 'SHORT') as Direction,
          } satisfies PositionPnlSnapshot;
        })
        .filter(
          (item): item is PositionPnlSnapshot =>
            item != null && item.symbol.length > 0,
        );
    },

    getClosedPnl: async ({
      startTime,
      endTime,
      symbol,
      limit = 100,
    }: GetClosedPnlParams): Promise<ClosedPnlRecord[]> => {
      const client = await getPrivateClient();
      if (!client) {
        return [];
      }

      const response = await client.getClosedPnL({
        category: MARKET_CATEGORY,
        startTime,
        endTime,
        symbol,
        limit: Math.min(Math.max(1, Math.trunc(limit)), 100),
      });

      if (response.retCode !== 0) {
        logger.log(
          'error',
          'closedPnl retCode: %s, %s',
          response.retCode,
          response.retMsg,
        );
        return [];
      }

      return (response.result?.list ?? [])
        .map((item) => {
          const qty = Number(item.qty ?? item.closedSize ?? Number.NaN);
          const entryPrice = Number(item.avgEntryPrice ?? Number.NaN);
          const exitPrice = Number(item.avgExitPrice ?? Number.NaN);
          const closedPnl = Number(item.closedPnl ?? Number.NaN);
          const closedAt = Number(
            item.updatedTime ?? item.createdTime ?? Number.NaN,
          );
          const orderId =
            typeof item.orderId === 'string' && item.orderId.trim()
              ? item.orderId
              : null;

          if (
            !String(item.symbol ?? '').trim() ||
            !Number.isFinite(qty) ||
            !Number.isFinite(closedPnl) ||
            !Number.isFinite(closedAt)
          ) {
            return null;
          }

          return {
            symbol: String(item.symbol),
            qty,
            entryPrice: Number.isFinite(entryPrice) ? entryPrice : null,
            exitPrice: Number.isFinite(exitPrice) ? exitPrice : null,
            closedPnl,
            closedAt,
            ...(orderId ? { orderId } : {}),
          } as ClosedPnlRecord;
        })
        .filter((item): item is NonNullable<typeof item> => item != null);
    },

    placeOrder: async ({ symbol, price, qty, direction, isLimit, orderId }) => {
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
        orderLinkId:
          typeof orderId === 'string' && orderId.trim() ? orderId : undefined,
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
