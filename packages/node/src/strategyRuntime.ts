import type {
  TradejsConfigAfterBarDecisionHook,
  TradejsConfigAfterCoreDecisionHook,
  TradejsConfigOnBarHook,
  TradejsConfigHooks,
} from '@tradejs/core/config';
import {
  BACKTEST_EXECUTION_DELAY_MS,
  BACKTEST_LOWER_TIMEFRAME_EXECUTION_ENABLED,
} from '@tradejs/core/constants';
import {
  buildDefaultIndicatorPeriods,
  createStrategyAPI,
  createStrategyIndicatorsState,
  getSharedStrategyReplayState,
} from '@tradejs/core/strategies';
import { logger } from '@tradejs/infra/logger';
import {
  enrichSignalWithAi,
  enrichSignalWithMl,
} from './strategyHelpers/runtime';
import { loadHyperliquidWhaleFlowContext } from './strategyHelpers/hyperliquidWhaleContext';
import { enrichSignalWithMarketContextStages } from './strategyHelpers/marketContextStages';
import { resolveStrategyPolicyProfile } from './strategy/policyProfiles';
import { getTradejsProjectCwd, loadTradejsConfig } from './tradejsConfig';
import { resolveStrategyConfig } from './strategyHelpers/config';
import type {
  CreateStrategyCore,
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
  StrategyConfig,
  StrategyCreator,
  StrategyDecision,
} from '@tradejs/types';

import {
  applyBacktestDelayedEntryExecution,
  buildCandleByTimestamp,
  resolveBacktestEntryDelayBars,
  resolveBacktestExecutionDelayMs,
  resolveBacktestExecutionIntervalForPrimary,
  safeIntervalToMs,
  type BacktestExecutionCandleResolution,
} from './strategy/runtimeBacktestDelay';
import {
  buildAiHookContext,
  buildHookEntry,
  buildHookPolicy,
  buildMlHookContext,
  getEntrySkipReason,
  resolveEntryRuntimePolicy,
  shouldExecuteEntryDecision,
} from './strategy/runtimeEntryPolicy';
import {
  buildHookCtx,
  canUseSharedReplayState,
  isConfigHookStage,
  isStrategyDecision,
  isTestConnector,
  normalizeConfigHookList,
  shouldRecordRuntimeJournal,
} from './strategy/runtimeHooks';
import {
  executeEntryDecision,
  handleExitDecision,
  handleProtectDecision,
} from './strategy/runtimeExecution';

interface CreateStrategyRuntimeParams<TConfig extends StrategyConfig> {
  strategyName: string;
  defaults: TConfig;
  createCore: CreateStrategyCore<TConfig, any, any>;
  manifest?: StrategyManifest;
  detectorKey?: (config: TConfig) => string | undefined;
  detectorNoSignalSkipReason?: string;
  resolveRegisteredManifest?: (name: string) => StrategyManifest | undefined;
}

type EntryDecision = Extract<StrategyDecision, { kind: 'entry' }>;

const cloneWithPropertyDescriptors = <T extends object>(value: T): T =>
  Object.create(
    Object.getPrototypeOf(value),
    Object.getOwnPropertyDescriptors(value),
  ) as T;

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

export const createStrategyRuntime = <TConfig extends StrategyConfig>({
  strategyName,
  defaults,
  createCore,
  manifest: staticManifest,
  detectorKey,
  detectorNoSignalSkipReason,
  resolveRegisteredManifest,
}: CreateStrategyRuntimeParams<TConfig>): StrategyCreator => {
  const projectRoot = getTradejsProjectCwd();

  const resolveManifest = (name?: string): StrategyManifest | undefined => {
    if (!name) {
      return undefined;
    }

    if (staticManifest?.name === name) {
      return staticManifest;
    }

    return resolveRegisteredManifest?.(name);
  };

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
    runtimeLineage,
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
    const coreContextRequirements = new Set(
      strategyManifest?.contextRequirements?.core ?? [],
    );
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
      loadDecisionBaseContext: async ({
        baseContext,
        candle,
        symbol: decisionSymbol,
        interval: decisionInterval,
      }) => {
        if (!baseContext) return undefined;
        if (!coreContextRequirements.has('hyperliquidWhales')) {
          return baseContext;
        }
        const hyperliquidWhales = await loadHyperliquidWhaleFlowContext({
          symbol: decisionSymbol,
          interval: decisionInterval,
          timestamp: candle.timestamp,
          env,
          useSeriesCache: env === 'BACKTEST' || env === 'PARITY',
        });
        if (!hyperliquidWhales) return baseContext;

        const participation = cloneWithPropertyDescriptors(
          baseContext.participation,
        );
        Object.defineProperty(participation, 'hyperliquidWhales', {
          configurable: true,
          enumerable: true,
          value: hyperliquidWhales,
          writable: true,
        });
        const enrichedBaseContext = cloneWithPropertyDescriptors(baseContext);
        Object.defineProperty(enrichedBaseContext, 'participation', {
          configurable: true,
          enumerable: true,
          value: participation,
          writable: true,
        });
        return enrichedBaseContext;
      },
    });

    const core = await createCore({
      config,
      data,
      strategyApi,
      indicatorsState,
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
        if (runtimeLineage) signal.runtimeLineage = runtimeLineage;
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
          await enrichSignalWithMarketContextStages({
            signal,
            env,
            includeHyperliquidWhales: false,
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
