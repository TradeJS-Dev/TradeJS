'use server';

import _ from 'lodash';
import chalk from 'chalk';
import { PRELOAD_FALLBACK_DAYS } from '@constants';
import { getClient } from './client';
import { mapKlineToChartData } from './utils';
import { getTimestamp, getItemTimestamp, formatUnix } from '@utils/timestamp';
import { getData, setData } from '@utils/data';
import { normalizeTickerData } from '@utils/tickers';
import { mergeData, isWrongData } from '@utils/array';
import { logger } from '@utils/logger';
import { toJson } from '@utils/toJson';
import {
  KlineChartData,
  KlineRequest,
  ConnectorCreator,
  Direction,
} from '@types';

const LIMIT = 1000;

const getLogLevel = (res: any) => (res.retCode === 0 ? 'info' : 'error');

export const ByBitConnectorCreator: ConnectorCreator = (config) => {
  let state = {};

  const request = async ({
    symbol,
    interval,
    start,
    end,
    silent,
  }: KlineRequest) => {
    try {
      const client = await getClient(config);

      if (!client) {
        return [];
      }

      const kline = await client.getKline({
        category: 'linear',
        symbol,
        interval,
        start: start || getTimestamp(PRELOAD_FALLBACK_DAYS),
        end,
        limit: LIMIT,
      });

      if (!kline.result.list) {
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

      return mapKlineToChartData(kline.result.list.reverse());
    } catch (error) {
      logger.log('error', 'request kline: %s', error);

      return [];
    }
  };

  const loadData = async (
    direction: 'older' | 'newer',
    pointer: number | undefined,
    limitBoundary: number | undefined,
    requestParams: KlineRequest,
    requestFn: (args: KlineRequest) => Promise<KlineChartData>,
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

      const partData = await requestFn(params);

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

  return {
    getState: async () => {
      return state;
    },
    setState: async (newState: object) => {
      state = {
        ...state,
        ...newState,
      };
    },

    kline: async ({
      symbol,
      interval,
      start: defaultStart,
      end: defaultEnd,
      silent = false,
      cacheOnly = false,
    }: KlineRequest) => {
      const cache = (await getData(
        'data/history',
        `${symbol}_${interval}`,
      )) as KlineChartData;

      let data =
        !cache || _.isEmpty(cache) || isWrongData(interval, cache) ? [] : cache;

      if (cacheOnly) {
        return data;
      }

      if (data.length > 1) {
        data.pop();
      }

      const dataStart = data.length ? getItemTimestamp(data[0]) : undefined;
      const dataEnd = data.length
        ? getItemTimestamp(data[data.length - 1])
        : undefined;

      const needOlderData =
        defaultStart !== undefined &&
        (data.length === 0 ||
          (dataStart !== undefined && defaultStart < dataStart));
      const needNewerData =
        defaultEnd !== undefined &&
        (data.length === 0 || (dataEnd !== undefined && defaultEnd > dataEnd));

      if (needOlderData) {
        const pointerForOlder = dataStart ?? defaultEnd ?? Date.now();
        const olderData = await loadData(
          'older',
          pointerForOlder,
          defaultStart,
          {
            symbol,
            interval,
            silent,
            start: defaultStart ?? 0,
            end: pointerForOlder,
          },
          request,
        );
        data = mergeData(olderData, data);
      }

      if (needNewerData) {
        const pointerForNewer = dataEnd ?? defaultStart ?? 0;
        const newerData = await loadData(
          'newer',
          pointerForNewer,
          defaultEnd,
          {
            symbol,
            interval,
            silent,
            start: pointerForNewer,
            end: defaultEnd ?? Date.now(),
          },
          request,
        );
        data = mergeData(data, newerData);
      }

      if (!_.isEmpty(data)) {
        await setData('data/history', `${symbol}_${interval}`, data);
      }

      return data.filter((item) => {
        const ts = getItemTimestamp(item);
        return ts >= (defaultStart || 0) && ts <= (defaultEnd || Infinity);
      });
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
