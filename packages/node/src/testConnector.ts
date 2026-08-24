import { randomUUID } from 'node:crypto';
import { FEE_PERCENT, INITIAL_BACKTEST_AMOUNT } from '@tradejs/core/constants';
import { calculateStatsFull } from '@tradejs/core/backtest';
import {
  applyExecutionSlippage as applyModeledExecutionSlippage,
  calculateExecutionSlippageBreakdown,
  extractExecutionMarketImpactBps,
  extractExecutionSpreadBps,
  extractExecutionDelayRiskBps,
} from '@tradejs/core/trade';
import {
  Candle,
  InstrumentDescriptor,
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

const PRICE_PRECISION = 8;
type ExecutionSlippageBreakdown = ReturnType<
  typeof calculateExecutionSlippageBreakdown
>;

const normalizeInstrumentOrderQty = ({
  qty,
  symbol,
  instrument,
}: {
  qty: number;
  symbol: string;
  instrument?: InstrumentDescriptor;
}) => {
  if (
    !instrument ||
    instrument.symbol.trim().toUpperCase() !== symbol.trim().toUpperCase()
  ) {
    return { qty, minOrderQty: null };
  }

  const qtyStep = Number(instrument.venueMetadata?.qtyStep);
  const minOrderQty = Number(instrument.venueMetadata?.minOrderQty);
  const normalizedQty =
    Number.isFinite(qtyStep) && qtyStep > 0
      ? Number((Math.floor(qty / qtyStep) * qtyStep).toFixed(12))
      : qty;

  return {
    qty: normalizedQty,
    minOrderQty:
      Number.isFinite(minOrderQty) && minOrderQty > 0 ? minOrderQty : null,
  };
};

export const createTestConnector: TestConnectorCreator = (
  connector,
  context,
) => {
  let state = {};
  const orderLog: OrderLogData = [];
  const positionLog: PositionLogData = [];
  const fastMode = Boolean(context?.fastMode);
  const executionCostModel = context?.executionCostModel;
  const makerFeeRate = executionCostModel?.fees.makerRate ?? FEE_PERCENT;
  const takerFeeRate = executionCostModel?.fees.takerRate ?? FEE_PERCENT;
  const fundingRates = [...(context?.fundingRates ?? [])].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
  const processedFundingTimestamps = new Set<number>();
  let currentPosition:
    | (Order & { amount: number; slPrice?: number; tpPrice?: number })
    | null = null;
  let amount = INITIAL_BACKTEST_AMOUNT;
  let originalQty = 0;
  let currentPositionProfit = 0;
  let currentSignalId: string | null = null;
  let takeProfits: Tp[] = [];
  let stopLossPrice: Sl = null;
  let currentTradeResult: OpenTradeResult | null = null;
  let currentEntryLegResults: OpenTradeResult[] = [];
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
  const roundPrice = (value: number) => round(value, PRICE_PRECISION);
  const roundNullablePrice = (value: number | null) =>
    value == null ? null : roundPrice(value);

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

  const createOpenTradeResult = ({
    signalId,
    positionCycleId,
    direction,
    qty,
    timestamp,
    requestedEntryPrice,
    entryPrice,
    fee,
    slippageBreakdown,
    entrySlippageCost,
  }: {
    signalId: string;
    positionCycleId: string;
    direction: 'LONG' | 'SHORT';
    qty: number;
    timestamp: number;
    requestedEntryPrice: number;
    entryPrice: number;
    fee: number;
    slippageBreakdown: ExecutionSlippageBreakdown;
    entrySlippageCost: number;
  }): OpenTradeResult => ({
    signalId,
    positionCycleId,
    direction,
    qty,
    closedQty: 0,
    entryTimestamp: timestamp,
    exitTimestamp: null,
    exitReason: null,
    requestedEntryPrice,
    entryPrice,
    requestedExitPrice: null,
    exitPrice: null,
    grossProfit: 0,
    netProfit: -fee,
    openFee: fee,
    closeFee: 0,
    fundingFee: executionCostModel?.funding.enabled ? 0 : null,
    totalFee: fee,
    entrySlippagePrice: entryPrice - requestedEntryPrice,
    entrySlippageBps: getSlippageBps(requestedEntryPrice, entryPrice),
    entryBaseSlippageBps: slippageBreakdown.baseSlippageBps,
    entrySpreadBps: slippageBreakdown.spreadBps,
    entrySpreadSlippageBps: slippageBreakdown.spreadSlippageBps,
    entryMarketImpactBps: slippageBreakdown.marketImpactBps,
    entryDelayRiskBps: slippageBreakdown.delayRiskBps,
    entrySlippageCost,
    exitSlippagePrice: null,
    exitSlippageBps: null,
    exitBaseSlippageBps: null,
    exitSpreadBps: null,
    exitSpreadSlippageBps: null,
    exitMarketImpactBps: null,
    exitDelayRiskBps: null,
    exitSlippageCost: 0,
    totalSlippageCost: entrySlippageCost,
  });

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
      requestedEntryPrice: roundPrice(tradeResult.requestedEntryPrice),
      entryPrice: roundPrice(tradeResult.entryPrice),
      requestedExitPrice: roundNullablePrice(tradeResult.requestedExitPrice),
      exitPrice: roundNullablePrice(tradeResult.exitPrice),
      grossProfit: round(tradeResult.grossProfit),
      netProfit: round(tradeResult.netProfit),
      openFee: round(tradeResult.openFee),
      closeFee: round(tradeResult.closeFee),
      fundingFee: roundNullable(tradeResult.fundingFee),
      totalFee: round(tradeResult.totalFee),
      entrySlippagePrice: round(tradeResult.entrySlippagePrice),
      entrySlippageBps: round(tradeResult.entrySlippageBps),
      entryBaseSlippageBps: round(tradeResult.entryBaseSlippageBps),
      entrySpreadBps: round(tradeResult.entrySpreadBps),
      entrySpreadSlippageBps: round(tradeResult.entrySpreadSlippageBps),
      entryMarketImpactBps: round(tradeResult.entryMarketImpactBps),
      entryDelayRiskBps: roundNullable(tradeResult.entryDelayRiskBps),
      entrySlippageCost: round(tradeResult.entrySlippageCost),
      exitSlippagePrice: roundNullable(tradeResult.exitSlippagePrice),
      exitSlippageBps: roundNullable(tradeResult.exitSlippageBps),
      exitBaseSlippageBps: roundNullable(tradeResult.exitBaseSlippageBps),
      exitSpreadBps: roundNullable(tradeResult.exitSpreadBps),
      exitSpreadSlippageBps: roundNullable(tradeResult.exitSpreadSlippageBps),
      exitMarketImpactBps: roundNullable(tradeResult.exitMarketImpactBps),
      exitDelayRiskBps: roundNullable(tradeResult.exitDelayRiskBps),
      exitSlippageCost: round(tradeResult.exitSlippageCost),
      totalSlippageCost: round(tradeResult.totalSlippageCost),
      qty: round(tradeResult.qty),
      closedQty: round(tradeResult.closedQty),
    };
  };

  const appendExitToTradeResult = ({
    tradeResult,
    direction,
    timestamp,
    reason,
    requestedPrice,
    executionPrice,
    qty,
    grossProfit,
    fee,
    slippageBreakdown,
  }: {
    tradeResult: OpenTradeResult;
    direction: 'LONG' | 'SHORT';
    timestamp: number;
    reason: TestTradeExitReason;
    requestedPrice: number;
    executionPrice: number;
    qty: number;
    grossProfit: number;
    fee: number;
    slippageBreakdown: ExecutionSlippageBreakdown;
  }): OpenTradeResult => {
    const previousClosedQty = tradeResult.closedQty;
    const requestedExitPrice = getWeightedAverage(
      tradeResult.requestedExitPrice,
      previousClosedQty,
      requestedPrice,
      qty,
    );
    const exitPrice = getWeightedAverage(
      tradeResult.exitPrice,
      previousClosedQty,
      executionPrice,
      qty,
    );
    const exitBaseSlippageBps = getWeightedAverage(
      tradeResult.exitBaseSlippageBps,
      previousClosedQty,
      slippageBreakdown.baseSlippageBps,
      qty,
    );
    const exitSpreadBps = getWeightedAverage(
      tradeResult.exitSpreadBps,
      previousClosedQty,
      slippageBreakdown.spreadBps,
      qty,
    );
    const exitSpreadSlippageBps = getWeightedAverage(
      tradeResult.exitSpreadSlippageBps,
      previousClosedQty,
      slippageBreakdown.spreadSlippageBps,
      qty,
    );
    const exitMarketImpactBps = getWeightedAverage(
      tradeResult.exitMarketImpactBps,
      previousClosedQty,
      slippageBreakdown.marketImpactBps,
      qty,
    );
    const exitDelayRiskBps = null;
    const exitSlippageCost =
      tradeResult.exitSlippageCost +
      getSlippageCost({
        requestedPrice,
        executionPrice,
        direction,
        stage: 'exit',
        qty,
      });

    return {
      ...tradeResult,
      closedQty: previousClosedQty + qty,
      exitTimestamp: timestamp,
      exitReason: reason,
      requestedExitPrice,
      exitPrice,
      grossProfit: tradeResult.grossProfit + grossProfit,
      netProfit: tradeResult.netProfit + grossProfit - fee,
      closeFee: tradeResult.closeFee + fee,
      totalFee:
        tradeResult.openFee +
        tradeResult.closeFee +
        fee +
        (tradeResult.fundingFee ?? 0),
      exitSlippagePrice: exitPrice - requestedExitPrice,
      exitSlippageBps: getSlippageBps(requestedExitPrice, exitPrice),
      exitBaseSlippageBps,
      exitSpreadBps,
      exitSpreadSlippageBps,
      exitMarketImpactBps,
      exitDelayRiskBps,
      exitSlippageCost,
      totalSlippageCost: tradeResult.entrySlippageCost + exitSlippageCost,
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
    slippageBreakdown,
  }: {
    timestamp: number;
    reason: TestTradeExitReason;
    requestedPrice: number;
    executionPrice: number;
    qty: number;
    grossProfit: number;
    fee: number;
    slippageBreakdown: ExecutionSlippageBreakdown;
  }) => {
    if (!currentPosition) {
      return;
    }

    if (currentTradeResult) {
      currentTradeResult = appendExitToTradeResult({
        tradeResult: currentTradeResult,
        direction: currentPosition.direction,
        timestamp,
        reason,
        requestedPrice,
        executionPrice,
        qty,
        grossProfit,
        fee,
        slippageBreakdown,
      });
    }

    const remainingQtyByLeg = currentEntryLegResults.map((tradeResult) =>
      Math.max(0, tradeResult.qty - tradeResult.closedQty),
    );
    const totalRemainingQty = remainingQtyByLeg.reduce(
      (total, remainingQty) => total + remainingQty,
      0,
    );
    if (totalRemainingQty <= 0) {
      return;
    }

    let allocatedQty = 0;
    const activeLegIndexes = remainingQtyByLeg
      .map((remainingQty, index) => ({ remainingQty, index }))
      .filter(({ remainingQty }) => remainingQty > 0);
    for (const [activeIndex, leg] of activeLegIndexes.entries()) {
      const isLast = activeIndex === activeLegIndexes.length - 1;
      const legExitQty = Math.min(
        leg.remainingQty,
        isLast
          ? Math.max(0, qty - allocatedQty)
          : qty * (leg.remainingQty / totalRemainingQty),
      );
      if (legExitQty <= 0) continue;
      allocatedQty += legExitQty;

      const legResult = currentEntryLegResults[leg.index];
      const legGrossProfit =
        currentPosition.direction === 'LONG'
          ? (executionPrice - legResult.entryPrice) * legExitQty
          : (legResult.entryPrice - executionPrice) * legExitQty;
      const legFee = executionPrice * legExitQty * takerFeeRate;
      currentEntryLegResults[leg.index] = appendExitToTradeResult({
        tradeResult: legResult,
        direction: currentPosition.direction,
        timestamp,
        reason,
        requestedPrice,
        executionPrice,
        qty: legExitQty,
        grossProfit: legGrossProfit,
        fee: legFee,
        slippageBreakdown,
      });
    }
  };

  const clearPosition = (timestamp: number) => {
    takeProfits = [];
    stopLossPrice = null;
    originalQty = 0;

    if (!currentPosition) {
      return;
    }

    let finalizedCycleResults: TestTradeResult[] = [];
    if (context?.mlEnabled || context?.aiEnabled) {
      finalizedCycleResults = currentEntryLegResults
        .filter(({ signalId }) => signalId)
        .map((tradeResult) => finalizeTradeResult(tradeResult, timestamp))
        .filter((tradeResult): tradeResult is TestTradeResult =>
          Boolean(tradeResult),
        );
      if (finalizedCycleResults.length) {
        for (const tradeResult of finalizedCycleResults) {
          closedSignalResults.push({
            signalId: tradeResult.signalId,
            profit: round(tradeResult.netProfit),
            tradeResult,
          });
        }
      } else if (currentSignalId) {
        const tradeResult = currentTradeResult
          ? finalizeTradeResult(currentTradeResult, timestamp)
          : undefined;
        if (tradeResult) finalizedCycleResults = [tradeResult];
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
      netProfit: finalizedCycleResults.length
        ? round(
            finalizedCycleResults.reduce(
              (total, tradeResult) => total + tradeResult.netProfit,
              0,
            ),
          )
        : round(currentPositionProfit),
    });

    currentPosition = null;
    currentSignalId = null;
    currentTradeResult = null;
    currentEntryLegResults = [];
    currentPositionProfit = 0;
  };

  const getNetProfit = ({
    grossProfit,
    price,
    qty,
    feeRate = takerFeeRate,
  }: {
    grossProfit: number;
    price: number;
    qty: number;
    feeRate?: number;
  }) => {
    const fee = price * qty * feeRate;
    return {
      fee,
      profit: grossProfit - fee,
    };
  };

  const applyFunding = (candle: Candle) => {
    if (!executionCostModel?.funding.enabled || !currentPosition) {
      return;
    }

    for (const point of fundingRates) {
      if (
        processedFundingTimestamps.has(point.timestamp) ||
        point.symbol.toUpperCase() !== currentPosition.symbol.toUpperCase() ||
        point.timestamp <= currentPosition.timestamp ||
        point.timestamp > candle.timestamp
      ) {
        continue;
      }
      processedFundingTimestamps.add(point.timestamp);
      const notional = candle.close * currentPosition.qty;
      const fundingCost =
        notional * point.rate * (currentPosition.direction === 'LONG' ? 1 : -1);
      amount -= fundingCost;
      currentPositionProfit -= fundingCost;
      if (currentTradeResult) {
        currentTradeResult.fundingFee =
          (currentTradeResult.fundingFee ?? 0) + fundingCost;
        currentTradeResult.netProfit -= fundingCost;
        currentTradeResult.totalFee += fundingCost;
      }
      const remainingLegQty = currentEntryLegResults.reduce(
        (total, tradeResult) =>
          total + Math.max(0, tradeResult.qty - tradeResult.closedQty),
        0,
      );
      if (remainingLegQty > 0) {
        currentEntryLegResults = currentEntryLegResults.map((tradeResult) => {
          const activeQty = Math.max(
            0,
            tradeResult.qty - tradeResult.closedQty,
          );
          const legFundingCost = fundingCost * (activeQty / remainingLegQty);
          return {
            ...tradeResult,
            fundingFee:
              tradeResult.fundingFee == null
                ? null
                : tradeResult.fundingFee + legFundingCost,
            netProfit: tradeResult.netProfit - legFundingCost,
            totalFee: tradeResult.totalFee + legFundingCost,
          };
        });
      }
    }
  };

  const getExitTimestamp = (candle: Candle) =>
    currentPosition
      ? Math.max(candle.timestamp, currentPosition.timestamp)
      : candle.timestamp;

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
    const modelParams = {
      baseSlippageBps: executionCostModel?.slippage.baseBps,
      spreadBps: extractExecutionSpreadBps(signal),
      spreadMultiplier: executionCostModel?.slippage.spreadMultiplier,
      marketImpactBps:
        extractExecutionMarketImpactBps(signal) ??
        executionCostModel?.slippage.marketImpactBps,
      delayRiskBps:
        stage === 'entry'
          ? (extractExecutionDelayRiskBps(signal) ?? 0) *
            (executionCostModel?.slippage.delayRiskMultiplier ?? 1)
          : null,
    };

    return applyModeledExecutionSlippage({
      price,
      direction,
      stage,
      ...modelParams,
    });
  };

  const getExecutionSlippageBreakdown = ({
    stage,
    signal,
  }: {
    stage: 'entry' | 'exit';
    signal?: Order['signal'];
  }) =>
    calculateExecutionSlippageBreakdown({
      baseSlippageBps: executionCostModel?.slippage.baseBps,
      spreadBps: extractExecutionSpreadBps(signal),
      spreadMultiplier: executionCostModel?.slippage.spreadMultiplier,
      marketImpactBps:
        extractExecutionMarketImpactBps(signal) ??
        executionCostModel?.slippage.marketImpactBps,
      delayRiskBps:
        stage === 'entry'
          ? (extractExecutionDelayRiskBps(signal) ?? 0) *
            (executionCostModel?.slippage.delayRiskMultiplier ?? 1)
          : null,
    });

  const getExecutionSlippageLogData = (
    slippageBreakdown: ExecutionSlippageBreakdown,
    stage: 'entry' | 'exit',
  ): Partial<OrderLog> => ({
    executionSlippageStage: stage,
    executionSlippageBps: round(slippageBreakdown.effectiveSlippageBps),
    executionBaseSlippageBps: round(slippageBreakdown.baseSlippageBps),
    executionSpreadBps: round(slippageBreakdown.spreadBps),
    executionSpreadSlippageBps: round(slippageBreakdown.spreadSlippageBps),
    executionMarketImpactBps: round(slippageBreakdown.marketImpactBps),
    executionDelayRiskBps:
      stage === 'entry' ? round(slippageBreakdown.delayRiskBps) : null,
  });

  return {
    __tradejsTestConnector: true,
    capabilities: connector.capabilities,
    universe: connector.universe,
    accountId: connector.accountId,
    deploymentId: connector.deploymentId,
    listInstruments: (query) => connector.listInstruments(query),
    getFundingRateHistory: connector.getFundingRateHistory
      ? (request) => connector.getFundingRateHistory!(request)
      : undefined,
    getTradingFeeRate: connector.getTradingFeeRate
      ? (symbol) => connector.getTradingFeeRate!(symbol)
      : undefined,

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
        ...(executionCostModel ? { executionCostModel } : {}),
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
      applyFunding(candle);

      const isLong = currentPosition.direction === 'LONG';
      const entryPrice = currentPosition.price;

      const high = candle.high;
      const low = candle.low;

      for (const tp of takeProfits) {
        if (!currentPosition || currentPosition.qty <= 0) break;

        const targetPrice = tp.price;
        const reached = isLong ? high >= targetPrice : low <= targetPrice;

        if (reached) {
          const exitTimestamp = getExitTimestamp(candle);
          const qty = originalQty * tp.rate;
          const slippageBreakdown = getExecutionSlippageBreakdown({
            stage: 'exit',
            signal: currentPosition.signal,
          });
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
            timestamp: exitTimestamp,
            reason: 'take_profit',
            requestedPrice: targetPrice,
            executionPrice,
            qty,
            grossProfit,
            fee,
            slippageBreakdown,
          });

          amount += profit;
          currentPositionProfit += profit;

          currentPosition.qty = parseFloat(
            (currentPosition.qty - qty).toFixed(8),
          );

          logOrder({
            timestamp: exitTimestamp,
            qty,
            price: executionPrice,
            profit,
            fee,
            type: isLong ? 'TAKE_PROFIT_LONG' : 'TAKE_PROFIT_SHORT',
            ...getExecutionSlippageLogData(slippageBreakdown, 'exit'),
          });

          tp.done = true;
        }
      }

      takeProfits = takeProfits.filter(({ done }) => !done);

      if (currentPosition && currentPosition.qty <= 0) {
        clearPosition(getExitTimestamp(candle));
      }
    },

    checkSl: async (candle: Candle) => {
      if (!stopLossPrice || !currentPosition || !candle) {
        return;
      }
      applyFunding(candle);

      const isLong = currentPosition.direction === 'LONG';
      const hitStop = isLong
        ? candle.low <= stopLossPrice
        : candle.high >= stopLossPrice;

      if (hitStop) {
        const exitTimestamp = getExitTimestamp(candle);
        const qty = currentPosition.qty;
        const slippageBreakdown = getExecutionSlippageBreakdown({
          stage: 'exit',
          signal: currentPosition.signal,
        });
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
          timestamp: exitTimestamp,
          reason: 'stop_loss',
          requestedPrice: stopLossPrice,
          executionPrice,
          qty,
          grossProfit,
          fee,
          slippageBreakdown,
        });

        amount += profit;
        currentPositionProfit += profit;

        logOrder({
          timestamp: exitTimestamp,
          qty,
          profit,
          price: executionPrice,
          fee,
          type: isLong ? 'STOP_LOSS_LONG' : 'STOP_LOSS_SHORT',
          ...getExecutionSlippageLogData(slippageBreakdown, 'exit'),
        });

        clearPosition(exitTimestamp);
      }
    },

    checkExits: async (candle: Candle) => {
      if (!candle || !currentPosition) {
        return;
      }
      applyFunding(candle);

      if (stopLossPrice) {
        const isLong = currentPosition.direction === 'LONG';
        const hitStop = isLong
          ? candle.low <= stopLossPrice
          : candle.high >= stopLossPrice;

        if (hitStop) {
          const exitTimestamp = getExitTimestamp(candle);
          const qty = currentPosition.qty;
          const slippageBreakdown = getExecutionSlippageBreakdown({
            stage: 'exit',
            signal: currentPosition.signal,
          });
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
            timestamp: exitTimestamp,
            reason: 'stop_loss',
            requestedPrice: stopLossPrice,
            executionPrice,
            qty,
            grossProfit,
            fee,
            slippageBreakdown,
          });

          amount += profit;
          currentPositionProfit += profit;

          logOrder({
            timestamp: exitTimestamp,
            qty,
            profit,
            price: executionPrice,
            fee,
            type: isLong ? 'STOP_LOSS_LONG' : 'STOP_LOSS_SHORT',
            ...getExecutionSlippageLogData(slippageBreakdown, 'exit'),
          });

          clearPosition(exitTimestamp);
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
          const exitTimestamp = getExitTimestamp(candle);
          const qty = originalQty * tp.rate;
          const slippageBreakdown = getExecutionSlippageBreakdown({
            stage: 'exit',
            signal: currentPosition.signal,
          });
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
            timestamp: exitTimestamp,
            reason: 'take_profit',
            requestedPrice: targetPrice,
            executionPrice,
            qty,
            grossProfit,
            fee,
            slippageBreakdown,
          });

          amount += profit;
          currentPositionProfit += profit;

          currentPosition.qty = parseFloat(
            (currentPosition.qty - qty).toFixed(8),
          );

          logOrder({
            timestamp: exitTimestamp,
            qty,
            price: executionPrice,
            profit,
            fee,
            type: isLong ? 'TAKE_PROFIT_LONG' : 'TAKE_PROFIT_SHORT',
            ...getExecutionSlippageLogData(slippageBreakdown, 'exit'),
          });

          tp.done = true;
        }
      }

      takeProfits = takeProfits.filter(({ done }) => !done);

      if (currentPosition && currentPosition.qty <= 0) {
        clearPosition(getExitTimestamp(candle));
      }
    },

    placeOrder: async (order) => {
      const isPositionIncrease = Boolean(
        currentPosition &&
          order.positionIntent === 'increase' &&
          currentPosition.direction === order.direction,
      );
      if (currentPosition && !isPositionIncrease) {
        return false;
      }

      const normalizedOrder = normalizeInstrumentOrderQty({
        qty: order.qty,
        symbol: order.symbol,
        instrument: context?.instrument,
      });
      const orderQty = normalizedOrder.qty;
      if (
        orderQty <= 0 ||
        (normalizedOrder.minOrderQty != null &&
          orderQty < normalizedOrder.minOrderQty)
      ) {
        if (order.signal) {
          order.signal.orderQty = orderQty;
          order.signal.orderValue = orderQty * order.price;
          order.signal.orderFailureReason = 'QTY_BELOW_MIN_ORDER';
        }
        return false;
      }
      if (order.signal) {
        order.signal.orderQty = orderQty;
        order.signal.orderValue = orderQty * order.price;
      }

      const isLong = order.direction === 'LONG';

      const entrySlippageBreakdown = getExecutionSlippageBreakdown({
        stage: 'entry',
        signal: order.signal,
      });
      const entryPrice = applyExecutionSlippage({
        price: order.price,
        direction: order.direction,
        stage: 'entry',
        signal: order.signal,
      });
      const previousPosition = currentPosition;
      const previousQty = previousPosition?.qty ?? 0;
      const resultingQty = previousQty + orderQty;
      const resultingEntryPrice = previousPosition
        ? getWeightedAverage(
            previousPosition.price,
            previousQty,
            entryPrice,
            orderQty,
          )
        : entryPrice;
      currentPosition = previousPosition
        ? {
            ...previousPosition,
            qty: resultingQty,
            price: resultingEntryPrice,
          }
        : { ...order, qty: orderQty, price: entryPrice, amount };
      originalQty = resultingQty;

      if (isPositionIncrease) {
        const { fee, profit } = getNetProfit({
          grossProfit: 0,
          price: entryPrice,
          qty: orderQty,
          feeRate: order.isLimit ? makerFeeRate : takerFeeRate,
        });
        const entrySlippageCost = getSlippageCost({
          requestedPrice: order.price,
          executionPrice: entryPrice,
          direction: order.direction,
          stage: 'entry',
          qty: orderQty,
        });
        const increaseSignalId =
          typeof order.signal?.signalId === 'string' && order.signal.signalId
            ? order.signal.signalId
            : '';

        amount += profit;
        currentPositionProfit += profit;
        currentEntryLegResults.push(
          createOpenTradeResult({
            signalId: increaseSignalId,
            positionCycleId: currentSignalId ?? increaseSignalId,
            direction: order.direction,
            qty: orderQty,
            timestamp: order.timestamp,
            requestedEntryPrice: order.price,
            entryPrice,
            fee,
            slippageBreakdown: entrySlippageBreakdown,
            entrySlippageCost,
          }),
        );
        if (currentTradeResult) {
          const requestedEntryPrice = getWeightedAverage(
            currentTradeResult.requestedEntryPrice,
            currentTradeResult.qty,
            order.price,
            orderQty,
          );
          const weightedEntryPrice = getWeightedAverage(
            currentTradeResult.entryPrice,
            currentTradeResult.qty,
            entryPrice,
            orderQty,
          );
          const entryBaseSlippageBps = getWeightedAverage(
            currentTradeResult.entryBaseSlippageBps,
            currentTradeResult.qty,
            entrySlippageBreakdown.baseSlippageBps,
            orderQty,
          );
          const entrySpreadBps = getWeightedAverage(
            currentTradeResult.entrySpreadBps,
            currentTradeResult.qty,
            entrySlippageBreakdown.spreadBps,
            orderQty,
          );
          const entrySpreadSlippageBps = getWeightedAverage(
            currentTradeResult.entrySpreadSlippageBps,
            currentTradeResult.qty,
            entrySlippageBreakdown.spreadSlippageBps,
            orderQty,
          );
          const entryMarketImpactBps = getWeightedAverage(
            currentTradeResult.entryMarketImpactBps,
            currentTradeResult.qty,
            entrySlippageBreakdown.marketImpactBps,
            orderQty,
          );
          const entryDelayRiskBps = getWeightedAverage(
            currentTradeResult.entryDelayRiskBps,
            currentTradeResult.qty,
            entrySlippageBreakdown.delayRiskBps,
            orderQty,
          );
          const totalEntrySlippageCost =
            currentTradeResult.entrySlippageCost + entrySlippageCost;

          currentTradeResult = {
            ...currentTradeResult,
            qty: currentTradeResult.qty + orderQty,
            requestedEntryPrice,
            entryPrice: weightedEntryPrice,
            netProfit: currentTradeResult.netProfit + profit,
            openFee: currentTradeResult.openFee + fee,
            totalFee: currentTradeResult.totalFee + fee,
            entrySlippagePrice: weightedEntryPrice - requestedEntryPrice,
            entrySlippageBps: getSlippageBps(
              requestedEntryPrice,
              weightedEntryPrice,
            ),
            entryBaseSlippageBps,
            entrySpreadBps,
            entrySpreadSlippageBps,
            entryMarketImpactBps,
            entryDelayRiskBps,
            entrySlippageCost: totalEntrySlippageCost,
            totalSlippageCost:
              totalEntrySlippageCost + currentTradeResult.exitSlippageCost,
          };
        }

        logOrder({
          ...order,
          qty: orderQty,
          price: entryPrice,
          profit,
          fee,
          type: isLong ? 'OPEN_LONG' : 'OPEN_SHORT',
          ...getExecutionSlippageLogData(entrySlippageBreakdown, 'entry'),
        });

        return true;
      }

      currentSignalId =
        typeof order.signal?.signalId === 'string' && order.signal.signalId
          ? order.signal.signalId
          : null;

      const { fee, profit } = getNetProfit({
        grossProfit: 0,
        price: entryPrice,
        qty: orderQty,
        feeRate: order.isLimit ? makerFeeRate : takerFeeRate,
      });
      const entrySlippageCost = getSlippageCost({
        requestedPrice: order.price,
        executionPrice: entryPrice,
        direction: order.direction,
        stage: 'entry',
        qty: orderQty,
      });

      amount += profit;
      currentPositionProfit = profit;
      const openTradeResult = createOpenTradeResult({
        signalId: currentSignalId ?? '',
        positionCycleId: currentSignalId ?? '',
        direction: order.direction,
        qty: orderQty,
        timestamp: order.timestamp,
        requestedEntryPrice: order.price,
        entryPrice,
        fee,
        slippageBreakdown: entrySlippageBreakdown,
        entrySlippageCost,
      });
      currentEntryLegResults = [openTradeResult];
      currentTradeResult = currentSignalId
        ? { ...openTradeResult, signalId: currentSignalId }
        : null;

      logOrder({
        ...order,
        qty: orderQty,
        price: entryPrice,
        profit,
        fee,
        type: isLong ? 'OPEN_LONG' : 'OPEN_SHORT',
        ...getExecutionSlippageLogData(entrySlippageBreakdown, 'entry'),
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
      const fullTakeProfit =
        takeProfits.length === 1 && takeProfits[0]?.rate === 1
          ? takeProfits[0].price
          : undefined;
      currentPosition = {
        ...currentPosition,
        tpPrice: fullTakeProfit,
      };
      return true;
    },

    setStopLoss: async ({ stopLossPrice: nextStopLossPrice }) => {
      if (!currentPosition) {
        return false;
      }

      stopLossPrice = nextStopLossPrice ?? null;
      currentPosition = {
        ...currentPosition,
        slPrice: stopLossPrice ?? undefined,
      };
      return true;
    },

    closePosition: async (order) => {
      if (!currentPosition) {
        return false;
      }

      const isLong = currentPosition.direction === 'LONG';
      const slippageBreakdown = getExecutionSlippageBreakdown({
        stage: 'exit',
        signal: currentPosition.signal,
      });
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
        slippageBreakdown,
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
        ...getExecutionSlippageLogData(slippageBreakdown, 'exit'),
      });

      clearPosition(order.timestamp);

      return true;
    },

    getTickers: connector.getTickers,
    getPositions: connector.getPositions,
    drainMlResultsBatch: async () => closedSignalResults.splice(0),
  };
};
