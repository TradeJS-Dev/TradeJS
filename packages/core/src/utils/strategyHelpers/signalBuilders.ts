import {
  BacktestPriceMode,
  BuildStrategySignalDraft,
  BuildStrategySignalParams,
  Connector,
  Direction,
  KlineChartData,
  Signal,
  StrategyDecision,
  StrategyAPI,
  StrategyAPIExitParams,
  StrategyAPIMarketDataParams,
  StrategyAPIEntryParams,
  StrategyAPIProtectParams,
  StrategyEntrySignalContext,
  StrategyEntryOrderPlan,
  StrategyEntryRuntimeOptions,
  StrategyLastTradeControllerParams,
  StrategyMarketSnapshot,
  StrategyRuntimeAiOptions,
  StrategyRuntimeMlOptions,
  BaseStrategyContextSnapshot,
} from '@tradejs/types';
import {
  calculateRiskRatio,
  getDirectionalTpSlPrices,
  getStrategyMarketSnapshot,
} from './market';
import { createLastTradeController } from './state';
import { uuid } from '../uuid';

type AiRuntimeConfigLike = {
  AI_ENABLED?: boolean;
  AI_MODE?: StrategyRuntimeAiOptions['mode'];
  MIN_AI_QUALITY?: number;
  AI_REPLAY_ANALYSES?: StrategyRuntimeAiOptions['replayAnalyses'];
};

type MlRuntimeConfigLike = {
  ML_ENABLED?: boolean;
  ML_THRESHOLD?: number;
};

const cloneSignalPayloadDataProperties = (
  value: unknown,
  seen = new WeakMap<object, unknown>(),
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => cloneSignalPayloadDataProperties(item, seen));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const objectValue = value as Record<string, unknown>;
  const cached = seen.get(objectValue);
  if (cached) {
    return cached;
  }

  const clone: Record<string, unknown> = {};
  seen.set(objectValue, clone);

  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(objectValue),
  )) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      continue;
    }

    clone[key] = cloneSignalPayloadDataProperties(descriptor.value, seen);
  }

  return clone;
};

const cloneBaseContextData = (
  baseContext: BaseStrategyContextSnapshot,
): BaseStrategyContextSnapshot =>
  cloneSignalPayloadDataProperties(baseContext) as BaseStrategyContextSnapshot;

const normalizeAdditionalIndicatorsBaseContext = (
  additionalIndicators: BuildStrategySignalParams['additionalIndicators'],
): BuildStrategySignalParams['additionalIndicators'] => {
  if (
    !additionalIndicators ||
    typeof additionalIndicators !== 'object' ||
    Array.isArray(additionalIndicators)
  ) {
    return additionalIndicators;
  }

  const baseContext = (
    additionalIndicators as { baseContext?: BaseStrategyContextSnapshot }
  ).baseContext;
  if (baseContext == null) {
    return additionalIndicators;
  }

  return {
    ...(additionalIndicators as Record<string, unknown>),
    baseContext: cloneBaseContextData(baseContext),
  } as BuildStrategySignalParams['additionalIndicators'];
};

export const mapAiRuntimeFromConfig = <TConfig extends AiRuntimeConfigLike>(
  config: TConfig,
  overrides: Partial<StrategyRuntimeAiOptions> = {},
): StrategyRuntimeAiOptions => ({
  enabled: Boolean(config.AI_ENABLED ?? true),
  mode: config.AI_MODE ?? 'llm',
  minQuality: Number(config.MIN_AI_QUALITY ?? 4),
  replayAnalyses: config.AI_REPLAY_ANALYSES,
  ...overrides,
});

export const mapMlRuntimeFromConfig = <TConfig extends MlRuntimeConfigLike>(
  config: TConfig,
  overrides: Partial<StrategyRuntimeMlOptions> = {},
): StrategyRuntimeMlOptions => ({
  enabled: Boolean(config.ML_ENABLED ?? true),
  mlThreshold: Number(config.ML_THRESHOLD ?? 0),
  ...overrides,
});

export const buildStrategySignal = ({
  signalId,
  strategy,
  symbol,
  interval,
  direction,
  timestamp,
  prices,
  figures = {},
  indicators = {},
  additionalIndicators,
  isConfigFromBacktest,
}: BuildStrategySignalParams): Signal => {
  const indicatorsRecord =
    indicators && typeof indicators === 'object' ? indicators : {};
  const baseContext = (
    indicatorsRecord as { baseContext?: BaseStrategyContextSnapshot }
  ).baseContext;
  const normalizedIndicators =
    baseContext == null
      ? indicators
      : Object.fromEntries(
          Object.entries(indicatorsRecord).filter(
            ([key]) => key !== 'baseContext',
          ),
        );
  const mergedAdditionalIndicators =
    baseContext == null
      ? additionalIndicators
      : {
          ...(additionalIndicators ?? {}),
          baseContext:
            (
              additionalIndicators as {
                baseContext?: BaseStrategyContextSnapshot;
              }
            )?.baseContext ?? baseContext,
        };
  const normalizedAdditionalIndicators =
    normalizeAdditionalIndicatorsBaseContext(mergedAdditionalIndicators);

  return {
    signalId,
    strategy,
    symbol,
    interval,
    direction,
    timestamp,
    figures,
    prices,
    indicators: normalizedIndicators,
    additionalIndicators: normalizedAdditionalIndicators,
    isConfigFromBacktest,
  };
};

interface BuildEntrySignalDecisionParams {
  code: string;
  entryContext: StrategyEntrySignalContext;
  figures?: BuildStrategySignalDraft['figures'];
  indicators?: BuildStrategySignalDraft['indicators'];
  additionalIndicators?: BuildStrategySignalDraft['additionalIndicators'];
  signalId?: BuildStrategySignalDraft['signalId'];
  orderPlan: StrategyEntryOrderPlan;
  runtime?: StrategyEntryRuntimeOptions;
}

export const buildEntrySignalDecision = <
  TFigures extends
    BuildStrategySignalDraft['figures'] = BuildStrategySignalDraft['figures'],
  TIndicators extends
    BuildStrategySignalDraft['indicators'] = BuildStrategySignalDraft['indicators'],
  TAdditional extends
    BuildStrategySignalDraft['additionalIndicators'] = BuildStrategySignalDraft['additionalIndicators'],
>({
  code,
  entryContext,
  figures,
  indicators,
  additionalIndicators,
  signalId,
  orderPlan,
  runtime,
}: Omit<
  BuildEntrySignalDecisionParams,
  'figures' | 'indicators' | 'additionalIndicators'
> & {
  figures?: TFigures;
  indicators?: TIndicators;
  additionalIndicators?: TAdditional;
}): StrategyDecision => ({
  kind: 'entry',
  code,
  entryContext,
  signal: buildStrategySignal({
    signalId: signalId ?? uuid(),
    strategy: entryContext.strategy,
    symbol: entryContext.symbol,
    interval: entryContext.interval,
    direction: entryContext.direction,
    timestamp: entryContext.timestamp,
    prices: entryContext.prices,
    figures,
    indicators,
    additionalIndicators,
    isConfigFromBacktest: entryContext.isConfigFromBacktest,
  }),
  orderPlan,
  runtime,
});

interface CreateStrategyAPIParams {
  strategy: Signal['strategy'];
  symbol: Signal['symbol'];
  interval: Signal['interval'];
  env: string;
  connector: Connector;
  cachedData: KlineChartData;
  indicatorsState?: {
    next: (
      candle: KlineChartData[number],
      btcCandle: KlineChartData[number],
    ) => unknown;
  };
  preloadStart?: number;
  backtestPriceMode?: BacktestPriceMode;
  isConfigFromBacktest?: Signal['isConfigFromBacktest'];
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toDefaultEntryCode = (strategy: string, direction: Direction) =>
  `${strategy
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase()}_${direction}_ENTRY`;

const toDefaultExitCode = (strategy: string, direction: Direction) =>
  `${strategy
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase()}_${direction}_EXIT`;

const toDefaultProtectCode = (strategy: string, direction: Direction) =>
  `${strategy
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase()}_${direction}_PROTECT`;

const resolveTakeProfitPrice = ({
  direction,
  takeProfits,
}: {
  direction: Direction;
  takeProfits: StrategyEntryOrderPlan['takeProfits'];
}): number => {
  if (!Array.isArray(takeProfits) || takeProfits.length === 0) {
    throw new Error('strategyApi.entry requires at least one takeProfit');
  }

  const prices = takeProfits
    .map((tp) => tp?.price)
    .filter((price): price is number => isFiniteNumber(price));

  if (prices.length === 0) {
    throw new Error('strategyApi.entry requires finite takeProfit prices');
  }

  return direction === 'LONG' ? Math.max(...prices) : Math.min(...prices);
};

export const createStrategyAPI = ({
  strategy,
  symbol,
  interval,
  env,
  connector,
  cachedData,
  indicatorsState,
  preloadStart,
  backtestPriceMode,
  isConfigFromBacktest,
}: CreateStrategyAPIParams): StrategyAPI => {
  const isBacktestEnv = env === 'BACKTEST';
  const barCache = {
    timestamp: null as number | null,
    currentPosition: undefined as
      | Promise<Awaited<ReturnType<Connector['getPosition']>>>
      | undefined,
    marketDataByKey: new Map<string, Promise<StrategyMarketSnapshot>>(),
  };
  const getCurrentBarTimestamp = () => {
    const lastCandle = cachedData[cachedData.length - 1];
    return typeof lastCandle?.timestamp === 'number'
      ? lastCandle.timestamp
      : null;
  };
  const ensureBarCache = () => {
    if (!isBacktestEnv) {
      return;
    }

    const currentBarTimestamp = getCurrentBarTimestamp();
    if (barCache.timestamp === currentBarTimestamp) {
      return;
    }

    barCache.timestamp = currentBarTimestamp;
    barCache.currentPosition = undefined;
    barCache.marketDataByKey.clear();
  };
  const getCurrentPosition = () => {
    if (!isBacktestEnv) {
      return connector.getPosition(symbol);
    }

    ensureBarCache();
    if (!barCache.currentPosition) {
      barCache.currentPosition = connector.getPosition(symbol);
    }

    return barCache.currentPosition;
  };
  const isPositionExists = async () => {
    const position = await getCurrentPosition();
    return Boolean(
      position && typeof position.qty === 'number' && position.qty > 0,
    );
  };

  const getMarketData = async (
    params: StrategyAPIMarketDataParams = {},
  ): Promise<StrategyMarketSnapshot> => {
    const resolvedPreloadStart = params.preloadStart ?? preloadStart;
    const resolvedBacktestPriceMode =
      params.backtestPriceMode ?? backtestPriceMode;

    if (typeof resolvedPreloadStart !== 'number') {
      throw new Error('strategyApi.getMarketData requires preloadStart');
    }

    if (!isBacktestEnv) {
      return getStrategyMarketSnapshot({
        env,
        connector,
        symbol,
        interval,
        cachedData,
        preloadStart: resolvedPreloadStart,
        backtestPriceMode: resolvedBacktestPriceMode,
      });
    }

    ensureBarCache();

    const cacheKey = `${resolvedPreloadStart}:${String(
      resolvedBacktestPriceMode ?? '',
    )}`;
    let snapshot = barCache.marketDataByKey.get(cacheKey);
    if (!snapshot) {
      snapshot = getStrategyMarketSnapshot({
        env,
        connector,
        symbol,
        interval,
        cachedData,
        preloadStart: resolvedPreloadStart,
        backtestPriceMode: resolvedBacktestPriceMode,
      });
      barCache.marketDataByKey.set(cacheKey, snapshot);
    }

    return snapshot;
  };

  return {
    skip: (code) => ({ kind: 'skip', code }),
    entry: async ({
      code,
      direction,
      figures,
      indicators,
      additionalIndicators,
      signalId,
      orderPlan,
      runtime,
    }: StrategyAPIEntryParams) => {
      const marketData = await getMarketData();
      const currentPrice = marketData.currentPrice;
      const timestamp = marketData.timestamp;
      const stopLossPrice = orderPlan.stopLossPrice;
      const takeProfitPrice = resolveTakeProfitPrice({
        direction,
        takeProfits: orderPlan.takeProfits,
      });

      if (!isFiniteNumber(stopLossPrice)) {
        throw new Error(
          'strategyApi.entry requires finite orderPlan.stopLossPrice',
        );
      }

      const resolvedCode =
        code ?? toDefaultEntryCode(String(strategy), direction);
      const riskRatio = calculateRiskRatio({
        direction,
        currentPrice,
        takeProfitPrice,
        stopLossPrice,
      });

      return buildEntrySignalDecision({
        code: resolvedCode,
        entryContext: {
          strategy,
          symbol,
          interval,
          direction,
          timestamp,
          prices: {
            currentPrice,
            takeProfitPrice,
            stopLossPrice,
            riskRatio,
          },
          isConfigFromBacktest,
        },
        figures,
        indicators,
        additionalIndicators,
        signalId,
        orderPlan,
        runtime,
      }) as Extract<StrategyDecision, { kind: 'entry' }>;
    },
    exit: async ({
      code,
      direction,
      price,
      timestamp,
    }: StrategyAPIExitParams) => {
      const marketData = await getMarketData();
      return {
        kind: 'exit',
        code: code ?? toDefaultExitCode(String(strategy), direction),
        closePlan: {
          price: price ?? marketData.currentPrice,
          timestamp: timestamp ?? marketData.timestamp,
          direction,
        },
      } as Extract<StrategyDecision, { kind: 'exit' }>;
    },
    protect: ({ code, protectPlan }: StrategyAPIProtectParams) =>
      ({
        kind: 'protect',
        code:
          code ?? toDefaultProtectCode(String(strategy), protectPlan.direction),
        protectPlan,
      }) as Extract<StrategyDecision, { kind: 'protect' }>,
    getMarketData,
    nextIndicators: (candle, btcCandle) =>
      indicatorsState?.next(candle, btcCandle),
    getCurrentPosition,
    isCurrentPositionExists: isPositionExists,
    getDirectionalTpSlPrices: (params) => getDirectionalTpSlPrices(params),
    createLastTradeController: (params?: StrategyLastTradeControllerParams) =>
      createLastTradeController({
        env,
        ...params,
      }),
  };
};
