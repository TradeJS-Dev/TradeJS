import { randomUUID } from 'node:crypto';
import { FEE_PERCENT, INITIAL_BACKTEST_AMOUNT } from '@tradejs/core/constants';
import { calculateStatsFull } from '@tradejs/core/backtest';
import {
  applyExecutionSlippage as applyModeledExecutionSlippage,
  extractExecutionMarketImpactBps,
  extractExecutionSpreadBps,
} from '@tradejs/core/trade';
import {
  Candle,
  Sl,
  Tp,
  Order,
  OrderLog,
  OrderLogData,
  PositionPnlSnapshot,
  PositionLogData,
  TestClosedSignalResult,
  TestConnectorCreator,
  TestTradeExitReason,
  TestTradeResult,
} from '@tradejs/types';
import { round } from '@tradejs/core/math';

type OpenTradeResult = Omit<
  TestTradeResult,
  | 'exitTimestamp'
  | 'exitReason'
  | 'requestedExitPrice'
  | 'exitPrice'
  | 'exitSlippagePrice'
  | 'exitSlippageBps'
> & {
  exitTimestamp: number | null;
  exitReason: TestTradeExitReason | null;
  requestedExitPrice: number | null;
  exitPrice: number | null;
  exitSlippagePrice: number | null;
  exitSlippageBps: number | null;
};

export const createTestConnector: TestConnectorCreator = (
  connector,
  context,
) => {
  let state = {};
  const orderLog: OrderLogData = [];
  const positionLog: PositionLogData = [];
  const fastMode = Boolean(context?.fastMode);
  let currentPosition: (Order & { amount: number }) | null = null;
  let amount = INITIAL_BACKTEST_AMOUNT;
  let originalQty = 0;
  let currentPositionProfit = 0;
  let currentSignalId: string | null = null;
  let takeProfits: Tp[] = [];
  let stopLossPrice: Sl = null;
  let currentTradeResult: OpenTradeResult | null = null;
  const closedSignalResults: TestClosedSignalResult[] = [];

  const logOrder = (data: Partial<OrderLog>) => {
    const nextEntry = {
      ...(currentPosition || {}),
      ...data,
      amount: round(amount),
      profit: round(data.profit || 0),
      index: orderLog.length,
    } as OrderLog;

    if (nextEntry.signal) {
      const {
        additionalIndicators: _additionalIndicators,
        indicators: _indicators,
        ...signalWithoutHeavyContext
      } = nextEntry.signal as unknown as Record<string, unknown>;
      nextEntry.signal = signalWithoutHeavyContext as any;
    }

    if (!fastMode) {
      orderLog.push(nextEntry);
    }
  };

  const roundNullable = (value: number | null) =>
    value == null ? null : round(value);

  const getSlippageCost = ({
    requestedPrice,
    executionPrice,
    direction,
    stage,
    qty,
  }: {
    requestedPrice: number;
    executionPrice: number;
    direction: 'LONG' | 'SHORT';
    stage: 'entry' | 'exit';
    qty: number;
  }) => {
    if (direction === 'LONG') {
      return stage === 'entry'
        ? Math.max(0, executionPrice - requestedPrice) * qty
        : Math.max(0, requestedPrice - executionPrice) * qty;
    }

    return stage === 'entry'
      ? Math.max(0, requestedPrice - executionPrice) * qty
      : Math.max(0, executionPrice - requestedPrice) * qty;
  };

  const getSlippageBps = (requestedPrice: number, executionPrice: number) =>
    requestedPrice
      ? ((executionPrice - requestedPrice) / requestedPrice) * 10_000
      : 0;

  const getWeightedAverage = (
    previousValue: number | null,
    previousQty: number,
    nextValue: number,
    nextQty: number,
  ) => {
    if (previousValue == null || previousQty <= 0) {
      return nextValue;
    }

    return (
      (previousValue * previousQty + nextValue * nextQty) /
      (previousQty + nextQty)
    );
  };

  const finalizeTradeResult = (
    tradeResult: OpenTradeResult,
    timestamp: number,
  ): TestTradeResult | undefined => {
    if (!tradeResult.exitReason) {
      return undefined;
    }

    return {
      ...tradeResult,
      exitTimestamp: tradeResult.exitTimestamp ?? timestamp,
      exitReason: tradeResult.exitReason,
      requestedEntryPrice: round(tradeResult.requestedEntryPrice),
      entryPrice: round(tradeResult.entryPrice),
      requestedExitPrice: roundNullable(tradeResult.requestedExitPrice),
      exitPrice: roundNullable(tradeResult.exitPrice),
      grossProfit: round(tradeResult.grossProfit),
      netProfit: round(tradeResult.netProfit),
      openFee: round(tradeResult.openFee),
      closeFee: round(tradeResult.closeFee),
      fundingFee: roundNullable(tradeResult.fundingFee),
      totalFee: round(tradeResult.totalFee),
      entrySlippagePrice: round(tradeResult.entrySlippagePrice),
      entrySlippageBps: round(tradeResult.entrySlippageBps),
      entrySlippageCost: round(tradeResult.entrySlippageCost),
      exitSlippagePrice: roundNullable(tradeResult.exitSlippagePrice),
      exitSlippageBps: roundNullable(tradeResult.exitSlippageBps),
      exitSlippageCost: round(tradeResult.exitSlippageCost),
      totalSlippageCost: round(tradeResult.totalSlippageCost),
      qty: round(tradeResult.qty),
      closedQty: round(tradeResult.closedQty),
    };
  };

  const recordExitResult = ({
    timestamp,
    reason,
    requestedPrice,
    executionPrice,
    qty,
    grossProfit,
    fee,
  }: {
    timestamp: number;
    reason: TestTradeExitReason;
    requestedPrice: number;
    executionPrice: number;
    qty: number;
    grossProfit: number;
    fee: number;
  }) => {
    if (!currentTradeResult || !currentPosition) {
      return;
    }

    const previousClosedQty = currentTradeResult.closedQty;
    const requestedExitPrice = getWeightedAverage(
      currentTradeResult.requestedExitPrice,
      previousClosedQty,
      requestedPrice,
      qty,
    );
    const exitPrice = getWeightedAverage(
      currentTradeResult.exitPrice,
      previousClosedQty,
      executionPrice,
      qty,
    );
    const exitSlippageCost =
      currentTradeResult.exitSlippageCost +
      getSlippageCost({
        requestedPrice,
        executionPrice,
        direction: currentPosition.direction,
        stage: 'exit',
        qty,
      });

    currentTradeResult = {
      ...currentTradeResult,
      closedQty: previousClosedQty + qty,
      exitTimestamp: timestamp,
      exitReason: reason,
      requestedExitPrice,
      exitPrice,
      grossProfit: currentTradeResult.grossProfit + grossProfit,
      netProfit: currentTradeResult.netProfit + grossProfit - fee,
      closeFee: currentTradeResult.closeFee + fee,
      totalFee:
        currentTradeResult.openFee +
        currentTradeResult.closeFee +
        fee +
        (currentTradeResult.fundingFee ?? 0),
      exitSlippagePrice: exitPrice - requestedExitPrice,
      exitSlippageBps: getSlippageBps(requestedExitPrice, exitPrice),
      exitSlippageCost,
      totalSlippageCost:
        currentTradeResult.entrySlippageCost + exitSlippageCost,
    };
  };

  const clearPosition = (timestamp: number) => {
    takeProfits = [];
    stopLossPrice = null;
    originalQty = 0;

    if (!currentPosition) {
      return;
    }

    if (context?.mlEnabled || context?.aiEnabled) {
      if (currentSignalId) {
        const tradeResult = currentTradeResult
          ? finalizeTradeResult(currentTradeResult, timestamp)
          : undefined;
        closedSignalResults.push({
          signalId: currentSignalId,
          profit: round(currentPositionProfit),
          ...(tradeResult ? { tradeResult } : {}),
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
    currentSignalId = null;
    currentTradeResult = null;
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

  const applyExecutionSlippage = ({
    price,
    direction,
    stage,
    signal,
  }: {
    price: number;
    direction: 'LONG' | 'SHORT';
    stage: 'entry' | 'exit';
    signal?: Order['signal'];
  }) => {
    return applyModeledExecutionSlippage({
      price,
      direction,
      stage,
      spreadBps: extractExecutionSpreadBps(signal),
      marketImpactBps: extractExecutionMarketImpactBps(signal),
    });
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
      const fullStat = fastMode ? calculateStatsFull(positionLog) : null;

      return {
        stat: fullStat
          ? ({
              ...fullStat,
              profit: fullStat.netProfit,
            } as typeof fullStat & { profit: number })
          : {
              amount: round(amount),
              profit: round(amount - INITIAL_BACKTEST_AMOUNT),
              orders: positionLog.length,
            },
        orderLogId,
        ...(fastMode
          ? {}
          : {
              inlineOrderLog: orderLog,
              inlinePositionLog: positionLog,
            }),
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
          const executionPrice = applyExecutionSlippage({
            price: targetPrice,
            direction: currentPosition.direction,
            stage: 'exit',
            signal: currentPosition.signal,
          });
          const grossProfit = isLong
            ? (executionPrice - entryPrice) * qty
            : (entryPrice - executionPrice) * qty;
          const { fee, profit } = getNetProfit({
            grossProfit,
            price: executionPrice,
            qty,
          });
          recordExitResult({
            timestamp: candle.timestamp,
            reason: 'take_profit',
            requestedPrice: targetPrice,
            executionPrice,
            qty,
            grossProfit,
            fee,
          });

          amount += profit;
          currentPositionProfit += profit;

          currentPosition.qty = parseFloat(
            (currentPosition.qty - qty).toFixed(8),
          );

          logOrder({
            timestamp: candle.timestamp,
            qty,
            price: executionPrice,
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
        const executionPrice = applyExecutionSlippage({
          price: stopLossPrice,
          direction: currentPosition.direction,
          stage: 'exit',
          signal: currentPosition.signal,
        });
        const grossProfit = isLong
          ? (executionPrice - currentPosition.price) * qty
          : (currentPosition.price - executionPrice) * qty;
        const { fee, profit } = getNetProfit({
          grossProfit,
          price: executionPrice,
          qty,
        });
        recordExitResult({
          timestamp: candle.timestamp,
          reason: 'stop_loss',
          requestedPrice: stopLossPrice,
          executionPrice,
          qty,
          grossProfit,
          fee,
        });

        amount += profit;
        currentPositionProfit += profit;

        logOrder({
          timestamp: candle.timestamp,
          qty,
          profit,
          price: executionPrice,
          fee,
          type: isLong ? 'STOP_LOSS_LONG' : 'STOP_LOSS_SHORT',
        });

        clearPosition(candle.timestamp);
      }
    },

    checkExits: async (candle: Candle) => {
      if (!candle || !currentPosition) {
        return;
      }

      if (stopLossPrice) {
        const isLong = currentPosition.direction === 'LONG';
        const hitStop = isLong
          ? candle.low <= stopLossPrice
          : candle.high >= stopLossPrice;

        if (hitStop) {
          const qty = currentPosition.qty;
          const executionPrice = applyExecutionSlippage({
            price: stopLossPrice,
            direction: currentPosition.direction,
            stage: 'exit',
            signal: currentPosition.signal,
          });
          const grossProfit = isLong
            ? (executionPrice - currentPosition.price) * qty
            : (currentPosition.price - executionPrice) * qty;
          const { fee, profit } = getNetProfit({
            grossProfit,
            price: executionPrice,
            qty,
          });
          recordExitResult({
            timestamp: candle.timestamp,
            reason: 'stop_loss',
            requestedPrice: stopLossPrice,
            executionPrice,
            qty,
            grossProfit,
            fee,
          });

          amount += profit;
          currentPositionProfit += profit;

          logOrder({
            timestamp: candle.timestamp,
            qty,
            profit,
            price: executionPrice,
            fee,
            type: isLong ? 'STOP_LOSS_LONG' : 'STOP_LOSS_SHORT',
          });

          clearPosition(candle.timestamp);
        }
      }

      if (!currentPosition || !currentPosition.qty) {
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
          const executionPrice = applyExecutionSlippage({
            price: targetPrice,
            direction: currentPosition.direction,
            stage: 'exit',
            signal: currentPosition.signal,
          });
          const grossProfit = isLong
            ? (executionPrice - entryPrice) * qty
            : (entryPrice - executionPrice) * qty;
          const { fee, profit } = getNetProfit({
            grossProfit,
            price: executionPrice,
            qty,
          });
          recordExitResult({
            timestamp: candle.timestamp,
            reason: 'take_profit',
            requestedPrice: targetPrice,
            executionPrice,
            qty,
            grossProfit,
            fee,
          });

          amount += profit;
          currentPositionProfit += profit;

          currentPosition.qty = parseFloat(
            (currentPosition.qty - qty).toFixed(8),
          );

          logOrder({
            timestamp: candle.timestamp,
            qty,
            price: executionPrice,
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

    placeOrder: async (order) => {
      if (currentPosition) {
        return false;
      }

      const isLong = order.direction === 'LONG';

      const entryPrice = applyExecutionSlippage({
        price: order.price,
        direction: order.direction,
        stage: 'entry',
        signal: order.signal,
      });
      currentPosition = { ...order, price: entryPrice, amount };
      currentSignalId =
        typeof order.signal?.signalId === 'string' && order.signal.signalId
          ? order.signal.signalId
          : null;
      originalQty = order.qty;

      const { fee, profit } = getNetProfit({
        grossProfit: 0,
        price: entryPrice,
        qty: order.qty,
      });
      const entrySlippageCost = getSlippageCost({
        requestedPrice: order.price,
        executionPrice: entryPrice,
        direction: order.direction,
        stage: 'entry',
        qty: order.qty,
      });

      amount += profit;
      currentPositionProfit = profit;
      currentTradeResult = currentSignalId
        ? {
            signalId: currentSignalId,
            direction: order.direction,
            qty: order.qty,
            closedQty: 0,
            entryTimestamp: order.timestamp,
            exitTimestamp: null,
            exitReason: null,
            requestedEntryPrice: order.price,
            entryPrice,
            requestedExitPrice: null,
            exitPrice: null,
            grossProfit: 0,
            netProfit: profit,
            openFee: fee,
            closeFee: 0,
            fundingFee: null,
            totalFee: fee,
            entrySlippagePrice: entryPrice - order.price,
            entrySlippageBps: getSlippageBps(order.price, entryPrice),
            entrySlippageCost,
            exitSlippagePrice: null,
            exitSlippageBps: null,
            exitSlippageCost: 0,
            totalSlippageCost: entrySlippageCost,
          }
        : null;

      logOrder({
        ...order,
        price: entryPrice,
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
      const executionPrice = applyExecutionSlippage({
        price: order.price,
        direction: currentPosition.direction,
        stage: 'exit',
        signal: currentPosition.signal,
      });
      const grossProfit = isLong
        ? (executionPrice - currentPosition.price) * currentPosition.qty
        : (currentPosition.price - executionPrice) * currentPosition.qty;
      const { fee, profit } = getNetProfit({
        grossProfit,
        price: executionPrice,
        qty: currentPosition.qty,
      });
      recordExitResult({
        timestamp: order.timestamp,
        reason: 'exit',
        requestedPrice: order.price,
        executionPrice,
        qty: currentPosition.qty,
        grossProfit,
        fee,
      });

      amount += profit;
      currentPositionProfit += profit;

      logOrder({
        ...order,
        price: executionPrice,
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
