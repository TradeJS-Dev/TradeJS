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
import { TTL_3M } from '@constants';
import { uuid } from '@utils/uuid';
import { round } from '@utils/math';

const FEE = 0.005;
const INITIAL_AMOUNT = 100;

export const TestConnectorCreator: TCC = (connector, context) => {
  const userName = context?.userName;
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

  const saveMlResult = async (data: {
    outcome: 'TAKE_PROFIT' | 'STOP_LOSS' | 'CLOSE';
    timestamp: number;
    price: number;
    profit: number;
  }) => {
    const signalId = CURRENT_POSITION?.signal?.signalId;
    const strategyName = CURRENT_POSITION?.signal?.strategy;
    if (!signalId || !CURRENT_POSITION) {
      return;
    }
    if (!strategyName) {
      return;
    }

    await setData(
      redisKeys.mlResult(strategyName, signalId),
      {
        signalId,
        symbol: CURRENT_POSITION.symbol,
        direction: CURRENT_POSITION.direction,
        entryTimestamp: CURRENT_POSITION.timestamp,
        entryPrice: CURRENT_POSITION.price,
        closeTimestamp: data.timestamp,
        closePrice: data.price,
        outcome: data.outcome,
        profit: data.profit,
        result: data.profit >= 0 ? 'WIN' : 'LOSS',
      },
      {
        stringify: true,
        expire: TTL_3M,
      },
    );
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
      const orderLogId = uuid();

      if (!userName) {
        throw new Error('Missing userName for test cache');
      }

      await setData(redisKeys.cacheOrders(userName, orderLogId), ORDER_LOG);
      await setData(
        redisKeys.cachePositions(userName, orderLogId),
        POSITION_LOG,
      );

      return {
        stat: {
          amount: AMOUNT,
          profit: AMOUNT - INITIAL_AMOUNT,
          orders: POSITION_LOG.length,
        },
        orderLogId,
      };
    },

    getPosition: async () => CURRENT_POSITION || null,

    checkTp: async (candle: Candle) => {
      if (_.isEmpty(candle) || !CURRENT_POSITION || !CURRENT_POSITION.qty) {
        return;
      }

      const isLong = CURRENT_POSITION.direction === 'LONG';
      const entryPrice = CURRENT_POSITION.price;
      let lastTpPrice: number | null = null;
      let lastTpProfit = 0;

      const high = candle.high;
      const low = candle.low;

      for (const tp of TP) {
        if (!CURRENT_POSITION || CURRENT_POSITION.qty <= 0) break;

        const targetPrice = tp.price;

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
          lastTpPrice = targetPrice;
          lastTpProfit = profit;
        }
      }

      TP = TP.filter(({ done }) => !done);

      if (CURRENT_POSITION && CURRENT_POSITION.qty <= 0) {
        await saveMlResult({
          outcome: 'TAKE_PROFIT',
          timestamp: candle.timestamp,
          price: lastTpPrice ?? entryPrice,
          profit: lastTpProfit,
        });
        clearPosition(candle.timestamp);
      }
    },

    checkSl: async (candle: Candle) => {
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

        await saveMlResult({
          outcome: 'STOP_LOSS',
          timestamp: candle.timestamp,
          price: SL,
          profit,
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

      await saveMlResult({
        outcome: 'CLOSE',
        timestamp: order.timestamp,
        price: order.price,
        profit,
      });
      clearPosition(order.timestamp);

      return true;
    },

    getTickers: connector.getTickers,
    getPositions: connector.getPositions,
  };
};
