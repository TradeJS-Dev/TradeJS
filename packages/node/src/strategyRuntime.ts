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
  updatePositionProtection,
} from './strategyHelpers/runtime';
import { createPineScriptLoader } from './pine';
import { getStrategyManifest } from './strategy/manifests';
import { getTradejsProjectCwd } from './tradejsConfig';
import { resolveStrategyConfig } from './strategyHelpers/config';
import {
  CreateStrategyCore,
  CreateStrategyCoreParams,
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
type ProtectDecision = Extract<StrategyDecision, { kind: 'protect' }>;

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

type ResolvedEntryRuntime = ReturnType<typeof resolveEntryRuntimePolicy>;
type HookCandleMarket = Required<
  Pick<StrategyHookMarketContext, 'candle' | 'btcCandle'>
>;

const buildHookCtx = ({
  connector,
  strategyName,
  userName,
  symbol,
  strategyConfig,
  env,
  isConfigFromBacktest,
}: {
  connector: CreateStrategyCoreParams<StrategyConfig>['connector'];
  strategyName: string;
  userName: string;
  symbol: string;
  strategyConfig: StrategyConfig;
  env: string;
  isConfigFromBacktest: boolean;
}): StrategyHookCtx => ({
  connector,
  strategyName,
  userName,
  symbol,
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
  symbol,
  decision,
  market,
  onRuntimeError,
}: {
  connector: CreateStrategyCoreParams<StrategyConfig>['connector'];
  symbol: string;
  decision: ExitDecision;
  market: HookCandleMarket;
  onRuntimeError?: (params: {
    stage: StrategyHookStage;
    error: unknown;
    decision: ExitDecision;
    market: HookCandleMarket;
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
  invokeHook,
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
  invokeHook: <TReturn = unknown>(
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
    await invokeHook(
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
    const orderPlaced = await connector.placeOrder({
      symbol,
      qty: decision.orderPlan.qty,
      price: decision.entryContext.prices.currentPrice,
      timestamp: decision.entryContext.timestamp,
      direction: decision.entryContext.direction,
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

    await invokeHook(
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
    }
    await notifyRuntimeError({
      stage: 'placeOrder',
      error: err,
      decision,
      entry,
      market,
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
      strategyConfig: config,
      env,
      isConfigFromBacktest,
    };
    const getHookCtx = (name = strategyName): StrategyHookCtx =>
      buildHookCtx({
        ...hookBase,
        strategyName: name,
      });

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
      const onRuntimeError = errorManifest?.hooks?.onRuntimeError;
      if (!onRuntimeError) {
        return;
      }

      try {
        await onRuntimeError({
          ctx: getHookCtx(errorStrategyName),
          market,
          decision,
          entry,
          error: {
            stage,
            cause: error,
          },
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
      loadPineScriptFile,
      strategyApi,
      indicatorsState,
    });

    await invokeHook('onInit', strategyManifest?.hooks?.onInit, {
      ctx: getHookCtx(),
      market: {
        data,
        btcData,
      },
    });

    return async (candle, btcCandle) => {
      data.push(candle);
      btcData.push(btcCandle);
      indicatorsState.setCurrentBar(candle, btcCandle);
      const market: HookCandleMarket = {
        candle,
        btcCandle,
      };

      const decision = await core(candle, btcCandle);
      const decisionStrategyName =
        decision.kind === 'entry'
          ? decision.entryContext.strategy
          : strategyName;
      const decisionManifest =
        resolveManifest(decisionStrategyName) ?? strategyManifest;
      const decisionHookCtx = getHookCtx(decisionStrategyName);

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

      if (decision.kind === 'skip') {
        await invokeHook(
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
          symbol,
          decision,
          market,
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
      });
      const signal = decision.signal;
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

        await invokeHook(
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

        await invokeHook(
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
      const policy = buildHookPolicy({
        quality,
        makeOrdersEnabled,
        minAiQuality,
      });
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
        invokeHook,
        notifyRuntimeError,
      });
    };
  };
};
