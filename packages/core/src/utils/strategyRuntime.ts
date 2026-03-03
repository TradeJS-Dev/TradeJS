import { SIGNALS_PRELOAD_DAYS } from '@constants';
import { logger } from '@utils/logger';
import { getTimestamp } from '@utils/timestamp';
import { getStrategyManifest } from '../strategy/manifests';
import {
  buildDefaultIndicatorPeriods,
  createStrategyAPI,
  createStrategyIndicatorsState,
  enrichSignalWithAi,
  enrichSignalWithMl,
  executeEntryOrder,
  resolveStrategyConfig,
} from '@utils/strategyHelpers';
import {
  CreateStrategyCore,
  CreateStrategyCoreParams,
  StrategyCoreRunner,
  StrategyConfig,
  StrategyCreator,
  StrategyDecision,
} from '@types';

interface CreateStrategyRuntimeParams<TConfig extends StrategyConfig> {
  strategyName: string;
  defaults: TConfig;
  createCore: CreateStrategyCore<TConfig, any, any>;
}

type EntryDecision = Extract<StrategyDecision, { kind: 'entry' }>;

const resolveEntryRuntimePolicy = ({
  decision,
  config,
}: {
  decision: EntryDecision;
  config: StrategyConfig;
}) => {
  const manifest = getStrategyManifest(decision.entryContext.strategy);
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
}: {
  connector: CreateStrategyCoreParams<StrategyConfig>['connector'];
  symbol: string;
  decision: Extract<StrategyDecision, { kind: 'exit' }>;
}) => {
  try {
    await connector.closePosition({
      symbol,
      price: decision.closePlan.price,
      timestamp: decision.closePlan.timestamp,
      direction: decision.closePlan.direction,
    });
  } catch (err) {
    logger.error('close order error: %s %s', symbol, err);
    return 'ORDER_ERROR';
  }

  return decision.code;
};

const enrichEntryDecisionSignal = async ({
  decision,
  symbol,
  env,
  runtime,
}: {
  decision: EntryDecision;
  symbol: string;
  env: string;
  runtime: ReturnType<typeof resolveEntryRuntimePolicy>;
}) => {
  const signal = decision.signal;
  if (!signal) {
    return { signal, quality: undefined as number | undefined };
  }

  await enrichSignalWithMl({
    signal,
    env,
    ml: runtime.ml,
  });
  const quality = await enrichSignalWithAi({
    signal,
    symbol,
    direction: signal.direction,
    env,
    ai: runtime.ai,
  });

  return { signal, quality };
};

const executeEntryDecision = async ({
  connector,
  symbol,
  config,
  decision,
  runtime,
}: {
  connector: CreateStrategyCoreParams<StrategyConfig>['connector'];
  symbol: string;
  config: StrategyConfig;
  decision: EntryDecision;
  runtime: ReturnType<typeof resolveEntryRuntimePolicy>;
}) => {
  const signal = decision.signal;
  const manifestBeforePlaceOrder = getStrategyManifest(
    decision.entryContext.strategy,
  )?.hooks?.beforePlaceOrder;
  const beforePlaceOrder = async () => {
    await manifestBeforePlaceOrder?.({
      connector,
      entryContext: decision.entryContext,
      config,
      runtime,
    });
    await runtime.beforePlaceOrder?.();
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
        takeProfits: decision.orderPlan.takeProfits ?? [],
        stopLossPrice: decision.entryContext.prices.stopLossPrice ?? null,
        signal,
        beforePlaceOrder,
      });
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
      decision.entryContext.prices.stopLossPrice ?? null,
    );
  } catch (err) {
    if (signal) {
      signal.orderStatus = 'failed';
    }
    logger.error('order error: %s %s', symbol, err);
    return signal ?? 'ORDER_ERROR';
  }

  return signal ?? decision.code;
};

export const createStrategyRuntime = <TConfig extends StrategyConfig>({
  strategyName,
  defaults,
  createCore,
}: CreateStrategyRuntimeParams<TConfig>): StrategyCreator => {
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

    const indicatorsState = createStrategyIndicatorsState({
      env: String(config.ENV ?? 'BACKTEST'),
      data,
      btcData,
      btcBinanceData,
      btcCoinbaseData,
      periods: buildDefaultIndicatorPeriods(config as any),
    });
    const strategyApi = createStrategyAPI({
      strategy: strategyName as any,
      symbol,
      interval: (config.INTERVAL ?? '15') as any,
      env: String(config.ENV ?? 'BACKTEST'),
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
      strategyApi,
      indicatorsState,
    });

    return async (candle, btcCandle) => {
      data.push(candle);
      btcData.push(btcCandle);
      indicatorsState.setCurrentBar(candle, btcCandle);

      const decision = await core(candle, btcCandle);

      if (decision.kind === 'skip') {
        return decision.code;
      }

      const makeOrdersEnabled =
        typeof config.MAKE_ORDERS === 'boolean' ? config.MAKE_ORDERS : true;

      if (decision.kind === 'exit') {
        if (!makeOrdersEnabled) {
          return decision.code;
        }
        return handleExitDecision({ connector, symbol, decision });
      }

      const env = String(config.ENV ?? 'BACKTEST');
      const runtime = resolveEntryRuntimePolicy({ decision, config });
      const { signal, quality } = await enrichEntryDecisionSignal({
        decision,
        symbol,
        env,
        runtime,
      });
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
      return executeEntryDecision({
        connector,
        symbol,
        config,
        decision,
        runtime,
      });
    };
  };
};
