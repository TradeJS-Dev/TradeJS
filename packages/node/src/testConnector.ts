import { randomUUID } from 'node:crypto';
import { FEE_PERCENT, INITIAL_BACKTEST_AMOUNT } from '@tradejs/core/constants';
import {
  Candle,
  Sl,
  Tp,
  Order,
  OrderLog,
  OrderLogData,
  PositionPnlSnapshot,
  PositionLogData,
  TestConnectorCreator,
} from '@tradejs/types';
import { round } from '@tradejs/core/math';

export const createTestConnector: TestConnectorCreator = (
  connector,
  context,
) => {
  let state = {};
  const orderLog: OrderLogData = [];
  const positionLog: PositionLogData = [];
  let currentPosition: (Order & { amount: number }) | null = null;
  let amount = INITIAL_BACKTEST_AMOUNT;
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
      const { indicators: _indicators, ...signalWithoutIndicators } =
        nextEntry.signal as unknown as Record<string, unknown>;
      nextEntry.signal = signalWithoutIndicators as any;
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
          profit: round(currentPositionProfit),
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

  const getNetProfit = ({
    grossProfit,
    price,
    qty,
  }: {
    grossProfit: number;
    price: number;
    qty: number;
  }) => {
    const fee = price * qty * FEE_PERCENT;
    return {
      fee,
      profit: grossProfit - fee,
    };
  };

  return {
    __tradejsTestConnector: true,

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

      return {
        stat: {
          amount: round(amount),
          profit: round(amount - INITIAL_BACKTEST_AMOUNT),
          orders: positionLog.length,
        },
        orderLogId,
        inlineOrderLog: orderLog,
        inlinePositionLog: positionLog,
      };
    },

    getPosition: async () => currentPosition || null,

    getOpenPositionPnl: async () => {
      if (typeof connector.getOpenPositionPnl === 'function') {
        return connector.getOpenPositionPnl();
      }

      if (!currentPosition) {
        return [];
      }

      return [
        {
          symbol: currentPosition.symbol,
          qty: currentPosition.qty,
          price: currentPosition.price,
          currentPrice: currentPosition.price,
          unrealizedPnl: 0,
          direction: currentPosition.direction,
        } satisfies PositionPnlSnapshot,
      ];
    },

    checkTp: async (candle: Candle) => {
      if (!candle || !currentPosition || !currentPosition.qty) {
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
          const grossProfit = isLong
            ? (targetPrice - entryPrice) * qty
            : (entryPrice - targetPrice) * qty;
          const { fee, profit } = getNetProfit({
            grossProfit,
            price: targetPrice,
            qty,
          });

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
            fee,
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
      if (!stopLossPrice || !currentPosition || !candle) {
        return;
      }

      const isLong = currentPosition.direction === 'LONG';
      const hitStop = isLong
        ? candle.low <= stopLossPrice
        : candle.high >= stopLossPrice;

      if (hitStop) {
        const qty = currentPosition.qty;
        const grossProfit = isLong
          ? (stopLossPrice - currentPosition.price) * qty
          : (currentPosition.price - stopLossPrice) * qty;
        const { fee, profit } = getNetProfit({
          grossProfit,
          price: stopLossPrice,
          qty,
        });

        amount += profit;
        currentPositionProfit += profit;

        logOrder({
          timestamp: candle.timestamp,
          qty,
          profit,
          price: stopLossPrice,
          fee,
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

      const { fee, profit } = getNetProfit({
        grossProfit: 0,
        price: order.price,
        qty: order.qty,
      });

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

      takeProfits = Array.isArray(nextTakeProfits)
        ? nextTakeProfits.map((tp) => ({ ...tp }))
        : [];
      return true;
    },

    setStopLoss: async ({ stopLossPrice: nextStopLossPrice }) => {
      if (!currentPosition) {
        return false;
      }

      stopLossPrice = nextStopLossPrice || null;
      currentPosition = {
        ...currentPosition,
        ...(stopLossPrice != null ? { slPrice: stopLossPrice } : {}),
      };
      return true;
    },

    closePosition: async (order) => {
      if (!currentPosition) {
        return false;
      }

      const isLong = currentPosition.direction === 'LONG';
      const grossProfit = isLong
        ? (order.price - currentPosition.price) * currentPosition.qty
        : (currentPosition.price - order.price) * currentPosition.qty;
      const { fee, profit } = getNetProfit({
        grossProfit,
        price: order.price,
        qty: currentPosition.qty,
      });

      amount += profit;
      currentPositionProfit += profit;

      logOrder({
        ...order,
        qty: currentPosition.qty,
        profit,
        fee,
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
