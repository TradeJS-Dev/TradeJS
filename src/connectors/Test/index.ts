'use server';

import _ from 'lodash';
import { ByBitConnectorCreator } from '@src/connectors/ByBit';
import { setCache } from '@utils/cache';
import {
  TestConnectorCreator as TCC,
  Kline,
  OrderWithDirection,
  OrderLogData,
  Sl,
  Tp,
} from '@types';

export const TestConnectorCreator: TCC = (config) => {
  let CURRENT_POSITION: OrderWithDirection | null = null; // Текущая открытая позиция
  let ORIGINAL_QTY = 0;
  let AMOUNT = 100;
  let MIN_AMOUNT = AMOUNT;
  const FEE = 0.005; 
  let ORDERS = 0;
  let TP: Tp[] = [];
  let SL: Sl | null = null;
  const ORDER_LOG: OrderLogData = [];

  const byBitConnector = ByBitConnectorCreator(config);

  const kline: Kline = async (options) => {
    return await byBitConnector.kline(options);
  };

  const updateMinAmount = () => {
    MIN_AMOUNT = Math.min(MIN_AMOUNT, AMOUNT);
  };

  return {
    kline,

    getStat: () => ({
      amount: AMOUNT,
      minAmount: MIN_AMOUNT,
      orders: ORDERS,
    }),

    saveStat: (symbol: string, id: string) => {
      setCache('data', `_backtest_${symbol}_${id}`, ORDER_LOG);
    },

    getPosition: async () => CURRENT_POSITION || null,

    checkTp: async (symbol: string, start: number, end: number) => {
      const data = await kline({ symbol, interval: '5', start, end });
      if (_.isEmpty(data) || !CURRENT_POSITION || !CURRENT_POSITION.qty) {
        return;
      }

      const isLong = CURRENT_POSITION.direction === 'LONG';
      const entryPrice = CURRENT_POSITION.price;

      for (const candle of data) {
        const high = candle.high;
        const low = candle.low;

        for (const tp of TP) {
          if (!CURRENT_POSITION || CURRENT_POSITION.qty <= 0) break;

          const targetPrice = isLong
            ? entryPrice * (1 + tp.profit)
            : entryPrice * (1 - tp.profit);

          const reached = isLong ? high >= targetPrice : low <= targetPrice;

          if (reached) {
            const qty = ORIGINAL_QTY * tp.rate;
            const profit = isLong
              ? (targetPrice - entryPrice) * qty
              : (entryPrice - targetPrice) * qty;

            AMOUNT += profit;
            updateMinAmount();

            CURRENT_POSITION.qty = Math.max(0, CURRENT_POSITION.qty - qty);

            ORDER_LOG.push({
              ...CURRENT_POSITION,
              timestamp: candle.timestamp,
              qty,
              price: targetPrice,
              profit,
              type: isLong ? 'TAKE_PROFIT_LONG' : 'TAKE_PROFIT_SHORT',
              index: ORDER_LOG.length,
            });

            tp.done = true;
          }
        }

        TP = TP.filter(({ done }) => !done);

        if (CURRENT_POSITION && CURRENT_POSITION.qty <= 0) {
          TP = [];
          SL = null;
          ORIGINAL_QTY = 0;
          CURRENT_POSITION = null;
          break;
        }
      }
    },

    checkSl: async (symbol: string, start: number, end: number) => {
      if (!SL || SL.done || !CURRENT_POSITION) {
        return;
      }

      const data = await kline({ symbol, interval: '5', start, end });
      if (_.isEmpty(data)) {
        return;
      }

      const isLong = CURRENT_POSITION.direction === 'LONG';

      for (const candle of data) {
        const high = candle.high;
        const low = candle.low;

        const hitStop = isLong ? low <= SL.price : high >= SL.price;

        if (hitStop) {
          const qty = CURRENT_POSITION.qty;
          const profit = isLong
            ? (SL.price - CURRENT_POSITION.price) * qty
            : (CURRENT_POSITION.price - SL.price) * qty;

          AMOUNT += profit;
          updateMinAmount();

          ORDER_LOG.push({
            ...CURRENT_POSITION,
            timestamp: candle.timestamp,
            qty,
            profit,
            price: SL.price,
            type: isLong ? 'STOP_LOSS_LONG' : 'STOP_LOSS_SHORT',
            index: ORDER_LOG.length,
          });

          TP = [];
          SL = null;
          ORIGINAL_QTY = 0;
          CURRENT_POSITION = null;

          break;
        }
      }
    },

    placeOrder: async (order, tp = [], sl) => {
      if (CURRENT_POSITION) throw new Error('Position already open');

      TP = tp;
      SL = sl || null;
      CURRENT_POSITION = { ...order };
      ORIGINAL_QTY = order.qty;

      const profit = order.price * order.qty * FEE * (-1);

      AMOUNT += profit;
      updateMinAmount();

      ORDER_LOG.push({
        ...order,
        profit,
        type: order.direction === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT',
        index: ORDER_LOG.length,
      });

      ORDERS++;
      return true;
    },

    closePosition: async (order) => {
      if (!CURRENT_POSITION) {
        return false;
      }

      const isLong = CURRENT_POSITION.direction === 'LONG';
      const profit = isLong
        ? (order.price - CURRENT_POSITION.price) * CURRENT_POSITION.qty
        : (CURRENT_POSITION.price - order.price) * CURRENT_POSITION.qty;

      AMOUNT += profit;
      updateMinAmount();

      ORDER_LOG.push({
        ...CURRENT_POSITION,
        ...order,
        qty: CURRENT_POSITION.qty,
        profit,
        type: isLong ? 'CLOSE_LONG' : 'CLOSE_SHORT',
        index: ORDER_LOG.length,
      });

      TP = [];
      SL = null;
      ORIGINAL_QTY = 0;
      CURRENT_POSITION = null;

      return true;
    },

    getTickers: async () => [],
  };
};
