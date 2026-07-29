import path from 'node:path';
import type {
  TradejsConfigAfterBarDecisionHook,
  TradejsConfigAfterCoreDecisionHook,
  TradejsConfigOnBarHook,
  TradejsConfigHooks,
} from '@tradejs/core/config';
import {
  BACKTEST_EXECUTION_DELAY_MS,
  BACKTEST_EXECUTION_INTERVAL,
  BACKTEST_LOWER_TIMEFRAME_EXECUTION_ENABLED,
  SIGNALS_PRELOAD_DAYS,
} from '@tradejs/core/constants';
import { intervalToMs } from '@tradejs/core/data';
import {
  buildDefaultIndicatorPeriods,
  calculateRiskRatio,
  createStrategyAPI,
  createStrategyIndicatorsState,
  getSharedStrategyReplayState,
  resolveBacktestExecutionPrice,
} from '@tradejs/core/strategies';
import { getTimestamp } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';
import {
  enrichSignalWithAi,
  enrichSignalWithMl,
  executeEntryOrder,
  getOrderArrivalSnapshot,
  updatePositionProtection,
  validateEntryProtectionAtArrival,
} from './strategyHelpers/runtime';
import { enrichSignalWithBinanceMarketContext } from './strategyHelpers/binanceMarketContext';
import { enrichSignalWithDerivativesContext } from './strategyHelpers/derivativesContext';
import { enrichSignalWithCoinMarketCapContext } from './strategyHelpers/coinMarketCapContext';
import {
  getActiveRuntimeTrade,
  markRuntimeTradeClosed,
} from './runtimeJournal';
import { createPineScriptLoader } from './pine';
import { getStrategyManifest } from './strategy/manifests';
import { resolveStrategyPolicyProfile } from './strategy/policyProfiles';
import { getTradejsProjectCwd, loadTradejsConfig } from './tradejsConfig';
import { resolveStrategyConfig } from './strategyHelpers/config';
import {
  BACKTEST_WARNING_CODES,
  CreateStrategyCore,
  CreateStrategyCoreParams,
  KlineChartData,
  KlineChartItem,
  StrategyHookAiContext,
  StrategyHookCtx,
  StrategyHookEntryContext,
  StrategyHookGateResult,
  StrategyHookMarketContext,
  StrategyHookMlContext,
  StrategyHookPolicyContext,
  StrategyHookStage,
  StrategyManifest,
  StrategyPolicyProfile,
  StrategyConfig,
  StrategyCreator,
  StrategyDecision,
  RuntimeStrategyCloseNotification,
  Signal,
} from '@tradejs/types';

interface CreateStrategyRuntimeParams<TConfig extends StrategyConfig> {
  strategyName: string;
  defaults: TConfig;
  createCore: CreateStrategyCore<TConfig, any, any>;
  manifest?: StrategyManifest;
  strategyDirectory?: string;
  detectorKey?: (config: TConfig) => string | undefined;
  detectorNoSignalSkipReason?: string;
}

type EntryDecision = Extract<StrategyDecision, { kind: 'entry' }>;
type ExitDecision = Extract<StrategyDecision, { kind: 'exit' }>;
type ProtectDecision = Extract<StrategyDecision, { kind: 'protect' }>;

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

const resolveEntryRuntimePolicy = ({
  decision,
  config,
  manifest,
  policyProfile,
}: {
  decision: EntryDecision;
  config: StrategyConfig;
  manifest?: StrategyManifest;
  policyProfile?: StrategyPolicyProfile;
}) => {
  const baseDefaults = manifest?.entryRuntimeDefaults;
  const profileDefaults = policyProfile?.entryRuntimeDefaults;
  const manifestDefaults =
    baseDefaults || profileDefaults
      ? {
          ...baseDefaults,
          ...profileDefaults,
          ...(baseDefaults?.ml || profileDefaults?.ml
            ? { ml: { ...baseDefaults?.ml, ...profileDefaults?.ml } }
            : {}),
          ...(baseDefaults?.ai || profileDefaults?.ai
            ? { ai: { ...baseDefaults?.ai, ...profileDefaults?.ai } }
            : {}),
        }
      : undefined;
  const adapterMl = (
    policyProfile?.mlAdapter ?? manifest?.mlAdapter
  )?.mapEntryRuntimeFromConfig?.(config);
  const adapterAi = (
    policyProfile?.aiAdapter ?? manifest?.aiAdapter
  )?.mapEntryRuntimeFromConfig?.(config);
  const ml =
    manifestDefaults?.ml || adapterMl || decision.runtime?.ml
      ? {
          ...manifestDefaults?.ml,
          ...adapterMl,
          ...decision.runtime?.ml,
        }
      : undefined;
  const ai =
    manifestDefaults?.ai || adapterAi || decision.runtime?.ai
      ? {
          ...manifestDefaults?.ai,
          ...adapterAi,
          ...decision.runtime?.ai,
        }
      : undefined;

  return {
    ...manifestDefaults,
    ...decision.runtime,
    ml,
    ai,
  };
};

const formatGateNumber = (value: number) => {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  const normalized = Number(value.toFixed(6));
  return Number.isInteger(normalized) ? String(normalized) : String(normalized);
};

const isMlRuntimeGateEnabled = (params: {
  env: string;
  ml?: StrategyHookMlContext;
}) => {
  const { env, ml } = params;
  return (
    env !== 'BACKTEST' && ml?.config != null && ml.config.enabled !== false
  );
};

const isMlResultUnavailable = (params: {
  env: string;
  ml?: StrategyHookMlContext;
}) => {
  const { env, ml } = params;
  return isMlRuntimeGateEnabled({ env, ml }) && ml?.result == null;
};

const shouldExecuteEntryDecision = ({
  makeOrdersEnabled,
  env,
  signal,
  ml,
  aiEnabled,
  quality,
  minAiQuality,
}: {
  makeOrdersEnabled: boolean;
  env: string;
  signal?: EntryDecision['signal'];
  ml?: StrategyHookMlContext;
  aiEnabled: boolean;
  quality?: number;
  minAiQuality: number;
}) => {
  if (!makeOrdersEnabled) {
    return false;
  }

  if (!signal || env === 'BACKTEST') {
    return true;
  }

  if (isMlResultUnavailable({ env, ml })) {
    return false;
  }

  if (isMlRuntimeGateEnabled({ env, ml }) && ml?.result?.passed === false) {
    return false;
  }

  if (!aiEnabled) {
    return true;
  }

  return Number.isFinite(quality) && (quality as number) >= minAiQuality;
};

const getEntrySkipReason = ({
  makeOrdersEnabled,
  env,
  ml,
  aiEnabled,
  quality,
  minAiQuality,
}: {
  makeOrdersEnabled: boolean;
  env: string;
  ml?: StrategyHookMlContext;
  aiEnabled: boolean;
  quality?: number;
  minAiQuality: number;
}): string => {
  if (!makeOrdersEnabled) {
    return 'MAKE_ORDERS_DISABLED';
  }

  if (isMlResultUnavailable({ env, ml })) {
    return 'ML_RESULT_UNAVAILABLE';
  }

  if (isMlRuntimeGateEnabled({ env, ml }) && ml?.result?.passed === false) {
    const probability = formatGateNumber(ml.result.probability);
    const threshold = formatGateNumber(ml.result.threshold);
    return `ML_THRESHOLD_NOT_MET (${probability} < ${threshold})`;
  }

  if (env !== 'BACKTEST' && aiEnabled && quality == null) {
    return 'AI_QUALITY_UNAVAILABLE';
  }

  if (
    env !== 'BACKTEST' &&
    aiEnabled &&
    quality != null &&
    Number.isFinite(quality) &&
    quality < minAiQuality
  ) {
    return `AI_QUALITY_BELOW_MIN (${quality} < ${minAiQuality})`;
  }

  return 'ENTRY_POLICY_BLOCKED';
};

type ResolvedEntryRuntime = ReturnType<typeof resolveEntryRuntimePolicy>;
type HookCandleMarket = Required<
  Pick<StrategyHookMarketContext, 'candle' | 'btcCandle'>
>;
type PendingBacktestEntry = {
  delayBars: number;
  delayBarsRemaining: number;
  decision: EntryDecision;
  runtime: ResolvedEntryRuntime;
  manifest?: StrategyManifest;
  hookCtx: StrategyHookCtx;
  policy: StrategyHookPolicyContext;
  ml?: StrategyHookMlContext;
  ai?: StrategyHookAiContext;
};

type BacktestExecutionCandleResolution = {
  candle?: KlineChartItem;
  btcCandle?: KlineChartItem;
  source: 'primary_timeframe' | 'lower_timeframe';
  requestedExecutionTimestamp?: number;
  executionInterval?: string;
  executionDelayMs?: number;
  primaryExecutionTimestamp?: number;
  skipReason?: string;
};

const resolveBacktestEntryDelayBars = (value: unknown) => {
  if (value == null || value === '') {
    return 1;
  }
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 1;
};

const resolveBacktestExecutionIntervalForPrimary = (interval: unknown) => {
  const normalized = String(interval ?? '15');
  if (normalized === '15') {
    return BACKTEST_EXECUTION_INTERVAL;
  }
  if (normalized === '60') {
    return '15';
  }
  return null;
};

const resolveBacktestExecutionDelayMs = (
  value: unknown,
  fallbackDelayMs: number,
) => {
  if (value == null || value === '') {
    return fallbackDelayMs;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.trunc(parsed))
    : fallbackDelayMs;
};

const safeIntervalToMs = (interval: unknown) => {
  try {
    return intervalToMs(interval as any);
  } catch {
    return null;
  }
};

const buildCandleByTimestamp = (candles?: KlineChartData) =>
  new Map(
    (candles ?? [])
      .filter((candle) => typeof candle?.timestamp === 'number')
      .map((candle) => [candle.timestamp, candle]),
  );

const buildBacktestExecutionOnlyCandle = (
  candle: KlineChartItem,
  executionPrice: number,
): KlineChartItem => ({
  ...candle,
  open: executionPrice,
  high: executionPrice,
  low: executionPrice,
  close: executionPrice,
  volume: 0,
  turnover: 0,
});

const resolveInvalidDelayedEntryReason = ({
  decision,
  executionPrice,
  takeProfitPrice,
  stopLossPrice,
  riskRatio,
}: {
  decision: EntryDecision;
  executionPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  riskRatio: number;
}) => {
  if (
    !Number.isFinite(executionPrice) ||
    !Number.isFinite(takeProfitPrice) ||
    !Number.isFinite(stopLossPrice)
  ) {
    return 'BACKTEST_DELAYED_ENTRY_INVALID_PRICE';
  }

  if (decision.entryContext.direction === 'LONG') {
    if (executionPrice <= stopLossPrice) {
      return 'BACKTEST_DELAYED_ENTRY_BEYOND_STOP';
    }
    if (executionPrice >= takeProfitPrice) {
      return 'BACKTEST_DELAYED_ENTRY_BEYOND_TAKE_PROFIT';
    }
    return !Number.isFinite(riskRatio) || riskRatio <= 0
      ? 'BACKTEST_DELAYED_ENTRY_INVALID_PRICE'
      : null;
  }

  if (executionPrice >= stopLossPrice) {
    return 'BACKTEST_DELAYED_ENTRY_BEYOND_STOP';
  }
  if (executionPrice <= takeProfitPrice) {
    return 'BACKTEST_DELAYED_ENTRY_BEYOND_TAKE_PROFIT';
  }
  return !Number.isFinite(riskRatio) || riskRatio <= 0
    ? 'BACKTEST_DELAYED_ENTRY_INVALID_PRICE'
    : null;
};

const applyBacktestDelayedEntryExecution = ({
  decision,
  execution,
  backtestPriceMode,
  delayBars,
}: {
  decision: EntryDecision;
  execution: BacktestExecutionCandleResolution;
  backtestPriceMode: StrategyConfig['BACKTEST_PRICE_MODE'];
  delayBars: number;
}) => {
  const { candle, btcCandle } = execution;
  const signalTimestamp =
    decision.signal?.timestamp ?? decision.entryContext.timestamp;
  const signalPrice =
    decision.signal?.prices.currentPrice ??
    decision.entryContext.prices.currentPrice;
  const skipReason =
    execution.skipReason ??
    (!candle || !btcCandle
      ? 'BACKTEST_LOWER_EXECUTION_CANDLE_MISSING'
      : undefined);

  if (skipReason || !candle || !btcCandle) {
    if (decision.signal) {
      decision.signal.additionalIndicators = {
        ...(decision.signal.additionalIndicators ?? {}),
        backtestExecution: {
          entryDelayBars: delayBars,
          priceMode: backtestPriceMode ?? 'open',
          signalTimestamp,
          signalPrice,
          executionSource: execution.source,
          ...(execution.executionInterval
            ? { executionInterval: execution.executionInterval }
            : {}),
          ...(execution.executionDelayMs != null
            ? { executionDelayMs: execution.executionDelayMs }
            : {}),
          ...(execution.primaryExecutionTimestamp != null
            ? { primaryExecutionTimestamp: execution.primaryExecutionTimestamp }
            : {}),
          ...(execution.requestedExecutionTimestamp != null
            ? {
                requestedExecutionTimestamp:
                  execution.requestedExecutionTimestamp,
              }
            : {}),
          skipReason,
        },
      };
      decision.signal.orderStatus = 'skipped';
      decision.signal.orderSkipReason = skipReason;
    }

    return {
      skipReason,
      executionCandle: null,
      btcExecutionCandle: null,
    };
  }

  const executionPrice = resolveBacktestExecutionPrice(
    candle,
    backtestPriceMode ?? 'open',
  );
  const executionTimestamp = candle.timestamp;
  const takeProfitPrice = decision.entryContext.prices.takeProfitPrice;
  const stopLossPrice = decision.orderPlan.stopLossPrice;
  const riskRatio = calculateRiskRatio({
    direction: decision.entryContext.direction,
    currentPrice: executionPrice,
    takeProfitPrice,
    stopLossPrice,
  });
  const invalidSkipReason = resolveInvalidDelayedEntryReason({
    decision,
    executionPrice,
    takeProfitPrice,
    stopLossPrice,
    riskRatio,
  });

  decision.entryContext = {
    ...decision.entryContext,
    timestamp: executionTimestamp,
    prices: {
      ...decision.entryContext.prices,
      currentPrice: executionPrice,
      stopLossPrice,
      riskRatio,
    },
  };

  const executionResult = {
    skipReason: invalidSkipReason,
    executionCandle: buildBacktestExecutionOnlyCandle(candle, executionPrice),
    btcExecutionCandle: buildBacktestExecutionOnlyCandle(
      btcCandle,
      resolveBacktestExecutionPrice(btcCandle, backtestPriceMode ?? 'open'),
    ),
  };

  if (!decision.signal) {
    return executionResult;
  }

  decision.signal.prices = {
    ...decision.signal.prices,
    currentPrice: executionPrice,
    stopLossPrice,
    riskRatio,
  };
  decision.signal.additionalIndicators = {
    ...(decision.signal.additionalIndicators ?? {}),
    backtestExecution: {
      entryDelayBars: delayBars,
      priceMode: backtestPriceMode ?? 'open',
      signalTimestamp,
      signalPrice,
      executionTimestamp,
      executionPrice,
      executionSource: execution.source,
      ...(execution.executionInterval
        ? { executionInterval: execution.executionInterval }
        : {}),
      ...(execution.executionDelayMs != null
        ? { executionDelayMs: execution.executionDelayMs }
        : {}),
      ...(execution.primaryExecutionTimestamp != null
        ? { primaryExecutionTimestamp: execution.primaryExecutionTimestamp }
        : {}),
      ...(execution.requestedExecutionTimestamp != null
        ? { requestedExecutionTimestamp: execution.requestedExecutionTimestamp }
        : {}),
      ...(invalidSkipReason ? { skipReason: invalidSkipReason } : {}),
    },
  };

  if (invalidSkipReason) {
    decision.signal.orderStatus = 'skipped';
    decision.signal.orderSkipReason = invalidSkipReason;
  }

  return executionResult;
};

const normalizeConfigHookList = <THook extends (...args: any[]) => unknown>(
  value: THook | THook[] | undefined,
): THook[] => {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
};

const isStrategyDecision = (value: unknown): value is StrategyDecision => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === 'skip' || kind === 'entry' || kind === 'exit' || kind === 'protect'
  );
};

const CONFIG_HOOK_STAGES: Array<StrategyHookStage & keyof TradejsConfigHooks> =
  [
    'onInit',
    'onBar',
    'afterCoreDecision',
    'afterBarDecision',
    'onSkip',
    'beforeClosePosition',
    'afterEnrichMl',
    'afterEnrichAi',
    'beforeEntryGate',
    'beforePlaceOrder',
    'afterPlaceOrder',
  ];

const isConfigHookStage = (
  stage: StrategyHookStage,
): stage is StrategyHookStage & keyof TradejsConfigHooks =>
  CONFIG_HOOK_STAGES.includes(
    stage as StrategyHookStage & keyof TradejsConfigHooks,
  );

const buildHookCtx = ({
  connector,
  strategyName,
  userName,
  symbol,
  universe,
  assetClass,
  accountId,
  deploymentId,
  policyProfileId,
  strategyConfig,
  env,
  isConfigFromBacktest,
}: {
  connector: CreateStrategyCoreParams<StrategyConfig>['connector'];
  strategyName: string;
  userName: string;
  symbol: string;
  universe?: StrategyHookCtx['universe'];
  assetClass?: StrategyHookCtx['assetClass'];
  accountId?: string;
  deploymentId?: string;
  policyProfileId?: string;
  strategyConfig: StrategyConfig;
  env: string;
  isConfigFromBacktest: boolean;
}): StrategyHookCtx => ({
  connector,
  strategyName,
  userName,
  symbol,
  ...(universe ? { universe } : {}),
  ...(assetClass ? { assetClass } : {}),
  ...(accountId ? { accountId } : {}),
  ...(deploymentId ? { deploymentId } : {}),
  ...(policyProfileId ? { policyProfileId } : {}),
  strategyConfig,
  env,
  isConfigFromBacktest,
});

const buildHookEntry = ({
  decision,
  runtime,
}: {
  decision: EntryDecision;
  runtime: ResolvedEntryRuntime;
}): StrategyHookEntryContext => ({
  context: decision.entryContext,
  orderPlan: decision.orderPlan,
  signal: decision.signal,
  runtime: {
    raw: decision.runtime,
    resolved: runtime,
  },
});

const buildHookPolicy = ({
  quality,
  makeOrdersEnabled,
  minAiQuality,
}: {
  quality?: number;
  makeOrdersEnabled: boolean;
  minAiQuality: number;
}): StrategyHookPolicyContext => ({
  aiQuality: quality,
  makeOrdersEnabled,
  minAiQuality,
});

const shouldRecordRuntimeJournal = ({
  env,
  config,
}: {
  env: string;
  config: StrategyConfig;
}) =>
  env !== 'BACKTEST' &&
  env !== 'PARITY' &&
  config.RECORD_RUNTIME_TRADES !== false;

const isTestConnector = (
  connector: CreateStrategyCoreParams<StrategyConfig>['connector'],
) =>
  Boolean(
    (connector as unknown as { __tradejsTestConnector?: unknown })
      .__tradejsTestConnector,
  );

const canUseSharedReplayState = ({
  env,
  sharedReplayKey,
}: {
  env: string;
  sharedReplayKey?: string;
}) => (env === 'BACKTEST' || env === 'PARITY') && Boolean(sharedReplayKey);

const buildMlHookContext = ({
  signal,
  env,
  ml,
}: {
  signal: NonNullable<EntryDecision['signal']>;
  env: string;
  ml: ResolvedEntryRuntime['ml'];
}): StrategyHookMlContext => {
  if (env === 'BACKTEST') {
    return {
      config: ml,
      attempted: false,
      applied: false,
      skippedReason: 'BACKTEST',
    };
  }

  if (!ml) {
    return {
      attempted: false,
      applied: false,
      skippedReason: 'NO_RUNTIME',
    };
  }

  if (ml.enabled === false) {
    return {
      config: ml,
      attempted: false,
      applied: false,
      skippedReason: 'DISABLED',
    };
  }

  if (!ml.strategyConfig) {
    return {
      config: ml,
      attempted: false,
      applied: false,
      skippedReason: 'NO_STRATEGY_CONFIG',
    };
  }

  if (typeof ml.mlThreshold !== 'number') {
    return {
      config: ml,
      attempted: false,
      applied: false,
      skippedReason: 'NO_THRESHOLD',
    };
  }

  if (signal.ml) {
    return {
      config: ml,
      attempted: true,
      applied: true,
      result: signal.ml,
    };
  }

  return {
    config: ml,
    attempted: true,
    applied: false,
    skippedReason: 'NO_RESULT',
  };
};

const buildAiHookContext = ({
  env,
  ai,
  quality,
}: {
  env: string;
  ai: ResolvedEntryRuntime['ai'];
  quality?: number;
}): StrategyHookAiContext => {
  if (env === 'BACKTEST') {
    return {
      config: ai,
      attempted: false,
      applied: false,
      skippedReason: 'BACKTEST',
    };
  }

  if (!ai) {
    return {
      attempted: false,
      applied: false,
      skippedReason: 'NO_RUNTIME',
    };
  }

  if (ai.enabled === false) {
    return {
      config: ai,
      attempted: false,
      applied: false,
      skippedReason: 'DISABLED',
    };
  }

  if (typeof quality === 'number') {
    return {
      config: ai,
      attempted: true,
      applied: true,
      quality,
    };
  }

  return {
    config: ai,
    attempted: true,
    applied: false,
    skippedReason: 'NO_QUALITY',
  };
};

const handleExitDecision = async ({
  connector,
  userName,
  strategyName,
  symbol,
  decision,
  market,
  onRuntimeClose,
  onRuntimeError,
}: {
  connector: CreateStrategyCoreParams<StrategyConfig>['connector'];
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

const handleProtectDecision = async ({
  connector,
  symbol,
  decision,
  market,
  onRuntimeError,
}: {
  connector: CreateStrategyCoreParams<StrategyConfig>['connector'];
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

const executeEntryDecision = async ({
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
  connector: CreateStrategyCoreParams<StrategyConfig>['connector'];
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

export const createStrategyRuntime = <TConfig extends StrategyConfig>({
  strategyName,
  defaults,
  createCore,
  manifest: staticManifest,
  strategyDirectory,
  detectorKey,
  detectorNoSignalSkipReason,
}: CreateStrategyRuntimeParams<TConfig>): StrategyCreator => {
  const projectRoot = getTradejsProjectCwd();

  const resolveManifest = (name?: string): StrategyManifest | undefined => {
    if (!name) {
      return undefined;
    }

    if (staticManifest?.name === name) {
      return staticManifest;
    }

    return getStrategyManifest(name, projectRoot);
  };

  const loadPineScriptFile = createPineScriptLoader(
    strategyDirectory
      ? path.resolve(strategyDirectory)
      : path.resolve(
          projectRoot,
          'packages',
          'strategies',
          'src',
          strategyName,
        ),
  );

  const creator: StrategyCreator = async ({
    userName,
    connectorName,
    config: baseConfig,
    symbol,
    universe: requestedUniverse,
    assetClass,
    accountId: requestedAccountId,
    deploymentId: requestedDeploymentId,
    policyProfileId,
    runtimeConfigId,
    runtimeConfigSnapshot,
    data,
    btcData,
    ethData = [],
    btcBinanceData,
    btcCoinbaseData,
    backtestExecutionMarketData,
    connector,
    sharedIndicatorsReplayKey,
    sharedStrategyStateKey,
    onRuntimeClose,
  }) => {
    const { config, isConfigFromBacktest } = await resolveStrategyConfig({
      strategyName,
      userName,
      symbol,
      baseConfig,
      defaults,
      runtimeConfigId,
      runtimeConfigSnapshot,
    });
    const universe = requestedUniverse ?? connector.universe;
    const accountId = requestedAccountId ?? connector.accountId;
    const deploymentId = requestedDeploymentId ?? connector.deploymentId;
    const projectConfig = await loadTradejsConfig(projectRoot);
    const projectHooks = projectConfig.hooks;
    const env = String(config.ENV ?? 'BACKTEST');
    const backtestPriceMode = config.BACKTEST_PRICE_MODE ?? 'open';
    const backtestEntryDelayBars =
      env === 'BACKTEST'
        ? resolveBacktestEntryDelayBars(config.BACKTEST_ENTRY_DELAY_BARS)
        : 0;
    const resolvedBacktestExecutionInterval =
      config.BACKTEST_EXECUTION_INTERVAL ??
      backtestExecutionMarketData?.interval ??
      resolveBacktestExecutionIntervalForPrimary(config.INTERVAL ?? '15');
    const backtestExecutionInterval =
      resolvedBacktestExecutionInterval == null
        ? null
        : String(resolvedBacktestExecutionInterval);
    const backtestExecutionIntervalLabel =
      backtestExecutionInterval == null
        ? undefined
        : String(backtestExecutionInterval);
    const primaryIntervalMs = safeIntervalToMs(config.INTERVAL ?? '15');
    const backtestExecutionIntervalMs = safeIntervalToMs(
      backtestExecutionInterval,
    );
    const backtestExecutionDelayMs = resolveBacktestExecutionDelayMs(
      config.BACKTEST_EXECUTION_DELAY_MS,
      backtestExecutionIntervalMs ?? BACKTEST_EXECUTION_DELAY_MS,
    );
    const backtestExecutionCandleByTimestamp =
      backtestExecutionMarketData?.dataByTimestamp ??
      buildCandleByTimestamp(backtestExecutionMarketData?.data);
    const backtestExecutionBtcCandleByTimestamp =
      backtestExecutionMarketData?.btcDataByTimestamp ??
      buildCandleByTimestamp(backtestExecutionMarketData?.btcData);
    const canUseLowerBacktestExecution =
      env === 'BACKTEST' &&
      backtestEntryDelayBars > 0 &&
      backtestExecutionIntervalMs != null &&
      primaryIntervalMs != null &&
      backtestExecutionIntervalMs < primaryIntervalMs;
    const recordRuntimeJournal = shouldRecordRuntimeJournal({ env, config });
    const strategyManifest = resolveManifest(strategyName);
    const requestedPolicyProfileId =
      policyProfileId ??
      (typeof config.POLICY_PROFILE_ID === 'string'
        ? config.POLICY_PROFILE_ID
        : undefined);
    const getPolicyProfile = (name = strategyName) =>
      resolveStrategyPolicyProfile(resolveManifest(name), {
        profileId: requestedPolicyProfileId,
        universe,
        assetClass,
      });
    const strategyPolicyProfile = getPolicyProfile();
    const indicatorPeriods = buildDefaultIndicatorPeriods(config as any);
    const hookBase = {
      connector,
      strategyName,
      userName,
      symbol,
      universe,
      assetClass,
      accountId,
      deploymentId,
      policyProfileId: strategyPolicyProfile?.id ?? requestedPolicyProfileId,
      strategyConfig: config,
      env,
      isConfigFromBacktest,
    };
    const getHookCtx = (name = strategyName): StrategyHookCtx => {
      const profile = getPolicyProfile(name);
      return buildHookCtx({
        ...hookBase,
        strategyName: name,
        policyProfileId: profile?.id ?? requestedPolicyProfileId,
      });
    };
    const getProjectHookList = (stage: keyof TradejsConfigHooks) =>
      normalizeConfigHookList(projectHooks?.[stage] as any);

    const indicatorReplayKey = JSON.stringify({
      periods: indicatorPeriods,
      universe,
    });
    const sharedReplayEnabled = canUseSharedReplayState({
      env,
      sharedReplayKey: sharedIndicatorsReplayKey,
    });
    const indicatorSharedReplayKey =
      sharedReplayEnabled && sharedIndicatorsReplayKey
        ? `${sharedIndicatorsReplayKey}:indicators:${indicatorReplayKey}`
        : undefined;
    const strategyStateBaseKey =
      env === 'CRON' && sharedStrategyStateKey
        ? sharedStrategyStateKey
        : sharedReplayEnabled
          ? sharedIndicatorsReplayKey
          : undefined;
    const strategySharedReplayKey = strategyStateBaseKey
      ? `${strategyStateBaseKey}:strategy:${strategyName}`
      : undefined;

    const notifyRuntimeError = async ({
      stage,
      error,
      decision,
      entry,
      market,
    }: {
      stage: StrategyHookStage;
      error: unknown;
      decision?: StrategyDecision;
      entry?: StrategyHookEntryContext;
      market?: StrategyHookMarketContext;
    }) => {
      const errorStrategyName =
        decision?.kind === 'entry'
          ? decision.entryContext.strategy
          : strategyName;
      const errorManifest =
        resolveManifest(errorStrategyName) ?? strategyManifest;
      const errorParams = {
        ctx: getHookCtx(errorStrategyName),
        market,
        decision,
        entry,
        error: {
          stage,
          cause: error,
        },
      };

      for (const projectHook of getProjectHookList('onRuntimeError') as Array<
        (params: any) => Promise<void> | void
      >) {
        try {
          await projectHook(errorParams);
        } catch (hookError) {
          logger.error(
            'project hook onRuntimeError failed: %s %s',
            strategyName,
            hookError,
          );
        }
      }

      const onRuntimeError = errorManifest?.hooks?.onRuntimeError;
      if (!onRuntimeError) {
        return;
      }

      try {
        await onRuntimeError(errorParams);
      } catch (hookError) {
        logger.error(
          'runtime hook onRuntimeError failed: %s %s',
          strategyName,
          hookError,
        );
      }
    };

    const invokeHook = async <TReturn = unknown>(
      stage: StrategyHookStage,
      hook: ((params: any) => Promise<TReturn> | TReturn) | undefined,
      params: any,
      errorContext: {
        decision?: StrategyDecision;
        entry?: StrategyHookEntryContext;
        market?: StrategyHookMarketContext;
      } = {},
    ): Promise<TReturn | undefined> => {
      if (!hook) {
        return undefined;
      }

      try {
        return await hook(params);
      } catch (error) {
        logger.error(
          'strategy hook "%s" failed for %s: %s',
          stage,
          strategyName,
          error,
        );
        await notifyRuntimeError({
          stage,
          error,
          decision: errorContext.decision,
          entry: errorContext.entry,
          market: errorContext.market,
        });
        return undefined;
      }
    };

    const invokeProjectHooks = async <TReturn = unknown>(
      stage: StrategyHookStage & keyof TradejsConfigHooks,
      params: any,
      errorContext: {
        decision?: StrategyDecision;
        entry?: StrategyHookEntryContext;
        market?: StrategyHookMarketContext;
      } = {},
    ): Promise<TReturn[]> => {
      const results: TReturn[] = [];

      for (const hook of getProjectHookList(stage) as Array<
        (hookParams: any) => Promise<TReturn> | TReturn
      >) {
        const result = await invokeHook<TReturn>(
          stage,
          hook,
          params,
          errorContext,
        );
        if (result !== undefined) {
          results.push(result);
        }
      }

      return results;
    };

    const invokeStageHooks = async <TReturn = unknown>(
      stage: StrategyHookStage,
      hook: ((params: any) => Promise<TReturn> | TReturn) | undefined,
      params: any,
      errorContext: {
        decision?: StrategyDecision;
        entry?: StrategyHookEntryContext;
        market?: StrategyHookMarketContext;
      } = {},
    ): Promise<TReturn | undefined> => {
      if (isConfigHookStage(stage)) {
        await invokeProjectHooks<TReturn>(stage, params, errorContext);
      }
      return invokeHook(stage, hook, params, errorContext);
    };

    const invokeGateHooks = async (
      stage: 'beforeClosePosition' | 'beforeEntryGate',
      hook:
        | ((
            params: any,
          ) =>
            | Promise<StrategyHookGateResult | void>
            | StrategyHookGateResult
            | void)
        | undefined,
      params: any,
      errorContext: {
        decision?: StrategyDecision;
        entry?: StrategyHookEntryContext;
        market?: StrategyHookMarketContext;
      } = {},
    ): Promise<StrategyHookGateResult | void> => {
      const projectResults =
        await invokeProjectHooks<StrategyHookGateResult | void>(
          stage,
          params,
          errorContext,
        );
      const projectBlock = projectResults.find(
        (result) => result?.allow === false,
      );
      if (projectBlock?.allow === false) {
        return projectBlock;
      }

      return invokeHook<StrategyHookGateResult | void>(
        stage,
        hook,
        params,
        errorContext,
      );
    };

    const applyProjectAfterCoreDecisionHooks = async ({
      hookCtx,
      market,
      decision,
    }: {
      hookCtx: StrategyHookCtx;
      market: HookCandleMarket;
      decision: StrategyDecision;
    }): Promise<StrategyDecision> => {
      let nextDecision = decision;

      for (const hook of getProjectHookList(
        'afterCoreDecision',
      ) as TradejsConfigAfterCoreDecisionHook[]) {
        const result = await invokeHook<StrategyDecision | void>(
          'afterCoreDecision',
          hook,
          {
            ctx: hookCtx,
            market,
            decision: nextDecision,
          },
          {
            decision: nextDecision,
            market,
          },
        );

        if (isStrategyDecision(result)) {
          nextDecision = result;
        }
      }

      return nextDecision;
    };

    const applyProjectAfterBarDecisionHooks = async ({
      hookCtx,
      market,
      decision,
    }: {
      hookCtx: StrategyHookCtx;
      market: HookCandleMarket;
      decision: StrategyDecision;
    }): Promise<StrategyDecision> => {
      let nextDecision = decision;

      for (const hook of getProjectHookList(
        'afterBarDecision',
      ) as TradejsConfigAfterBarDecisionHook[]) {
        const result = await invokeHook<StrategyDecision | void>(
          'afterBarDecision',
          hook,
          {
            ctx: hookCtx,
            market,
            decision: nextDecision,
          },
          {
            decision: nextDecision,
            market,
          },
        );

        if (isStrategyDecision(result)) {
          nextDecision = result;
        }
      }

      return nextDecision;
    };

    const applyProjectOnBarHooks = async ({
      hookCtx,
      market,
    }: {
      hookCtx: StrategyHookCtx;
      market: HookCandleMarket;
    }): Promise<StrategyDecision | undefined> => {
      for (const hook of getProjectHookList(
        'onBar',
      ) as TradejsConfigOnBarHook[]) {
        const result = await invokeHook<StrategyDecision | void>(
          'onBar',
          hook,
          {
            ctx: hookCtx,
            market,
          },
          {
            market,
          },
        );

        if (isStrategyDecision(result)) {
          return result;
        }
      }

      return undefined;
    };

    const indicatorsState = createStrategyIndicatorsState({
      env,
      data,
      btcData,
      ethData,
      btcBinanceData,
      btcCoinbaseData,
      periods: indicatorPeriods,
      pluginRegistryScope: projectRoot,
      sharedReplayKey: indicatorSharedReplayKey,
      useBtcReference: universe === 'crypto',
    });
    const strategyApi = createStrategyAPI({
      strategy: strategyName as any,
      symbol,
      interval: (config.INTERVAL ?? '15') as any,
      env,
      connector,
      cachedData: data,
      indicatorsState,
      isConfigFromBacktest,
      sharedReplayKey: strategySharedReplayKey,
      getSharedReplayState: getSharedStrategyReplayState,
    });

    const core = await createCore({
      userName,
      symbol,
      config,
      isConfigFromBacktest,
      connector,
      data,
      btcData,
      ethData,
      loadPineScriptFile,
      strategyApi,
      indicatorsState,
      sharedReplayKey: strategySharedReplayKey,
      getSharedReplayState: getSharedStrategyReplayState,
    });

    await invokeStageHooks('onInit', strategyManifest?.hooks?.onInit, {
      ctx: getHookCtx(),
      market: {
        data,
        btcData,
      },
    });

    const appendCurrentMarketData = (
      candle: Parameters<Awaited<ReturnType<typeof createCore>>>[0],
      btcCandle: Parameters<Awaited<ReturnType<typeof createCore>>>[1],
      ethCandle?: KlineChartItem,
    ) => {
      if (data[data.length - 1]?.timestamp !== candle.timestamp) {
        data.push(candle);
      }
      if (
        universe === 'crypto' &&
        btcData[btcData.length - 1]?.timestamp !== btcCandle.timestamp
      ) {
        btcData.push(btcCandle);
      }
      if (
        universe === 'crypto' &&
        ethCandle &&
        ethData[ethData.length - 1]?.timestamp !== ethCandle.timestamp
      ) {
        ethData.push(ethCandle);
      }
    };
    const resolveEthCandle = (
      candle: Parameters<Awaited<ReturnType<typeof createCore>>>[0],
      ethCandle?: KlineChartItem,
    ) => {
      if (ethCandle?.timestamp === candle.timestamp) {
        return ethCandle;
      }

      const alignedEthCandle = ethData[data.length - 1];
      if (alignedEthCandle?.timestamp === candle.timestamp) {
        return alignedEthCandle;
      }

      const latestEthCandle = ethData[ethData.length - 1];
      if (latestEthCandle?.timestamp === candle.timestamp) {
        return latestEthCandle;
      }

      return undefined;
    };
    const resolveBacktestExecutionCandle = (
      candle: KlineChartItem,
      btcCandle: KlineChartItem,
    ): BacktestExecutionCandleResolution => {
      if (!BACKTEST_LOWER_TIMEFRAME_EXECUTION_ENABLED) {
        return {
          candle,
          btcCandle,
          source: 'primary_timeframe',
          requestedExecutionTimestamp: candle.timestamp,
          executionInterval: String(config.INTERVAL ?? '15'),
          executionDelayMs: 0,
          primaryExecutionTimestamp: candle.timestamp,
        };
      }

      const requestedExecutionTimestamp =
        candle.timestamp + backtestExecutionDelayMs;
      const primaryExecutionTimestamp = candle.timestamp;

      if (!canUseLowerBacktestExecution || primaryIntervalMs == null) {
        return {
          source: 'lower_timeframe',
          requestedExecutionTimestamp,
          executionInterval: backtestExecutionIntervalLabel,
          executionDelayMs: backtestExecutionDelayMs,
          primaryExecutionTimestamp,
          skipReason: 'BACKTEST_LOWER_EXECUTION_UNAVAILABLE',
        };
      }

      if (requestedExecutionTimestamp >= candle.timestamp + primaryIntervalMs) {
        return {
          source: 'lower_timeframe',
          requestedExecutionTimestamp,
          executionInterval: backtestExecutionIntervalLabel,
          executionDelayMs: backtestExecutionDelayMs,
          primaryExecutionTimestamp,
          skipReason: 'BACKTEST_LOWER_EXECUTION_DELAY_OUT_OF_BAR',
        };
      }

      const lowerCandle = backtestExecutionCandleByTimestamp.get(
        requestedExecutionTimestamp,
      );
      const lowerBtcCandle = backtestExecutionBtcCandleByTimestamp.get(
        requestedExecutionTimestamp,
      );
      if (lowerCandle && lowerBtcCandle) {
        return {
          candle: lowerCandle,
          btcCandle: lowerBtcCandle,
          source: 'lower_timeframe',
          requestedExecutionTimestamp,
          executionInterval: backtestExecutionIntervalLabel,
          executionDelayMs: backtestExecutionDelayMs,
          primaryExecutionTimestamp,
        };
      }

      return {
        source: 'lower_timeframe',
        requestedExecutionTimestamp,
        executionInterval: backtestExecutionIntervalLabel,
        executionDelayMs: backtestExecutionDelayMs,
        primaryExecutionTimestamp,
        skipReason: !lowerCandle
          ? 'BACKTEST_LOWER_EXECUTION_CANDLE_MISSING'
          : 'BACKTEST_LOWER_EXECUTION_BTC_CANDLE_MISSING',
      };
    };
    let pendingBacktestEntry: PendingBacktestEntry | null = null;
    const flushPendingBacktestEntry = async (
      candle: Parameters<Awaited<ReturnType<typeof createCore>>>[0],
      btcCandle: Parameters<Awaited<ReturnType<typeof createCore>>>[1],
      ethCandle?: KlineChartItem,
    ) => {
      if (!pendingBacktestEntry) {
        return undefined;
      }

      appendCurrentMarketData(candle, btcCandle, ethCandle);
      const resolvedEthCandle = resolveEthCandle(candle, ethCandle);
      indicatorsState.setCurrentBar(candle, btcCandle, resolvedEthCandle);
      pendingBacktestEntry.delayBarsRemaining -= 1;

      if (pendingBacktestEntry.delayBarsRemaining > 0) {
        return `BACKTEST_ENTRY_DELAY_PENDING:${pendingBacktestEntry.delayBarsRemaining}`;
      }

      const pending = pendingBacktestEntry;
      pendingBacktestEntry = null;
      const executionCandleResolution = resolveBacktestExecutionCandle(
        candle,
        btcCandle,
      );
      const execution = applyBacktestDelayedEntryExecution({
        decision: pending.decision,
        execution: executionCandleResolution,
        backtestPriceMode:
          executionCandleResolution.source === 'primary_timeframe'
            ? 'open'
            : backtestPriceMode,
        delayBars: pending.delayBars,
      });

      if (execution.skipReason) {
        return pending.decision.signal ?? execution.skipReason;
      }
      if (!execution.executionCandle || !execution.btcExecutionCandle) {
        return (
          pending.decision.signal ?? 'BACKTEST_LOWER_EXECUTION_CANDLE_MISSING'
        );
      }

      const market: HookCandleMarket = {
        candle: execution.executionCandle,
        btcCandle: execution.btcExecutionCandle,
      };
      const entry = buildHookEntry({
        decision: pending.decision,
        runtime: pending.runtime,
      });

      return executeEntryDecision({
        connector,
        symbol,
        decision: pending.decision,
        runtime: pending.runtime,
        manifest: pending.manifest,
        hookCtx: pending.hookCtx,
        market,
        entry,
        policy: pending.policy,
        ml: pending.ml,
        ai: pending.ai,
        recordRuntimeJournal,
        invokeStageHooks,
        notifyRuntimeError,
      });
    };

    const runWithDecisionOverride = async (
      candle: Parameters<Awaited<ReturnType<typeof createCore>>>[0],
      btcCandle: Parameters<Awaited<ReturnType<typeof createCore>>>[1],
      options: {
        ethCandle?: KlineChartItem;
        coreDecisionOverride?: StrategyDecision;
      } = {},
    ) => {
      appendCurrentMarketData(candle, btcCandle, options.ethCandle);
      const ethCandle = resolveEthCandle(candle, options.ethCandle);
      indicatorsState.setCurrentBar(candle, btcCandle, ethCandle);
      const delayedEntrySignal = await flushPendingBacktestEntry(
        candle,
        btcCandle,
        ethCandle,
      );
      if (delayedEntrySignal) {
        return delayedEntrySignal;
      }
      const market: HookCandleMarket = {
        candle,
        btcCandle,
      };
      const onBarHookCtx = getHookCtx();
      const projectOnBarDecision = await applyProjectOnBarHooks({
        hookCtx: onBarHookCtx,
        market,
      });

      let decision: StrategyDecision;
      let shouldInvokeAfterCoreDecisionHook = false;

      if (projectOnBarDecision) {
        decision = projectOnBarDecision;
      } else {
        const manifestOnBarDecision = await invokeHook<StrategyDecision | void>(
          'onBar',
          strategyManifest?.hooks?.onBar,
          {
            ctx: onBarHookCtx,
            market,
          },
          { market },
        );

        if (isStrategyDecision(manifestOnBarDecision)) {
          decision = manifestOnBarDecision;
        } else {
          decision =
            options.coreDecisionOverride ?? (await core(candle, btcCandle));
          shouldInvokeAfterCoreDecisionHook = true;
        }
      }

      if (shouldInvokeAfterCoreDecisionHook) {
        const initialDecisionStrategyName =
          decision.kind === 'entry'
            ? decision.entryContext.strategy
            : strategyName;
        decision = await applyProjectAfterCoreDecisionHooks({
          hookCtx: getHookCtx(initialDecisionStrategyName),
          market,
          decision,
        });
      }

      const initialAfterBarDecisionStrategyName =
        decision.kind === 'entry'
          ? decision.entryContext.strategy
          : strategyName;
      decision = await applyProjectAfterBarDecisionHooks({
        hookCtx: getHookCtx(initialAfterBarDecisionStrategyName),
        market,
        decision,
      });

      const decisionStrategyName =
        decision.kind === 'entry'
          ? decision.entryContext.strategy
          : strategyName;
      const decisionManifest =
        resolveManifest(decisionStrategyName) ?? strategyManifest;
      const decisionHookCtx = getHookCtx(decisionStrategyName);

      if (shouldInvokeAfterCoreDecisionHook) {
        await invokeHook(
          'afterCoreDecision',
          decisionManifest?.hooks?.afterCoreDecision,
          {
            ctx: decisionHookCtx,
            market,
            decision,
          },
          { decision, market },
        );
      }

      await invokeHook(
        'afterBarDecision',
        decisionManifest?.hooks?.afterBarDecision,
        {
          ctx: decisionHookCtx,
          market,
          decision,
        },
        { decision, market },
      );

      if (decision.kind === 'skip') {
        await invokeStageHooks(
          'onSkip',
          decisionManifest?.hooks?.onSkip,
          {
            ctx: decisionHookCtx,
            market,
            decision,
          },
          { decision, market },
        );
        return decision.code;
      }

      const rawMakeOrdersEnabled =
        typeof config.MAKE_ORDERS === 'boolean' ? config.MAKE_ORDERS : true;
      const makeOrdersEnabled =
        rawMakeOrdersEnabled &&
        (env !== 'PARITY' || isTestConnector(connector));

      if (decision.kind === 'exit') {
        if (!makeOrdersEnabled) {
          return decision.code;
        }
        const closeGate = await invokeGateHooks(
          'beforeClosePosition',
          decisionManifest?.hooks?.beforeClosePosition,
          {
            ctx: decisionHookCtx,
            market,
            decision,
          },
          { decision, market },
        );

        if (closeGate?.allow === false) {
          return closeGate.reason
            ? `CLOSE_BLOCKED_BY_HOOK:${closeGate.reason}`
            : 'CLOSE_BLOCKED_BY_HOOK';
        }

        return handleExitDecision({
          connector,
          userName: recordRuntimeJournal ? userName : undefined,
          strategyName,
          symbol,
          decision,
          market,
          onRuntimeClose,
          onRuntimeError: async ({
            stage,
            error,
            decision: exitDecision,
            market: errorMarket,
          }) => {
            await notifyRuntimeError({
              stage,
              error,
              decision: exitDecision,
              market: errorMarket,
            });
          },
        });
      }

      if (decision.kind === 'protect') {
        if (!makeOrdersEnabled) {
          return decision.code;
        }

        return handleProtectDecision({
          connector,
          symbol,
          decision,
          market,
          onRuntimeError: async ({
            stage,
            error,
            decision: protectDecision,
            market: errorMarket,
          }) => {
            await notifyRuntimeError({
              stage,
              error,
              decision: protectDecision,
              market: errorMarket,
            });
          },
        });
      }

      const runtime = resolveEntryRuntimePolicy({
        decision,
        config,
        manifest: decisionManifest,
        policyProfile: getPolicyProfile(decisionStrategyName),
      });
      const signal = decision.signal;
      if (signal) {
        if (universe) signal.universe = universe;
        if (assetClass) signal.assetClass = assetClass;
        if (accountId) signal.accountId = accountId;
        if (deploymentId) signal.deploymentId = deploymentId;
        if (runtimeConfigId) {
          signal.runtimeConfigId = runtimeConfigId;
          if (runtimeConfigId !== 'config') {
            signal.signalId = `${signal.signalId}:${runtimeConfigId}`;
          }
        }
        if (decisionHookCtx.policyProfileId) {
          signal.policyProfileId = decisionHookCtx.policyProfileId;
        }
      }
      const entry = buildHookEntry({
        decision,
        runtime,
      });
      let ml: StrategyHookMlContext | undefined;

      if (signal) {
        try {
          await enrichSignalWithMl({
            signal,
            env,
            ml: runtime.ml,
          });
        } catch (error) {
          await notifyRuntimeError({
            stage: 'enrichSignalWithMl',
            error,
            decision,
            entry,
            market,
          });
          throw error;
        }
        ml = buildMlHookContext({
          signal,
          env,
          ml: runtime.ml,
        });

        await invokeStageHooks(
          'afterEnrichMl',
          decisionManifest?.hooks?.afterEnrichMl,
          {
            ctx: decisionHookCtx,
            market,
            decision,
            entry,
            ml,
          },
          { decision, entry, market },
        );
      }

      let quality: number | undefined;
      let ai: StrategyHookAiContext | undefined;
      if (signal) {
        try {
          await enrichSignalWithBinanceMarketContext({
            signal,
            env,
          });
          await enrichSignalWithCoinMarketCapContext({
            signal,
            env,
          });
          await enrichSignalWithDerivativesContext({
            signal,
            env,
          });
          quality = await enrichSignalWithAi({
            signal,
            userName,
            symbol,
            direction: signal.direction,
            env,
            ai: runtime.ai,
          });
        } catch (error) {
          await notifyRuntimeError({
            stage: 'enrichSignalWithAi',
            error,
            decision,
            entry,
            market,
          });
          throw error;
        }
        ai = buildAiHookContext({
          env,
          ai: runtime.ai,
          quality,
        });

        await invokeStageHooks(
          'afterEnrichAi',
          decisionManifest?.hooks?.afterEnrichAi,
          {
            ctx: decisionHookCtx,
            market,
            decision,
            entry,
            ml: ml ?? buildMlHookContext({ signal, env, ml: runtime.ml }),
            ai,
          },
          { decision, entry, market },
        );
      }

      const minAiQuality = runtime.ai?.minQuality ?? 4;
      const aiEnabled = runtime.ai?.enabled !== false && runtime.ai != null;
      const policy = buildHookPolicy({
        quality,
        makeOrdersEnabled,
        minAiQuality,
      });
      const shouldMakeOrder = shouldExecuteEntryDecision({
        makeOrdersEnabled,
        env,
        signal,
        ml,
        aiEnabled,
        quality,
        minAiQuality,
      });

      if (!shouldMakeOrder) {
        if (signal) {
          signal.orderStatus = 'skipped';
          signal.orderSkipReason = getEntrySkipReason({
            makeOrdersEnabled,
            env,
            ml,
            aiEnabled,
            quality,
            minAiQuality,
          });
        }
        return signal ?? decision.code;
      }

      const entryGate = await invokeGateHooks(
        'beforeEntryGate',
        decisionManifest?.hooks?.beforeEntryGate,
        {
          ctx: decisionHookCtx,
          market,
          decision,
          entry,
          policy,
          ml,
          ai,
        },
        { decision, entry, market },
      );
      if (entryGate?.allow === false) {
        const skipReason = entryGate.reason
          ? `HOOK_BEFORE_ENTRY_GATE:${entryGate.reason}`
          : 'HOOK_BEFORE_ENTRY_GATE';
        if (signal) {
          signal.orderStatus = 'skipped';
          signal.orderSkipReason = skipReason;
        }
        return signal ?? skipReason;
      }

      if (backtestEntryDelayBars > 0) {
        pendingBacktestEntry = {
          delayBars: backtestEntryDelayBars,
          delayBarsRemaining: backtestEntryDelayBars,
          decision,
          runtime,
          manifest: decisionManifest,
          hookCtx: decisionHookCtx,
          policy,
          ml,
          ai,
        };
        return `BACKTEST_ENTRY_DELAY_QUEUED:${backtestEntryDelayBars}`;
      }

      return executeEntryDecision({
        connector,
        symbol,
        decision,
        runtime,
        manifest: decisionManifest,
        hookCtx: decisionHookCtx,
        market,
        entry,
        policy,
        ml,
        ai,
        recordRuntimeJournal,
        invokeStageHooks,
        notifyRuntimeError,
      });
    };

    const strategy = (async (
      candle: KlineChartItem,
      btcCandle: KlineChartItem,
      ethCandle?: KlineChartItem,
    ) => runWithDecisionOverride(candle, btcCandle, { ethCandle })) as any;
    strategy.__tradejsUpdateReferenceData = (params: {
      btcBinanceData?: KlineChartData;
      btcCoinbaseData?: KlineChartData;
    }) => indicatorsState.updateReferenceData?.(params);
    strategy.__tradejsFlushBacktestDelayedEntry = flushPendingBacktestEntry;

    const resolvedDetectorKey = detectorKey?.(config);
    if (resolvedDetectorKey && detectorNoSignalSkipReason) {
      const canFastAdvanceDetectorNoSignal =
        env === 'BACKTEST' &&
        getProjectHookList('onBar').length === 0 &&
        getProjectHookList('afterCoreDecision').length === 0 &&
        getProjectHookList('afterBarDecision').length === 0 &&
        getProjectHookList('onSkip').length === 0 &&
        !strategyManifest?.hooks?.onBar &&
        !strategyManifest?.hooks?.afterCoreDecision &&
        !strategyManifest?.hooks?.afterBarDecision &&
        !strategyManifest?.hooks?.onSkip;
      strategy.detectorFanoutKey = [strategyName, resolvedDetectorKey].join(
        ':',
      );
      strategy.detectorNoSignalSkipReason = detectorNoSignalSkipReason;
      strategy.canFastAdvanceDetectorNoSignal = canFastAdvanceDetectorNoSignal;
      if (canFastAdvanceDetectorNoSignal) {
        strategy.advanceDetectorNoSignal = (
          candle: KlineChartItem,
          btcCandle: KlineChartItem,
          code: string,
        ) => {
          appendCurrentMarketData(candle, btcCandle);
          indicatorsState.setCurrentBar(
            candle,
            btcCandle,
            resolveEthCandle(candle),
          );
          return Promise.resolve(code);
        };
      }
      strategy.skipDetectorNoSignal = (
        candle: KlineChartItem,
        btcCandle: KlineChartItem,
        code: string,
      ) =>
        runWithDecisionOverride(candle, btcCandle, {
          coreDecisionOverride: strategyApi.skip(code),
        });
    }

    return strategy;
  };

  if (detectorKey) {
    creator.detectorKey = detectorKey as StrategyCreator['detectorKey'];
  }
  if (detectorNoSignalSkipReason) {
    creator.detectorNoSignalSkipReason = detectorNoSignalSkipReason;
  }

  return creator;
};
