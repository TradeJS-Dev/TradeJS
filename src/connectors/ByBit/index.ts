'use server';

import _ from 'lodash';
import chalk from 'chalk';
import { getClient } from './client';
import { mapKlineToChartData } from './utils';
import {
  getTimestamp,
  getItemTimestamp,
  getDataTimestamp,
  formatUnix,
} from '@utils/timestamp';
import { getCache, setCache } from '@utils/cache';
import { normalizeTickerData } from '@utils/tickers';
import { mergeData } from '@utils/array';
import { logger } from '@utils/logger';
import { stringify } from '@utils/stringify';
import {
  KlineChartData,
  KlineRequest,
  ConnectorCreator,
  Direction,
} from '@types';

const LIMIT = 1000;

const getLogLevel = (res: any) => (res.retCode === 0 ? 'info' : 'error');

export const ByBitConnectorCreator: ConnectorCreator = (config) => {
  const request = async ({ symbol, interval, start, end }: KlineRequest) => {
    try {
      const client = getClient(config);

      const kline = await client.getKline({
        category: 'linear',
        symbol,
        interval,
        start: start || getTimestamp(30),
        end,
        limit: LIMIT,
      });

      logger.log(
        'info',
        '%s %s %s %s',
        chalk.yellow(formatUnix(end)),
        chalk.cyan(symbol),
        chalk.cyan(interval),
        chalk.yellow(kline.result.list.length),
      );

      return mapKlineToChartData(kline.result.list.reverse());
    } catch (error) {
      logger.log('error', 'request kline: %s', error);

      return [];
    }
  };

  return {
    kline: async ({
      symbol,
      interval,
      start: defaultStart,
      end: defaultEnd,
    }: KlineRequest) => {
      let data = getCache('data', `${symbol}_${interval}`) as KlineChartData;
      let loadedData = [] as KlineChartData;
      const cacheTimestamp = getDataTimestamp(data);

      let end = defaultEnd;
      const start = cacheTimestamp || defaultStart;
      let fulfilled = start && end && end <= start;

      const getPartData = async () => {
        const partData = await request({
          symbol,
          interval,
          start,
          end,
        });

        if (_.isEmpty(partData)) {
          fulfilled = true;
          return;
        }

        loadedData = mergeData(partData, loadedData);

        if (partData.length < LIMIT) {
          fulfilled = true;
        }

        end = getItemTimestamp(partData[0]);
      };

      while (!fulfilled) {
        await getPartData();
      }

      data = mergeData(data, loadedData);

      if (!_.isEmpty(loadedData)) {
        setCache('data', `${symbol}_${interval}`, data);
      }

      data = data.filter((item) => {
        const currentTimestamp = getItemTimestamp(item);

        return (
          currentTimestamp >= (defaultStart || 0) &&
          currentTimestamp <= (defaultEnd || Infinity)
        );
      });

      return data;
    },
    getPosition: async (symbol) => {
      const client = getClient(config);

      const positionRes = await client.getPositionInfo({
        symbol,
        category: 'linear',
      });

      logger.log(
        getLogLevel(positionRes),
        'position: %s, %s',
        symbol,
        stringify(positionRes),
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

      return {
        ...position,
      };
    },
    placeOrder: async ({ symbol, price, qty, direction }, TP = [], sl) => {
      const client = getClient(config);

      const isLong = direction === 'LONG';

      let slPrice = null;

      if (sl) {
        slPrice = isLong ? price * (1 - sl) : price * (1 + sl);
      }

      logger.log(
        'info',
        'placeOrder: %s',
        stringify({ symbol, price, qty, direction, TP, sl }),
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
        qty: qty.toFixed(1),
        orderFilter: 'Order',
      });

      logger.log(
        getLogLevel(orderRes),
        'placeOrder:response: %s',
        stringify(orderRes),
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
          tpSize: tpSize.toFixed(1),
          tpslMode: 'Partial',
          takeProfit: tpPrice,
          tpOrderType: 'Market',
          positionIdx: 0,
        });

        logger.log(
          getLogLevel(tpRes),
          'tp: %s %s',
          stringify(tp),
          stringify(tpRes),
        );
      }

      return true;
    },
    closePosition: async ({ symbol, direction }) => {
      const client = getClient(config);

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
        stringify(closeRes),
      );

      if (closeRes.retCode !== 0) {
        return false;
      }

      return true;
    },
    getTickers: async () => {
      const client = getClient(config);

      const data = await client.getTickers({
        category: 'linear',
      });

      return data.result.list.map((item) => normalizeTickerData(item as any));
    },
  };
};
