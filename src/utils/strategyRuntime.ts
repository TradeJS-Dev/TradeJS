import { logger } from '@utils/logger';
import { getStrategyManifest } from '../strategy/manifests';
import {
  enrichSignalWithMlAi,
  executeEntryOrder,
  resolveStrategyConfig,
} from '@utils/strategyHelpers';
import {
  CreateStrategyCoreParams,
  StrategyCoreRunner,
  StrategyConfig,
  StrategyCreator,
  StrategyDecision,
} from '@types';

interface CreateStrategyRuntimeParams<TConfig extends StrategyConfig> {
  strategyName: string;
  defaults: TConfig;
  createCore: (
    params: CreateStrategyCoreParams<TConfig>,
  ) => Promise<StrategyCoreRunner> | StrategyCoreRunner;
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
  (!signal || env === 'BACKTEST' || (quality != null && quality >= minAiQuality));

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

  const quality = await enrichSignalWithMlAi({
    signal,
    symbol,
    direction: signal.direction,
    env,
    ml: runtime.ml,
    ai: runtime.ai,
  });
  signal.orderStatus = 'canceled';

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
  const manifestBeforePlaceOrder =
    getStrategyManifest(decision.entryContext.strategy)?.hooks?.beforePlaceOrder;
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
    connector,
  }) => {
    const { config, configFromBacktest } = await resolveStrategyConfig({
      strategyName,
      userName,
      symbol,
      baseConfig,
      defaults,
    });

    const core = await createCore({
      userName,
      symbol,
      config,
      configFromBacktest,
      connector,
      data,
      btcData,
    });

    return async (candle, btcCandle) => {
      data.push(candle);
      btcData.push(btcCandle);

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
