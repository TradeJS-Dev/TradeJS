'use server';

import _ from 'lodash';
import { evaluate } from 'mathjs';
import { ByBitConnectorCreator } from '@src/connectors/ByBit';
import { getUnixTime } from 'date-fns';
import { setCache } from '@src/utils/cache';
import {
  TestConnectorCreator as TCC,
  Kline,
  Order,
  OrderLogData,
  KlineChartData,
  Tpl,
} from '@types';

export const TestConnectorCreator: TCC = (config) => {
  let CURRENT_POSITION: Order | null = null;
  let ORIGINAL_QTY = 0;
  let AMOUNT = 100;
  let MIN_AMOUT = AMOUNT;
  let ORDERS = 0;
  let TPL: Tpl[] = [];
  const ORDER_LOG: OrderLogData = [];
  let LOADED_DATA: KlineChartData = [];

  const byBitConnector = ByBitConnectorCreator(config);

  const loadData: Kline = async (options) => {
    const end = getUnixTime(new Date()) * 1000;

    const data = await byBitConnector.kline({
      symbol: options.symbol,
      interval: options.interval,
      end,
    });

    LOADED_DATA = data;

    return LOADED_DATA;
  };

  const kline: Kline = async (options) => {
    if (_.isEmpty(LOADED_DATA)) {
      await loadData(options);
    }

    const res = LOADED_DATA.filter((item) => item.timestamp <= options.end);

    return res;
  };

  return {
    kline,
    getStat: () => {
      return {
        amount: AMOUNT,
        minAmount: MIN_AMOUT,
        orders: ORDERS,
      };
    },
    saveStat: (symbol: string, id: string) => {
      setCache('backtest', `${symbol}_${id}`, ORDER_LOG);
    },
    getPosition: () => {
      return new Promise((resolve) => resolve(CURRENT_POSITION || null));
    },
    checkTpl: async (symbol: string, timestamp: number) => {
      if (
        _.isEmpty(TPL) ||
        !ORIGINAL_QTY ||
        !CURRENT_POSITION ||
        _.isEmpty(CURRENT_POSITION)
      ) {
        return;
      }

      let data = await kline({
        symbol,
        interval: '5',
        end: timestamp,
      });

      if (_.isEmpty(data)) {
        return;
      }

      const price = data.pop()?.high;

      if (!price) {
        return;
      }

      TPL = TPL.filter(({ done }) => !done).map((tpl, i) => {
        if (
          !CURRENT_POSITION ||
          price < CURRENT_POSITION.price * (1 + tpl.profit)
        ) {
          return tpl;
        }

        const qty = ORIGINAL_QTY * tpl.rate;

        const summ = evaluate(
          `(${price} - ${CURRENT_POSITION.price}) * ${qty}`,
        );

        AMOUNT = evaluate(`${AMOUNT} + ${summ}`);
        CURRENT_POSITION.qty = evaluate(`${CURRENT_POSITION.qty} - ${qty}`);

        ORDER_LOG.push({
          ...CURRENT_POSITION,
          timestamp,
          qty,
          price,
          type: 'SELL',
        });

        return {
          ...tpl,
          done: true,
        };
      });
    },
    placeOrder: (order, tpl) => {
      TPL = tpl;

      CURRENT_POSITION = {
        ...order,
      };
      ORIGINAL_QTY = order.qty;

      ORDER_LOG.push({
        ...order,
        type: 'BUY',
      });

      return new Promise((resolve) => resolve(true));
    },
    closePosition: (order) => {
      if (!CURRENT_POSITION || _.isEmpty(CURRENT_POSITION)) {
        return new Promise((resolve) => resolve(false));
      }

      const summ = evaluate(
        `(${order.price} - ${CURRENT_POSITION.price}) * ${CURRENT_POSITION.qty}`,
      );

      AMOUNT = evaluate(`${AMOUNT} + ${summ}`);

      MIN_AMOUT = _.min([MIN_AMOUT, AMOUNT]) || MIN_AMOUT;
      ORDERS++;
      ORDER_LOG.push({
        ...CURRENT_POSITION,
        ...order,
        type: 'SELL',
      });

      TPL = [];
      ORIGINAL_QTY = 0;
      CURRENT_POSITION = null;

      return new Promise((resolve) => resolve(true));
    },
  };
};
