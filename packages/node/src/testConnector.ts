import { randomUUID } from 'node:crypto';
import _ from 'lodash';
import {
  Candle,
  Sl,
  Tp,
  Order,
  OrderLog,
  OrderLogData,
  PositionLogData,
  TestConnectorCreator,
} from '@tradejs/types';
import { TTL_1D } from '@tradejs/core/constants';
import { round } from '@tradejs/core/math';
import { redisKeys, setData } from '@tradejs/infra/redis';

const FEE = 0.005;
const INITIAL_AMOUNT = 100;

export const createTestConnector: TestConnectorCreator = (
  connector,
  context,
) => {
  const userName = context?.userName;
  let state = {};
  const orderLog: OrderLogData = [];
  const positionLog: PositionLogData = [];
  let currentPosition: (Order & { amount: number }) | null = null;
  let amount = INITIAL_AMOUNT;
  let originalQty = 0;
  let currentPositionProfit = 0;
  let takeProfits: Tp[] = [];
  let stopLossPrice: Sl = null;
  const closedSignalResults: Array<{ signalId: string; profit: number }> = [];

  const logOrder = (data: Partial<OrderLog>) => {
    const nextEntry = {
      ...(currentPosition || {}),
      ...data,
      amount: round(amount),
      profit: round(data.profit || 0),
      index: orderLog.length,
    } as OrderLog;

    if (nextEntry.signal) {
      nextEntry.signal = _.omit(nextEntry.signal, 'indicators') as any;
    }

    orderLog.push(nextEntry);
  };

  const clearPosition = (timestamp: number) => {
    takeProfits = [];
    stopLossPrice = null;
    originalQty = 0;

    if (!currentPosition) {
      return;
    }

    if (context?.mlEnabled || context?.aiEnabled) {
      const signalId = currentPosition.signal?.signalId;
      if (signalId) {
        closedSignalResults.push({
          signalId,
          profit: currentPositionProfit,
        });
      }
    }

    positionLog.push({
      direction: currentPosition.direction,
      open: {
        timestamp: currentPosition.timestamp,
        amount: round(currentPosition.amount),
      },
      close: {
        timestamp,
        amount: round(amount),
      },
    });

    currentPosition = null;
    currentPositionProfit = 0;
  };

  return {
    getState: async () => state,
    setState: async (newState: object) => {
      state = {
        ...state,
        ...newState,
      };
    },

    kline: async (options) => connector.kline(options),

    getResult: async () => {
      const orderLogId = randomUUID().slice(-12);
      const cacheUserName = userName || 'root';

      await setData(
        redisKeys.cacheOrders(cacheUserName, orderLogId),
        orderLog,
        {
          expire: TTL_1D,
        },
      );
      await setData(
        redisKeys.cachePositions(cacheUserName, orderLogId),
        positionLog,
        {
          expire: TTL_1D,
        },
      );

      return {
        stat: {
          amount,
          profit: amount - INITIAL_AMOUNT,
          orders: positionLog.length,
        },
        orderLogId,
      };
    },

    getPosition: async () => currentPosition || null,

    checkTp: async (candle: Candle) => {
      if (_.isEmpty(candle) || !currentPosition || !currentPosition.qty) {
        return;
      }

      const isLong = currentPosition.direction === 'LONG';
      const entryPrice = currentPosition.price;

      const high = candle.high;
      const low = candle.low;

      for (const tp of takeProfits) {
        if (!currentPosition || currentPosition.qty <= 0) break;

        const targetPrice = tp.price;
        const reached = isLong ? high >= targetPrice : low <= targetPrice;

        if (reached) {
          const qty = originalQty * tp.rate;
          const profit = isLong
            ? (targetPrice - entryPrice) * qty
            : (entryPrice - targetPrice) * qty;

          amount += profit;
          currentPositionProfit += profit;

          currentPosition.qty = parseFloat(
            (currentPosition.qty - qty).toFixed(8),
          );

          logOrder({
            timestamp: candle.timestamp,
            qty,
            price: targetPrice,
            profit,
            type: isLong ? 'TAKE_PROFIT_LONG' : 'TAKE_PROFIT_SHORT',
          });

          tp.done = true;
        }
      }

      takeProfits = takeProfits.filter(({ done }) => !done);

      if (currentPosition && currentPosition.qty <= 0) {
        clearPosition(candle.timestamp);
      }
    },

    checkSl: async (candle: Candle) => {
      if (!stopLossPrice || !currentPosition || _.isEmpty(candle)) {
        return;
      }

      const isLong = currentPosition.direction === 'LONG';
      const hitStop = isLong
        ? candle.low <= stopLossPrice
        : candle.high >= stopLossPrice;

      if (hitStop) {
        const qty = currentPosition.qty;
        const profit = isLong
          ? (stopLossPrice - currentPosition.price) * qty
          : (currentPosition.price - stopLossPrice) * qty;

        amount += profit;
        currentPositionProfit += profit;

        logOrder({
          timestamp: candle.timestamp,
          qty,
          profit,
          price: stopLossPrice,
          type: isLong ? 'STOP_LOSS_LONG' : 'STOP_LOSS_SHORT',
        });

        clearPosition(candle.timestamp);
      }
    },

    placeOrder: async (order) => {
      if (currentPosition) {
        return false;
      }

      const isLong = order.direction === 'LONG';

      currentPosition = { ...order, amount };
      originalQty = order.qty;

      const fee = order.price * order.qty * FEE;
      const profit = fee * -1;

      amount += profit;
      currentPositionProfit = profit;

      logOrder({
        ...order,
        profit,
        fee,
        type: isLong ? 'OPEN_LONG' : 'OPEN_SHORT',
      });

      return true;
    },

    setTakeProfits: async ({ takeProfits: nextTakeProfits }) => {
      if (!currentPosition) {
        return false;
      }

      takeProfits = _.cloneDeep(nextTakeProfits);
      return true;
    },

    setStopLoss: async ({ stopLossPrice: nextStopLossPrice }) => {
      if (!currentPosition) {
        return false;
      }

      stopLossPrice = nextStopLossPrice || null;
      return true;
    },

    closePosition: async (order) => {
      if (!currentPosition) {
        return false;
      }

      const isLong = currentPosition.direction === 'LONG';
      const profit = isLong
        ? (order.price - currentPosition.price) * currentPosition.qty
        : (currentPosition.price - order.price) * currentPosition.qty;

      amount += profit;
      currentPositionProfit += profit;

      logOrder({
        ...order,
        qty: currentPosition.qty,
        profit,
        type: isLong ? 'CLOSE_LONG' : 'CLOSE_SHORT',
      });

      clearPosition(order.timestamp);

      return true;
    },

    getTickers: connector.getTickers,
    getPositions: connector.getPositions,
    drainMlResultsBatch: async () => closedSignalResults.splice(0),
  };
};
