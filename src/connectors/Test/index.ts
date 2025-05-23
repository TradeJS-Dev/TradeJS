'use server';

import _ from 'lodash';
import { setCache } from '@utils/cache';
import {
  TestConnectorCreator as TCC,
  Kline,
  Order,
  OrderLogData,
  Sl,
  Tp,
  Candle,
} from '@types';

export const TestConnectorCreator: TCC = (connector) => {
  let CURRENT_POSITION: Order | null = null; // Текущая открытая позиция
  let ORIGINAL_QTY = 0;
  let AMOUNT = 100;
  let MIN_AMOUNT = AMOUNT;
  const FEE = 0.005;
  let ORDERS = 0;
  let TP: Tp[] = [];
  let SL: Sl = null;
  const ORDER_LOG: OrderLogData = [];

  const kline: Kline = async (options) => {
    return await connector.kline(options);
  };

  const updateMinAmount = () => {
    MIN_AMOUNT = Math.min(MIN_AMOUNT, AMOUNT);
  };

  const clearPosition = () => {
    TP = [];
    SL = null;
    ORIGINAL_QTY = 0;
    CURRENT_POSITION = null;
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

    checkTp: (candle: Candle) => {
      if (_.isEmpty(candle) || !CURRENT_POSITION || !CURRENT_POSITION.qty) {
        return;
      }

      const isLong = CURRENT_POSITION.direction === 'LONG';
      const entryPrice = CURRENT_POSITION.price;

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
        clearPosition();
      }
    },

    checkSl: (candle: Candle) => {
      if (!SL || !CURRENT_POSITION || _.isEmpty(candle)) {
        return;
      }

      const isLong = CURRENT_POSITION.direction === 'LONG';

      const high = candle.high;
      const low = candle.low;

      const hitStop = isLong ? low <= SL : high >= SL;

      if (hitStop) {
        const qty = CURRENT_POSITION.qty;
        const profit = isLong
          ? (SL - CURRENT_POSITION.price) * qty
          : (CURRENT_POSITION.price - SL) * qty;

        AMOUNT += profit;
        updateMinAmount();

        ORDER_LOG.push({
          ...CURRENT_POSITION,
          timestamp: candle.timestamp,
          qty,
          profit,
          price: SL,
          type: isLong ? 'STOP_LOSS_LONG' : 'STOP_LOSS_SHORT',
          index: ORDER_LOG.length,
        });

        clearPosition();

        return;
      }
    },

    placeOrder: async (order, tp = [], sl) => {
      if (CURRENT_POSITION) {
        return false;
      }

      const isLong = order.direction === 'LONG';

      let slPrice = null;

      if (sl) {
        slPrice = isLong ? order.price * (1 - sl) : order.price * (1 + sl);
      }

      TP = _.cloneDeep(tp);
      SL = slPrice || null;
      CURRENT_POSITION = { ...order };
      ORIGINAL_QTY = order.qty;

      const profit = order.price * order.qty * FEE * -1;

      AMOUNT += profit;
      updateMinAmount();

      ORDER_LOG.push({
        ...order,
        profit,
        type: isLong ? 'OPEN_LONG' : 'OPEN_SHORT',
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

      clearPosition();

      return true;
    },

    getTickers: async () => [],
  };
};
