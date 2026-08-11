import { logger } from '@tradejs/infra/logger';
import {
  executeEntryOrder,
  getOrderArrivalSnapshot,
  updatePositionProtection,
  validateEntryProtectionAtArrival,
} from '../strategyHelpers/runtime';
import {
  getActiveRuntimeTrade,
  markRuntimeTradeClosed,
} from '../runtimeJournal';
import {
  BACKTEST_WARNING_CODES,
  type Connector,
  type RuntimeStrategyCloseNotification,
  type Signal,
  type StrategyDecision,
  type StrategyHookAiContext,
  type StrategyHookCtx,
  type StrategyHookEntryContext,
  type StrategyHookMarketContext,
  type StrategyHookMlContext,
  type StrategyHookPolicyContext,
  type StrategyHookStage,
  type StrategyManifest,
} from '@tradejs/types';
import type { ResolvedEntryRuntime } from './runtimeEntryPolicy';

type EntryDecision = Extract<StrategyDecision, { kind: 'entry' }>;
type ExitDecision = Extract<StrategyDecision, { kind: 'exit' }>;
type ProtectDecision = Extract<StrategyDecision, { kind: 'protect' }>;
type HookCandleMarket = Required<
  Pick<StrategyHookMarketContext, 'candle' | 'btcCandle'>
>;

const buildExitOrderSignal = ({
  strategyName,
  symbol,
  decision,
}: {
  strategyName?: string;
  symbol: string;
  decision: ExitDecision;
}): Signal | undefined => {
  if (!strategyName) {
    return undefined;
  }

  return {
    signalId: `${strategyName}:${symbol}:exit:${decision.closePlan.timestamp}`,
    strategy: strategyName,
    symbol,
    interval: '15',
    direction: decision.closePlan.direction,
    timestamp: decision.closePlan.timestamp,
    figures: {},
    indicators: {},
    prices: {
      currentPrice: decision.closePlan.price,
      takeProfitPrice: decision.closePlan.price,
      stopLossPrice: decision.closePlan.price,
      riskRatio: 0,
    },
    additionalIndicators: {
      exit: {
        code: decision.code,
      },
    },
  };
};

export const handleExitDecision = async ({
  connector,
  userName,
  strategyName,
  symbol,
  decision,
  market,
  onRuntimeClose,
  onRuntimeError,
}: {
  connector: Connector;
  userName?: string;
  strategyName?: string;
  symbol: string;
  decision: ExitDecision;
  market: HookCandleMarket;
  onRuntimeClose?: (event: RuntimeStrategyCloseNotification) => void;
  onRuntimeError?: (params: {
    stage: StrategyHookStage;
    error: unknown;
    decision: ExitDecision;
    market: HookCandleMarket;
  }) => Promise<void>;
}) => {
  try {
    let activeTradeForClose: Awaited<ReturnType<typeof getActiveRuntimeTrade>> =
      null;
    if (userName) {
      const activeTrade = await getActiveRuntimeTrade({
        userName,
        symbol,
        accountId: connector.accountId,
        deploymentId: connector.deploymentId,
      });
      if (!activeTrade) {
        logger.warn(
          '[%s] blocked closePosition for untracked runtime position: %s',
          strategyName ?? 'unknown',
          symbol,
        );
        return 'CLOSE_BLOCKED_BY_UNTRACKED_POSITION';
      }

      if (!strategyName || activeTrade.strategy !== strategyName) {
        logger.warn(
          '[%s] blocked closePosition for foreign runtime position: %s ownedBy=%s',
          strategyName ?? 'unknown',
          symbol,
          activeTrade.strategy,
        );
        return 'CLOSE_BLOCKED_BY_FOREIGN_STRATEGY_POSITION';
      }

      activeTradeForClose = activeTrade;
    }

    await connector.closePosition({
      symbol,
      price: decision.closePlan.price,
      timestamp: decision.closePlan.timestamp,
      direction: decision.closePlan.direction,
      signal: buildExitOrderSignal({
        strategyName,
        symbol,
        decision,
      }),
    });
    const closedTrade = await markRuntimeTradeClosed({
      userName,
      strategy: strategyName,
      symbol,
      exitPrice: decision.closePlan.price,
      exitTimestamp: decision.closePlan.timestamp,
      exitType: 'exit',
      accountId: connector.accountId,
      deploymentId: connector.deploymentId,
    });
    const trade = closedTrade ?? activeTradeForClose;
    if (trade && strategyName) {
      try {
        onRuntimeClose?.({
          userName,
          strategy: strategyName,
          openedByStrategy: trade.strategy,
          symbol,
          direction: trade.direction,
          code: decision.code,
          orderId: trade.orderId,
          signalId: trade.signalId,
          qty: trade.qty,
          entryPrice: trade.entryPrice,
          entryTimestamp: trade.entryTimestamp,
          exitPrice: closedTrade?.exitPrice ?? decision.closePlan.price,
          exitTimestamp:
            closedTrade?.exitTimestamp ?? decision.closePlan.timestamp,
          closedPnl: closedTrade?.closedPnl ?? trade.closedPnl ?? null,
          exitType: closedTrade?.exitType ?? 'exit',
        });
      } catch (notificationError) {
        logger.error(
          'runtime close notification error: %s %s',
          symbol,
          notificationError,
        );
      }
    }
  } catch (err) {
    await onRuntimeError?.({
      stage: 'closePosition',
      error: err,
      decision,
      market,
    });
    logger.error('close order error: %s %s', symbol, err);
    return 'ORDER_ERROR';
  }

  return decision.code;
};

export const handleProtectDecision = async ({
  connector,
  symbol,
  decision,
  market,
  onRuntimeError,
}: {
  connector: Connector;
  symbol: string;
  decision: ProtectDecision;
  market: HookCandleMarket;
  onRuntimeError?: (params: {
    stage: StrategyHookStage;
    error: unknown;
    decision: ProtectDecision;
    market: HookCandleMarket;
  }) => Promise<void>;
}) => {
  try {
    await updatePositionProtection({
      connector,
      symbol,
      direction: decision.protectPlan.direction,
      takeProfits: decision.protectPlan.takeProfits ?? [],
      stopLossPrice: decision.protectPlan.stopLossPrice ?? null,
    });
  } catch (err) {
    await onRuntimeError?.({
      stage: 'protectPosition',
      error: err,
      decision,
      market,
    });
    logger.error('protect position error: %s %s', symbol, err);
    return 'ORDER_ERROR';
  }

  return decision.code;
};

export const executeEntryDecision = async ({
  connector,
  symbol,
  decision,
  runtime,
  manifest,
  hookCtx,
  market,
  entry,
  policy,
  ml,
  ai,
  recordRuntimeJournal,
  invokeStageHooks,
  notifyRuntimeError,
}: {
  connector: Connector;
  symbol: string;
  decision: EntryDecision;
  runtime: ResolvedEntryRuntime;
  manifest?: StrategyManifest;
  hookCtx: StrategyHookCtx;
  market: HookCandleMarket;
  entry: StrategyHookEntryContext;
  policy: StrategyHookPolicyContext;
  ml?: StrategyHookMlContext;
  ai?: StrategyHookAiContext;
  recordRuntimeJournal: boolean;
  invokeStageHooks: <TReturn = unknown>(
    stage: StrategyHookStage,
    hook: ((params: any) => Promise<TReturn> | TReturn) | undefined,
    params: any,
    errorContext?: {
      decision?: StrategyDecision;
      entry?: StrategyHookEntryContext;
      market?: StrategyHookMarketContext;
    },
  ) => Promise<TReturn | undefined>;
  notifyRuntimeError: (params: {
    stage: StrategyHookStage;
    error: unknown;
    decision?: StrategyDecision;
    entry?: StrategyHookEntryContext;
    market?: StrategyHookMarketContext;
  }) => Promise<void>;
}) => {
  const signal = decision.signal;
  const beforePlaceOrder = async () => {
    await invokeStageHooks(
      'beforePlaceOrder',
      manifest?.hooks?.beforePlaceOrder,
      {
        ctx: hookCtx,
        market,
        decision,
        entry,
        policy,
        ml,
        ai,
      },
      { decision, entry, market },
    );
    try {
      await runtime.beforePlaceOrder?.();
    } catch (error) {
      await notifyRuntimeError({
        stage: 'runtime.beforePlaceOrder',
        error,
        decision,
        entry,
        market,
      });
      throw error;
    }
  };
  try {
    if (signal) {
      await executeEntryOrder({
        connector,
        userName: hookCtx.userName,
        symbol,
        direction: decision.entryContext.direction,
        qty: decision.orderPlan.qty,
        currentPrice: decision.entryContext.prices.currentPrice,
        timestamp: decision.entryContext.timestamp,
        takeProfits: decision.orderPlan.takeProfits,
        stopLossPrice: decision.orderPlan.stopLossPrice,
        positionIntent: decision.orderPlan.positionIntent,
        ...(Number.isFinite(Number(hookCtx.strategyConfig.LEVERAGE))
          ? { leverage: Number(hookCtx.strategyConfig.LEVERAGE) }
          : {}),
        signal,
        beforePlaceOrder,
        recordRuntimeTrade: recordRuntimeJournal,
      });
      await invokeStageHooks(
        'afterPlaceOrder',
        manifest?.hooks?.afterPlaceOrder,
        {
          ctx: hookCtx,
          market,
          decision,
          entry,
          policy,
          ml,
          ai,
          order: {
            result: signal,
          },
        },
        { decision, entry, market },
      );
      return signal;
    }

    await beforePlaceOrder();
    const arrivalSnapshot = await getOrderArrivalSnapshot({
      connector,
      symbol,
    });
    validateEntryProtectionAtArrival({
      direction: decision.entryContext.direction,
      signalPrice: decision.entryContext.prices.currentPrice,
      bid: arrivalSnapshot.bid,
      ask: arrivalSnapshot.ask,
      arrivalMid: arrivalSnapshot.arrivalMid,
      takeProfits: decision.orderPlan.takeProfits,
      stopLossPrice: decision.orderPlan.stopLossPrice,
    });
    const orderPlaced = await connector.placeOrder({
      symbol,
      qty: decision.orderPlan.qty,
      price: decision.entryContext.prices.currentPrice,
      timestamp: decision.entryContext.timestamp,
      direction: decision.entryContext.direction,
      positionIntent: decision.orderPlan.positionIntent,
      ...(Number.isFinite(Number(hookCtx.strategyConfig.LEVERAGE))
        ? { leverage: Number(hookCtx.strategyConfig.LEVERAGE) }
        : {}),
    });

    if (!orderPlaced) {
      throw new Error('PLACE_ORDER_FAILED');
    }

    try {
      await updatePositionProtection({
        connector,
        symbol,
        direction: decision.entryContext.direction,
        qty: decision.orderPlan.qty,
        takeProfits: decision.orderPlan.takeProfits,
        stopLossPrice: decision.orderPlan.stopLossPrice,
      });
    } catch (error) {
      await connector.closePosition({
        symbol,
        price: decision.entryContext.prices.currentPrice,
        timestamp: decision.entryContext.timestamp,
        direction: decision.entryContext.direction,
      });
      throw error;
    }

    await invokeStageHooks(
      'afterPlaceOrder',
      manifest?.hooks?.afterPlaceOrder,
      {
        ctx: hookCtx,
        market,
        decision,
        entry,
        policy,
        ml,
        ai,
        order: {
          result: decision.code,
        },
      },
      { decision, entry, market },
    );
  } catch (err) {
    if (signal) {
      signal.orderStatus = 'failed';
      if (
        typeof signal.orderFailureReason !== 'string' ||
        !signal.orderFailureReason.trim()
      ) {
        signal.orderFailureReason =
          typeof (err as Error)?.message === 'string' &&
          (err as Error).message.trim()
            ? (err as Error).message.trim()
            : undefined;
      }
    }
    await notifyRuntimeError({
      stage: 'placeOrder',
      error: err,
      decision,
      entry,
      market,
    });
    if (
      (err as Error)?.message ===
      BACKTEST_WARNING_CODES.TAKE_PROFIT_CROSSED_BEFORE_ENTRY
    ) {
      logger.warn('order warning: %s %s', symbol, err);
    } else {
      logger.error('order error: %s %s', symbol, err);
    }
    return signal ?? 'ORDER_ERROR';
  }

  return signal ?? decision.code;
};
