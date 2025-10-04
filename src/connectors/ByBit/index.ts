'use server';

import _ from 'lodash';
import chalk from 'chalk';
import { PRELOAD_FALLBACK_DAYS } from '@constants';
import { getClient } from './client';
import { mapKlineToChartData } from './utils';
import { getTimestamp, getItemTimestamp, formatUnix } from '@utils/timestamp';
import { normalizeTickerData } from '@utils/tickers';
import { mergeData } from '@utils/array';
import { logger } from '@utils/logger';
import { toJson } from '@utils/toJson';
import {
  getCandlesRange,
  getDataEdges,
  upsertCandles,
  toRows,
} from '@utils/timescale';
import {
  KlineChartData,
  KlineRequest,
  ConnectorCreator,
  Direction,
  Interval,
} from '@types';

const LIMIT = 1000;

const getLogLevel = (res: any) => (res.retCode === 0 ? 'info' : 'error');

export const ByBitConnectorCreator: ConnectorCreator = (config) => {
  let state: Record<string, unknown> = {};

  /** -------------------- low-level fetch from exchange -------------------- */
  const request = async ({
    symbol,
    interval,
    start,
    end,
    silent,
  }: KlineRequest) => {
    try {
      const client = await getClient(config);
      if (!client) return [];

      const kline = await client.getKline({
        category: 'linear',
        symbol,
        interval,
        start: start || getTimestamp(PRELOAD_FALLBACK_DAYS),
        end,
        limit: LIMIT,
      });

      if (!kline?.result?.list) {
        console.error('kline.result', symbol, kline);
        return [];
      }

      if (!silent) {
        logger.log(
          'info',
          '%s %s %s %s',
          chalk.yellow(formatUnix(end)),
          chalk.cyan(symbol),
          chalk.cyan(interval),
          chalk.yellow(kline.result.list.length),
        );
      }

      // reverse() -> по возрастанию времени
      return mapKlineToChartData(kline.result.list.reverse());
    } catch (error) {
      logger.log('error', 'request kline: %s', error);
      return [];
    }
  };

  /** -------------------- batched loader (keeps your while) -------------------- */
  const loadData = async (
    direction: 'older' | 'newer',
    pointer: number | undefined,
    limitBoundary: number | undefined,
    requestParams: KlineRequest,
  ): Promise<KlineChartData> => {
    if (pointer === undefined) return [];

    let accumulated: KlineChartData = [];
    let fulfilled = false;

    while (!fulfilled) {
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

      if (partData.length < LIMIT) {
        fulfilled = true;
        break;
      }

      pointer =
        direction === 'older'
          ? getItemTimestamp(partData[0])
          : getItemTimestamp(partData[partData.length - 1]);
    }

    return accumulated;
  };

  /** -------------------- small helpers -------------------- */
  const intervalMsOf = (interval: number) => interval * 60_000;

  // clamp end к последней закрытой свече, чтобы не перефетчить «текущую» бесконечно
  const normalizeRangeToClosed = (
    intervalMs: number,
    start?: number,
    end?: number,
  ) => {
    const lastClosed = Math.floor(Date.now() / intervalMs) * intervalMs;
    const s = start ?? 0;
    const e = Math.min(end ?? Date.now(), lastClosed);
    return { s, e, lastClosed };
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
    const intMinutes = Number(interval);
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
    }: KlineRequest) => {
      const intMinutes = Number(interval);
      const intervalMs = intervalMsOf(intMinutes);

      // 1) что уже есть в БД
      const edges = await getDataEdges(symbol, intMinutes);
      let dataStart = edges.min; // ms | undefined
      let dataEnd = edges.max; // ms | undefined

      // 2) нормализуем требуемый диапазон к закрытым свечам
      const { s: normStart, e: normEnd } = normalizeRangeToClosed(
        intervalMs,
        defaultStart,
        defaultEnd,
      );

      // 3) cacheOnly — только из БД
      if (cacheOnly) {
        const s = defaultStart ?? (edges.max ?? 0) - 1000 * intervalMs;
        const e = defaultEnd ?? edges.max ?? Date.now();
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
        const olderData = await loadData('older', pointerForOlder, normStart, {
          symbol,
          interval,
          silent,
          start: normStart,
          end: pointerForOlder,
        });

        if (olderData.length) {
          await upsertCandles(toRows(symbol, intMinutes, olderData));
          dataStart = normStart;
        }
      }

      // 6) дозагрузка нового хвоста (батчами по 1000)
      if (needNewerData) {
        const pointerForNewer = dataEnd ?? normStart ?? 0;
        const newerData = await loadData('newer', pointerForNewer, normEnd, {
          symbol,
          interval,
          silent,
          start: pointerForNewer,
          end: normEnd,
        });

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

      // 8) финальный SELECT из БД — источник истины
      const rangeStart = defaultStart ?? dataStart ?? 0;
      const rangeEnd = defaultEnd ?? dataEnd ?? Date.now();
      const { s: finalStart, e: finalEnd } = normalizeRangeToClosed(
        intervalMs,
        rangeStart,
        rangeEnd,
      );

      const dbData = await getCandlesRange(
        symbol,
        intMinutes,
        finalStart,
        finalEnd,
      );
      return rowsToKline(dbData);
    },

    getPosition: async (symbol) => {
      const client = await getClient(config);

      if (!client) {
        return null;
      }

      const positionRes = await client.getPositionInfo({
        symbol,
        category: 'linear',
      });

      logger.log(
        getLogLevel(positionRes),
        'position retCode: %s, %s',
        symbol,
        positionRes.retCode,
      );

      if (positionRes.retCode !== 0) {
        return null;
      }

      const positions = positionRes.result.list
        .filter((item) => Number.parseFloat(item.size) > 0)
        .map((item) => ({
          symbol: item.symbol,
          price: Number.parseFloat(item.avgPrice),
          qty: Number.parseFloat(item.size),
          direction: (item.side === 'Buy' ? 'LONG' : 'SHORT') as Direction,
        }));

      if (!positions || _.isEmpty(positions)) {
        return null;
      }

      const position = positions[0];

      logger.log(
        getLogLevel(positionRes),
        'position: %s, %s',
        symbol,
        toJson(positionRes, true),
      );

      return {
        ...position,
      };
    },
    placeOrder: async ({ symbol, price, qty, direction }, TP = [], sl) => {
      const client = await getClient(config);

      if (!client) {
        return false;
      }

      const isLong = direction === 'LONG';

      let slPrice = null;

      if (sl) {
        slPrice = isLong ? price * (1 - sl) : price * (1 + sl);
      }

      logger.log(
        'info',
        'placeOrder: %s',
        toJson({ symbol, price, qty, direction, TP, sl }, true),
      );

      await client.setLeverage({
        category: 'linear',
        symbol,
        buyLeverage: '10',
        sellLeverage: '10',
      });

      const orderRes = await client.submitOrder({
        category: 'linear',
        symbol,
        stopLoss: slPrice ? slPrice.toString() : undefined,
        side: isLong ? 'Buy' : 'Sell',
        orderType: 'Market',
        qty: qty.toFixed(0),
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

      for await (const tp of TP) {
        const tpSize = qty * tp.rate;
        const tpPrice = isLong
          ? `${price * (1 + tp.profit)}`
          : `${price * (1 - tp.profit)}`;

        const tpRes = await client.setTradingStop({
          category: 'linear',
          symbol,
          tpSize: tpSize.toFixed(0),
          tpslMode: 'Partial',
          takeProfit: tpPrice,
          tpOrderType: 'Market',
          positionIdx: 0,
        });

        logger.log(
          getLogLevel(tpRes),
          'tp: %s %s',
          toJson(tp, true),
          toJson(tpRes, true),
        );
      }

      return true;
    },
    closePosition: async ({ symbol, direction }) => {
      const client = await getClient(config);

      if (!client) {
        return false;
      }

      const closeRes = await client.submitOrder({
        category: 'linear',
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
      const client = await getClient(config);

      if (!client) {
        return [];
      }

      const data = await client.getTickers({
        category: 'linear',
      });

      return data.result.list.map((item) => normalizeTickerData(item as any));
    },
  };
};
