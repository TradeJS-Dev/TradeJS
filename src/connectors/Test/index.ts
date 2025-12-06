'use server';

import _ from 'lodash';
import {
  TestConnectorCreator as TCC,
  Kline,
  Order,
  OrderLog,
  OrderLogData,
  PositionLogData,
  Sl,
  Tp,
  Candle,
} from '@types';
import { redisKeys, setData } from '@utils/redis';
import { uuid } from '@utils/uuid';
import { round } from '@utils/math';

const FEE = 0.005;

export const TestConnectorCreator: TCC = (connector) => {
  let state = {};
  const ORDER_LOG: OrderLogData = [];
  const POSITION_LOG: PositionLogData = [];
  let CURRENT_POSITION: (Order & { amount: number }) | null = null;
  let AMOUNT = 100;
  let ORIGINAL_QTY = 0;
  let TP: Tp[] = [];
  let SL: Sl = null;

  const kline: Kline = async (options) => {
    return await connector.kline(options);
  };

  const log = (data: Partial<OrderLog>) => {
    ORDER_LOG.push({
      ...(CURRENT_POSITION || {}),
      ...data,
      amount: round(AMOUNT),
      profit: round(data.profit || 0),
      index: ORDER_LOG.length,
    } as OrderLog);
  };

  const clearPosition = (timestamp: number) => {
    TP = [];
    SL = null;
    ORIGINAL_QTY = 0;

    if (!CURRENT_POSITION) {
      return;
    }

    POSITION_LOG.push({
      direction: CURRENT_POSITION.direction,
      open: {
        timestamp: CURRENT_POSITION.timestamp,
        amount: round(CURRENT_POSITION.amount),
      },
      close: {
        timestamp,
        amount: round(AMOUNT),
      },
    });

    CURRENT_POSITION = null;
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

    kline,

    getResult: async () => {
      if (ORDER_LOG.length < 1) {
        throw Error('Order log is empty');
      }

      const orderLogId = uuid();

      await setData(redisKeys.cacheOrders(orderLogId), ORDER_LOG);
      await setData(redisKeys.cachePositions(orderLogId), POSITION_LOG);

      return {
        stat: {
          amount: AMOUNT,
        },
        orderLogId,
      };
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

        let targetPrice = tp.price;

        if (!targetPrice) {
          if (!tp.profit) {
            continue;
          }

          targetPrice = isLong
            ? entryPrice * (1 + tp.profit)
            : entryPrice * (1 - tp.profit);
        }

        const reached = isLong ? high >= targetPrice : low <= targetPrice;

        if (reached) {
          const qty = ORIGINAL_QTY * tp.rate;
          const profit = isLong
            ? (targetPrice - entryPrice) * qty
            : (entryPrice - targetPrice) * qty;

          AMOUNT += profit;

          CURRENT_POSITION.qty = parseFloat(
            (CURRENT_POSITION.qty - qty).toFixed(8),
          );

          log({
            timestamp: candle.timestamp,
            qty,
            price: targetPrice,
            profit,
            type: isLong ? 'TAKE_PROFIT_LONG' : 'TAKE_PROFIT_SHORT',
          });

          tp.done = true;
        }
      }

      TP = TP.filter(({ done }) => !done);

      if (CURRENT_POSITION && CURRENT_POSITION.qty <= 0) {
        clearPosition(candle.timestamp);
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

        log({
          timestamp: candle.timestamp,
          qty,
          profit,
          price: SL,
          type: isLong ? 'STOP_LOSS_LONG' : 'STOP_LOSS_SHORT',
        });

        clearPosition(candle.timestamp);

        return;
      }
    },

    placeOrder: async (order, tp = [], slPrice) => {
      if (CURRENT_POSITION) {
        return false;
      }

      const isLong = order.direction === 'LONG';

      TP = _.cloneDeep(tp);
      SL = slPrice || null;
      CURRENT_POSITION = { ...order, amount: AMOUNT };
      ORIGINAL_QTY = order.qty;

      const fee = order.price * order.qty * FEE;
      const profit = fee * -1;

      AMOUNT += profit;

      log({
        ...order,
        profit,
        fee,
        type: isLong ? 'OPEN_LONG' : 'OPEN_SHORT',
      });

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

      log({
        ...order,
        qty: CURRENT_POSITION.qty,
        profit,
        type: isLong ? 'CLOSE_LONG' : 'CLOSE_SHORT',
      });

      clearPosition(order.timestamp);

      return true;
    },

    getTickers: connector.getTickers,
    getPositions: connector.getPositions,
  };
};
