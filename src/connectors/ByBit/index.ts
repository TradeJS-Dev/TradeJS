'use server';

import _ from 'lodash';
import chalk from 'chalk';
import { getUnixTime, subDays } from 'date-fns';
import { getClient } from './client';
import { mapKlineToChartData } from './utils';
import {
  getItemTimestamp,
  getDataTimestamp,
  formatUnix,
} from '@src/utils/timestamp';

import { getCache, setCache } from '@src/utils/cache';
import { normalizeTickerData } from '@src/utils/tickers';
import { mergeData } from '@src/utils/array';
import { KlineChartData, KlineRequest, ConnectorCreator } from '@types';

const LIMIT = 1000;

export const ByBitConnectorCreator: ConnectorCreator = (config) => {
  const request = async ({ symbol, interval, start, end }: KlineRequest) => {
    try {
      const client = getClient(config);

      const kline = await client.getKline({
        category: 'linear',
        symbol,
        interval,
        start: start || getUnixTime(subDays(new Date(), 30)) * 1000,
        end,
        limit: LIMIT,
      });

      console.log(
        chalk.yellow(formatUnix(end)),
        chalk.cyan(symbol),
        chalk.yellow(kline.result.list.length),
      );

      return mapKlineToChartData(kline.result.list.reverse());
    } catch (error) {
      console.error('request kline: ', error);

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

      if (process.env.FREEZE_CACHE !== '1') {
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

      console.log('position', JSON.stringify(positionRes, null, 2));

      if (positionRes.retCode !== 0) {
        return null;
      }

      const positions = positionRes.result.list
        .filter((item) => Number.parseFloat(item.size) > 0)
        .map((item) => ({
          symbol: item.symbol,
          price: Number.parseFloat(item.avgPrice),
          qty: Number.parseFloat(item.size),
        }));

      if (!positions || _.isEmpty(positions)) {
        return null;
      }

      const position = positions[0]

      return {
        ...position,
        direction: position.qty > 0 ? 'LONG' : 'SHORT'
      };
    },
    placeOrder: async ({ symbol, price, qty }, TP = []) => {
      const client = getClient(config);

      const orderRes = await client.submitOrder({
        category: 'linear',
        symbol,
        side: 'Buy',
        orderType: 'Market',
        qty: qty.toFixed(0),
        orderFilter: 'Order',
      });

      console.log('placeOrder', JSON.stringify(orderRes, null, 2));

      if (orderRes.retCode !== 0) {
        return false;
      }

      for await (const tp of TP) {
        const tpSize = qty * tp.rate;

        const tpRes = await client.setTradingStop({
          category: 'linear',
          symbol,
          tpSize: tpSize.toFixed(0),
          tpslMode: 'Partial',
          takeProfit: `${price * (1 + tp.profit)}`,
          tpOrderType: 'Market',
          positionIdx: 0,
        });

        console.log('tp', tp, JSON.stringify(tpRes, null, 2));
      }

      return true;
    },
    closePosition: async ({ symbol }) => {
      const client = getClient(config);

      const closeRes = await client.submitOrder({
        category: 'linear',
        symbol,
        side: 'Sell',
        orderType: 'Market',
        qty: '0',
        reduceOnly: true,
      });

      console.log('closePosition', closeRes);

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
