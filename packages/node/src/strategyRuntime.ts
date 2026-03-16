import path from 'node:path';
import { SIGNALS_PRELOAD_DAYS } from '@tradejs/core/constants';
import {
  buildDefaultIndicatorPeriods,
  createStrategyAPI,
  createStrategyIndicatorsState,
} from '@tradejs/core/strategies';
import { getTimestamp } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';
import {
  enrichSignalWithAi,
  enrichSignalWithMl,
  executeEntryOrder,
} from './strategyHelpers/runtime';
import { createLoadPineScript } from './pine';
import { getStrategyManifest } from './strategy/manifests';
import { getTradejsProjectCwd } from './tradejsConfig';
import { resolveStrategyConfig } from './strategyHelpers/config';
import {
  CreateStrategyCore,
  CreateStrategyCoreParams,
  KlineChartItem,
  StrategyHookGateResult,
  StrategyHookStage,
  StrategyManifest,
  StrategyConfig,
  StrategyCreator,
  StrategyDecision,
} from '@tradejs/types';

interface CreateStrategyRuntimeParams<TConfig extends StrategyConfig> {
  strategyName: string;
  defaults: TConfig;
  createCore: CreateStrategyCore<TConfig, any, any>;
  manifest?: StrategyManifest;
  strategyDirectory?: string;
}

type EntryDecision = Extract<StrategyDecision, { kind: 'entry' }>;
type ExitDecision = Extract<StrategyDecision, { kind: 'exit' }>;

const resolveEntryRuntimePolicy = ({
  decision,
  config,
  manifest,
}: {
  decision: EntryDecision;
  config: StrategyConfig;
  manifest?: StrategyManifest;
}) => {
  const manifestDefaults = manifest?.entryRuntimeDefaults;
  const adapterMl = manifest?.mlAdapter?.mapEntryRuntimeFromConfig?.(config);
  const adapterAi = manifest?.aiAdapter?.mapEntryRuntimeFromConfig?.(config);
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

const shouldExecuteEntryDecision = ({
  makeOrdersEnabled,
  env,
  signal,
  quality,
  minAiQuality,
}: {
  makeOrdersEnabled: boolean;
  env: string;
  signal?: EntryDecision['signal'];
  quality?: number;
  minAiQuality: number;
}) =>
  makeOrdersEnabled &&
  (!signal || env === 'BACKTEST' || quality == null || quality >= minAiQuality);

const getEntrySkipReason = ({
  makeOrdersEnabled,
  env,
  quality,
  minAiQuality,
}: {
  makeOrdersEnabled: boolean;
  env: string;
  quality?: number;
  minAiQuality: number;
}): string => {
  if (!makeOrdersEnabled) {
    return 'MAKE_ORDERS_DISABLED';
  }

  if (
    env !== 'BACKTEST' &&
    quality != null &&
    Number.isFinite(quality) &&
    quality < minAiQuality
  ) {
    return `AI_QUALITY_BELOW_MIN (${quality} < ${minAiQuality})`;
  }

  return 'ENTRY_POLICY_BLOCKED';
};

const handleExitDecision = async ({
  connector,
  symbol,
  decision,
  onRuntimeError,
}: {
  connector: CreateStrategyCoreParams<StrategyConfig>['connector'];
  symbol: string;
  decision: ExitDecision;
  onRuntimeError?: (params: {
    stage: string;
    error: unknown;
    decision: ExitDecision;
  }) => Promise<void>;
}) => {
  try {
    await connector.closePosition({
      symbol,
      price: decision.closePlan.price,
      timestamp: decision.closePlan.timestamp,
      direction: decision.closePlan.direction,
    });
  } catch (err) {
    await onRuntimeError?.({
      stage: 'closePosition',
      error: err,
      decision,
    });
    logger.error('close order error: %s %s', symbol, err);
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
  hookBase,
  invokeHook,
  notifyRuntimeError,
}: {
  connector: CreateStrategyCoreParams<StrategyConfig>['connector'];
  symbol: string;
  decision: EntryDecision;
  runtime: ReturnType<typeof resolveEntryRuntimePolicy>;
  manifest?: StrategyManifest;
  hookBase: {
    connector: CreateStrategyCoreParams<StrategyConfig>['connector'];
    strategyName: string;
    userName: string;
    symbol: string;
    config: StrategyConfig;
    env: string;
    isConfigFromBacktest: boolean;
  };
  invokeHook: <TReturn = unknown>(
    stage: string,
    hook: ((params: any) => Promise<TReturn> | TReturn) | undefined,
    params: any,
    errorContext?: {
      decision?: StrategyDecision;
      signal?: EntryDecision['signal'];
    },
  ) => Promise<TReturn | undefined>;
  notifyRuntimeError: (params: {
    stage: string;
    error: unknown;
    decision?: StrategyDecision;
    signal?: EntryDecision['signal'];
  }) => Promise<void>;
}) => {
  const signal = decision.signal;
  const beforePlaceOrder = async () => {
    await invokeHook(
      'beforePlaceOrder',
      manifest?.hooks?.beforePlaceOrder,
      {
        ...hookBase,
        entryContext: decision.entryContext,
        runtime,
        decision,
        signal,
      },
      { decision, signal },
    );
    try {
      await runtime.beforePlaceOrder?.();
    } catch (error) {
      await notifyRuntimeError({
        stage: 'runtime.beforePlaceOrder',
        error,
        decision,
        signal,
      });
      throw error;
    }
  };
  try {
    if (signal) {
      await executeEntryOrder({
        connector,
        symbol,
        direction: decision.entryContext.direction,
        qty: decision.orderPlan.qty,
        currentPrice: decision.entryContext.prices.currentPrice,
        timestamp: decision.entryContext.timestamp,
        takeProfits: decision.orderPlan.takeProfits,
        stopLossPrice: decision.orderPlan.stopLossPrice,
        signal,
        beforePlaceOrder,
      });
      await invokeHook(
        'afterPlaceOrder',
        manifest?.hooks?.afterPlaceOrder,
        {
          ...hookBase,
          decision,
          runtime,
          signal,
          orderResult: signal,
        },
        { decision, signal },
      );
      return signal;
    }

    await beforePlaceOrder();
    await connector.placeOrder(
      {
        symbol,
        qty: decision.orderPlan.qty,
        price: decision.entryContext.prices.currentPrice,
        timestamp: decision.entryContext.timestamp,
        direction: decision.entryContext.direction,
      },
      decision.orderPlan.takeProfits,
      decision.orderPlan.stopLossPrice,
    );

    await invokeHook(
      'afterPlaceOrder',
      manifest?.hooks?.afterPlaceOrder,
      {
        ...hookBase,
        decision,
        runtime,
        signal,
        orderResult: decision.code,
      },
      { decision, signal },
    );
  } catch (err) {
    if (signal) {
      signal.orderStatus = 'failed';
    }
    await notifyRuntimeError({
      stage: 'placeOrder',
      error: err,
      decision,
      signal,
    });
    logger.error('order error: %s %s', symbol, err);
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

  const loadPineScript = createLoadPineScript(
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

  return async ({
    userName,
    config: baseConfig,
    symbol,
    data,
    btcData,
    btcBinanceData,
    btcCoinbaseData,
    connector,
  }) => {
    const { config, isConfigFromBacktest } = await resolveStrategyConfig({
      strategyName,
      userName,
      symbol,
      baseConfig,
      defaults,
    });
    const env = String(config.ENV ?? 'BACKTEST');
    const strategyManifest = resolveManifest(strategyName);
    const hookBase = {
      connector,
      strategyName,
      userName,
      symbol,
      config,
      env,
      isConfigFromBacktest,
    };

    const notifyRuntimeError = async ({
      stage,
      error,
      decision,
      signal,
    }: {
      stage: string;
      error: unknown;
      decision?: StrategyDecision;
      signal?: EntryDecision['signal'];
    }) => {
      const errorStrategyName =
        decision?.kind === 'entry'
          ? decision.entryContext.strategy
          : strategyName;
      const errorManifest =
        resolveManifest(errorStrategyName) ?? strategyManifest;
      const errorHookBase = {
        ...hookBase,
        strategyName: errorStrategyName,
      };
      const onRuntimeError = errorManifest?.hooks?.onRuntimeError;
      if (!onRuntimeError) {
        return;
      }

      try {
        await onRuntimeError({
          ...errorHookBase,
          stage,
          error,
          decision,
          signal,
        });
      } catch (hookError) {
        logger.error(
          'runtime hook onRuntimeError failed: %s %s',
          strategyName,
          hookError,
        );
      }
    };

    const invokeHook = async <TReturn = unknown>(
      stage: string,
      hook: ((params: any) => Promise<TReturn> | TReturn) | undefined,
      params: any,
      errorContext: {
        decision?: StrategyDecision;
        signal?: EntryDecision['signal'];
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
          signal: errorContext.signal,
        });
        return undefined;
      }
    };

    const indicatorsState = createStrategyIndicatorsState({
      env,
      data,
      btcData,
      btcBinanceData,
      btcCoinbaseData,
      periods: buildDefaultIndicatorPeriods(config as any),
      pluginRegistryScope: projectRoot,
    });
    const strategyApi = createStrategyAPI({
      strategy: strategyName as any,
      symbol,
      interval: (config.INTERVAL ?? '15') as any,
      env,
      connector,
      cachedData: data,
      indicatorsState,
      preloadStart: getTimestamp(SIGNALS_PRELOAD_DAYS),
      backtestPriceMode: config.BACKTEST_PRICE_MODE,
      isConfigFromBacktest,
    });

    const core = await createCore({
      userName,
      symbol,
      config,
      isConfigFromBacktest,
      connector,
      data,
      btcData,
      loadPineScript,
      strategyApi,
      indicatorsState,
    });

    await invokeHook('onInit', strategyManifest?.hooks?.onInit, {
      ...hookBase,
      data,
      btcData,
    });

    return async (candle, btcCandle) => {
      data.push(candle);
      btcData.push(btcCandle);
      indicatorsState.setCurrentBar(candle, btcCandle);

      const decision = await core(candle, btcCandle);
      const decisionStrategyName =
        decision.kind === 'entry'
          ? decision.entryContext.strategy
          : strategyName;
      const decisionManifest =
        resolveManifest(decisionStrategyName) ?? strategyManifest;
      const decisionHookBase = {
        ...hookBase,
        strategyName: decisionStrategyName,
      };

      await invokeHook(
        'afterCoreDecision',
        decisionManifest?.hooks?.afterCoreDecision,
        {
          ...decisionHookBase,
          decision,
          candle,
          btcCandle,
        },
        { decision },
      );

      if (decision.kind === 'skip') {
        await invokeHook('onSkip', decisionManifest?.hooks?.onSkip, {
          ...decisionHookBase,
          decision,
          candle,
          btcCandle,
        });
        return decision.code;
      }

      const makeOrdersEnabled =
        typeof config.MAKE_ORDERS === 'boolean' ? config.MAKE_ORDERS : true;

      if (decision.kind === 'exit') {
        if (!makeOrdersEnabled) {
          return decision.code;
        }
        const closeGate = await invokeHook<StrategyHookGateResult | void>(
          'beforeClosePosition',
          decisionManifest?.hooks?.beforeClosePosition,
          {
            ...decisionHookBase,
            decision,
          },
          { decision },
        );

        if (closeGate?.allow === false) {
          return closeGate.reason
            ? `CLOSE_BLOCKED_BY_HOOK:${closeGate.reason}`
            : 'CLOSE_BLOCKED_BY_HOOK';
        }

        return handleExitDecision({
          connector,
          symbol,
          decision,
          onRuntimeError: async ({ stage, error, decision: exitDecision }) => {
            await notifyRuntimeError({
              stage,
              error,
              decision: exitDecision,
            });
          },
        });
      }

      const runtime = resolveEntryRuntimePolicy({
        decision,
        config,
        manifest: decisionManifest,
      });
      const signal = decision.signal;

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
            signal,
          });
          throw error;
        }

        await invokeHook(
          'afterEnrichMl',
          decisionManifest?.hooks?.afterEnrichMl,
          {
            ...decisionHookBase,
            decision,
            runtime,
            signal,
          },
          { decision, signal },
        );
      }

      let quality: number | undefined;
      if (signal) {
        try {
          quality = await enrichSignalWithAi({
            signal,
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
            signal,
          });
          throw error;
        }

        await invokeHook(
          'afterEnrichAi',
          decisionManifest?.hooks?.afterEnrichAi,
          {
            ...decisionHookBase,
            decision,
            runtime,
            signal,
            quality,
          },
          { decision, signal },
        );
      }

      const minAiQuality = runtime.ai?.minQuality ?? 4;
      const shouldMakeOrder = shouldExecuteEntryDecision({
        makeOrdersEnabled,
        env,
        signal,
        quality,
        minAiQuality,
      });

      if (!shouldMakeOrder) {
        if (signal) {
          signal.orderStatus = 'skipped';
          signal.orderSkipReason = getEntrySkipReason({
            makeOrdersEnabled,
            env,
            quality,
            minAiQuality,
          });
        }
        return signal ?? decision.code;
      }

      const entryGate = await invokeHook<StrategyHookGateResult | void>(
        'beforeEntryGate',
        decisionManifest?.hooks?.beforeEntryGate,
        {
          ...decisionHookBase,
          decision,
          runtime,
          signal,
          quality,
          makeOrdersEnabled,
          minAiQuality,
        },
        { decision, signal },
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

      return executeEntryDecision({
        connector,
        symbol,
        decision,
        runtime,
        manifest: decisionManifest,
        hookBase: decisionHookBase,
        invokeHook,
        notifyRuntimeError,
      });
    };
  };
};
