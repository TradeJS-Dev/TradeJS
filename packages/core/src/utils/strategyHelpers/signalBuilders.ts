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

const COMPACT_MTF_CANDLE_LIMIT = 3;

type RecordLike = Record<string, unknown>;

const isRecordLike = (value: unknown): value is RecordLike =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const asFiniteNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const asStringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

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

const cloneCompactArrayTail = (
  value: unknown,
  limit = COMPACT_MTF_CANDLE_LIMIT,
): BaseStrategyContextSnapshot['mtf']['candles']['m15'] =>
  (Array.isArray(value)
    ? cloneSignalPayloadDataProperties(value.slice(-limit))
    : []) as BaseStrategyContextSnapshot['mtf']['candles']['m15'];

const cloneCompactMtfContext = (
  baseContext: BaseStrategyContextSnapshot,
): BaseStrategyContextSnapshot['mtf'] | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(baseContext, 'mtf');
  const mtf =
    descriptor && 'get' in descriptor && typeof descriptor.get === 'function'
      ? descriptor.get.call(baseContext)
      : descriptor && 'value' in descriptor
        ? descriptor.value
        : undefined;

  if (!isRecordLike(mtf)) {
    return undefined;
  }

  const candles = isRecordLike(mtf.candles) ? mtf.candles : {};
  const benchmarkCandles = isRecordLike(mtf.benchmarkCandles)
    ? mtf.benchmarkCandles
    : {};

  return {
    compact: true,
    candles: {
      m15: cloneCompactArrayTail(candles.m15),
      h1: cloneCompactArrayTail(candles.h1),
      h4: cloneCompactArrayTail(candles.h4),
      d1: cloneCompactArrayTail(candles.d1),
    },
    benchmarkCandles: {
      m15: cloneCompactArrayTail(benchmarkCandles.m15),
      h1: cloneCompactArrayTail(benchmarkCandles.h1),
      h4: cloneCompactArrayTail(benchmarkCandles.h4),
      d1: cloneCompactArrayTail(benchmarkCandles.d1),
    },
    ...(isRecordLike(mtf.summary)
      ? { summary: cloneSignalPayloadDataProperties(mtf.summary) as any }
      : {}),
  };
};

const toRankBucket = (
  value: number | null,
): 'low' | 'normal' | 'high' | 'extreme' | 'unknown' => {
  if (value == null) return 'unknown';
  if (value >= 95) return 'extreme';
  if (value >= 80) return 'high';
  if (value <= 20) return 'low';
  return 'normal';
};

const toRangePositionBucket = (
  value: number | null,
): 'low' | 'middle' | 'high' | 'unknown' => {
  if (value == null) return 'unknown';
  if (value <= 0.2) return 'low';
  if (value >= 0.8) return 'high';
  return 'middle';
};

const toVolumeBucket = (
  value: number | null,
): 'thin' | 'normal' | 'elevated' | 'spike' | 'unknown' => {
  if (value == null) return 'unknown';
  if (value < 0.8) return 'thin';
  if (value < 1.5) return 'normal';
  if (value < 3) return 'elevated';
  return 'spike';
};

const toVenueSpreadSeverity = (
  value: number | null,
): 'normal' | 'elevated' | 'wide' | 'unknown' => {
  if (value == null) return 'unknown';
  const abs = Math.abs(value);
  if (abs >= 2) return 'wide';
  if (abs >= 1) return 'elevated';
  return 'normal';
};

const toDirectionalAlignment = ({
  direction,
  bullValue,
  bearValue,
  value,
}: {
  direction: Direction | null;
  bullValue: string;
  bearValue: string;
  value: string | null;
}): boolean | null => {
  if (!direction || !value) return null;
  return direction === 'LONG' ? value === bullValue : value === bearValue;
};

const toMtfAlignmentForDirection = ({
  direction,
  mtfAlignment,
}: {
  direction: Direction | null;
  mtfAlignment: string | null;
}): 'aligned' | 'against' | 'mixed' | 'neutral' | 'unknown' => {
  if (!direction || !mtfAlignment || mtfAlignment === 'unknown') {
    return 'unknown';
  }
  if (mtfAlignment === 'mixed') return 'mixed';
  if (mtfAlignment === 'neutral') return 'neutral';
  if (direction === 'LONG') {
    return mtfAlignment === 'aligned_bull'
      ? 'aligned'
      : mtfAlignment === 'aligned_bear'
        ? 'against'
        : 'unknown';
  }
  return mtfAlignment === 'aligned_bear'
    ? 'aligned'
    : mtfAlignment === 'aligned_bull'
      ? 'against'
      : 'unknown';
};

const toRelativeStrengthBucket = ({
  direction,
  value,
}: {
  direction: Direction | null;
  value: number | null;
}):
  | 'strong_against'
  | 'mild_against'
  | 'neutral'
  | 'mild_with'
  | 'strong_with'
  | 'unknown' => {
  if (!direction || value == null) return 'unknown';
  const signed = direction === 'LONG' ? value : -value;
  if (signed <= -3) return 'strong_against';
  if (signed < -1) return 'mild_against';
  if (signed >= 3) return 'strong_with';
  if (signed > 1) return 'mild_with';
  return 'neutral';
};

const buildBaseContextGateFeatures = ({
  baseContext,
  direction,
}: {
  baseContext: BaseStrategyContextSnapshot;
  direction: Direction | null;
}): NonNullable<BaseStrategyContextSnapshot['gateFeatures']> => {
  const mtfSummary = baseContext.mtf?.summary;
  const mtfAlignmentForDirection = toMtfAlignmentForDirection({
    direction,
    mtfAlignment: mtfSummary?.mtfAlignment ?? null,
  });
  const volatility = baseContext.regime?.volatility;
  const volatilityPercentiles = volatility?.percentiles;
  const localRange = baseContext.structure?.localRange;
  const liquidity = baseContext.structure?.liquidity;
  const volume = baseContext.participation?.volume;
  const delta = baseContext.participation?.delta;
  const volumeStructure = baseContext.participation?.volumeStructure;
  const relative = baseContext.relative?.benchmark;
  const execution = baseContext.relative?.execution;
  const targetVenue = execution?.targetVenue;
  const atrPctRankBucket = toRankBucket(
    asFiniteNumberOrNull(volatilityPercentiles?.atrPctRank100),
  );
  const bbWidthRankBucket = toRankBucket(
    asFiniteNumberOrNull(volatilityPercentiles?.bbWidthRank100),
  );
  const atrPctZScore = asFiniteNumberOrNull(volatility?.atrPctZScore);
  const breakoutState = localRange?.breakoutState ?? 'unknown';
  const volumeRel20 = asFiniteNumberOrNull(volume?.volumeRel20);
  const buyPressurePct = asFiniteNumberOrNull(delta?.buyPressurePct);
  const deltaDivergenceVsPrice = asStringOrNull(delta?.deltaDivergenceVsPrice);
  const deltaBias =
    deltaDivergenceVsPrice === 'bullish' || deltaDivergenceVsPrice === 'bearish'
      ? deltaDivergenceVsPrice === 'bullish'
        ? 'bull'
        : 'bear'
      : buyPressurePct == null
        ? 'unknown'
        : buyPressurePct >= 0.55
          ? 'bull'
          : buyPressurePct <= 0.45
            ? 'bear'
            : 'neutral';
  const benchmarkTrendAlignment = relative?.trendAlignment ?? 'unknown';
  const relativeStrength1h = asFiniteNumberOrNull(relative?.relativeStrength1h);
  const benchmarkAligned =
    benchmarkTrendAlignment === 'against_benchmark'
      ? false
      : toDirectionalAlignment({
          direction,
          bullValue: 'aligned_bull',
          bearValue: 'aligned_bear',
          value: benchmarkTrendAlignment,
        });
  const totalUpVolumeShare = asFiniteNumberOrNull(
    volumeStructure?.totalUpVolumeShare,
  );
  const totalDownVolumeShare = asFiniteNumberOrNull(
    volumeStructure?.totalDownVolumeShare,
  );
  const directionalVolumeShare =
    direction === 'LONG'
      ? totalUpVolumeShare
      : direction === 'SHORT'
        ? totalDownVolumeShare
        : null;

  return {
    direction,
    mtf: {
      alignmentForDirection: mtfAlignmentForDirection,
      higherTimeframeConflict:
        mtfAlignmentForDirection === 'unknown'
          ? null
          : mtfAlignmentForDirection === 'against' ||
            mtfAlignmentForDirection === 'mixed',
      h1TrendBias: mtfSummary?.h1TrendBias ?? 'unknown',
      h4TrendBias: mtfSummary?.h4TrendBias ?? 'unknown',
      d1TrendBias: mtfSummary?.d1TrendBias ?? 'unknown',
      h1RangePosition: asFiniteNumberOrNull(mtfSummary?.h1RangePosition),
      h4VolatilityState: mtfSummary?.h4VolatilityState ?? 'unknown',
    },
    volatility: {
      state: volatility?.state ?? 'unknown',
      atrPctZScore,
      atrPctRankBucket,
      bbWidthRankBucket,
      extremeVolatilityRisk:
        Math.abs(atrPctZScore ?? 0) >= 2 || atrPctRankBucket === 'extreme',
      compressionBreakoutSupport:
        (volatility?.state === 'compressed' || bbWidthRankBucket === 'low') &&
        breakoutState !== 'inside_range' &&
        breakoutState !== 'unknown',
    },
    structure: {
      breakoutState,
      rangePositionBucket: toRangePositionBucket(
        asFiniteNumberOrNull(localRange?.rangePosition20),
      ),
      breakoutWithDirection: toDirectionalAlignment({
        direction,
        bullValue: 'above_high_level',
        bearValue: 'below_low_level',
        value: breakoutState,
      }),
      failedBreakoutForDirection: toDirectionalAlignment({
        direction,
        bullValue: 'failed_low_breakout',
        bearValue: 'failed_high_breakout',
        value: breakoutState,
      }),
      liquiditySweepForDirection:
        direction === 'LONG'
          ? liquidity?.sweepState === 'swept_low'
          : direction === 'SHORT'
            ? liquidity?.sweepState === 'swept_high'
            : null,
      nearPointOfControl:
        baseContext.participation?.priceVolumeProfile?.nearPointOfControl ??
        null,
    },
    participation: {
      volumeRel20,
      volumeBucket: toVolumeBucket(volumeRel20),
      deltaBias,
      deltaAligned:
        direction == null || deltaBias === 'unknown' || deltaBias === 'neutral'
          ? null
          : direction === 'LONG'
            ? deltaBias === 'bull'
            : deltaBias === 'bear',
      volumeStructureAligned:
        directionalVolumeShare == null ? null : directionalVolumeShare >= 0.5,
    },
    relative: {
      benchmarkTrendAlignment,
      benchmarkAligned,
      benchmarkConflict:
        benchmarkAligned === false ||
        toRelativeStrengthBucket({
          direction,
          value: relativeStrength1h,
        }).endsWith('_against'),
      relativeStrength1h,
      relativeStrengthBucket: toRelativeStrengthBucket({
        direction,
        value: relativeStrength1h,
      }),
    },
    execution: {
      venueSpreadZScore: asFiniteNumberOrNull(execution?.venueSpreadZScore),
      venueSpreadSeverity: toVenueSpreadSeverity(
        asFiniteNumberOrNull(execution?.venueSpreadZScore),
      ),
      targetVenueSpreadBps: asFiniteNumberOrNull(targetVenue?.spreadBps),
      targetVenueStale:
        typeof targetVenue?.stale === 'boolean' ? targetVenue.stale : null,
    },
  };
};

const cloneBaseContextData = (
  baseContext: BaseStrategyContextSnapshot,
  direction: Direction | null,
): BaseStrategyContextSnapshot => {
  const clone = cloneSignalPayloadDataProperties(
    baseContext,
  ) as BaseStrategyContextSnapshot;
  const compactMtf = cloneCompactMtfContext(baseContext);

  if (compactMtf) {
    clone.mtf = compactMtf;
  }

  clone.gateFeatures = buildBaseContextGateFeatures({
    baseContext: clone,
    direction,
  });

  return clone;
};

const normalizeAdditionalIndicatorsBaseContext = (
  additionalIndicators: BuildStrategySignalParams['additionalIndicators'],
  direction: Direction | null,
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
    baseContext: cloneBaseContextData(baseContext, direction),
  } as BuildStrategySignalParams['additionalIndicators'];
};

const withTargetVenueContext = (
  additionalIndicators: BuildEntrySignalDecisionParams['additionalIndicators'],
  targetVenue: StrategyMarketSnapshot['targetVenue'],
): BuildEntrySignalDecisionParams['additionalIndicators'] => {
  if (
    targetVenue == null ||
    !additionalIndicators ||
    typeof additionalIndicators !== 'object' ||
    Array.isArray(additionalIndicators)
  ) {
    return additionalIndicators;
  }

  const additionalRecord = additionalIndicators as Record<string, unknown>;
  const baseContext = additionalRecord.baseContext as
    | BaseStrategyContextSnapshot
    | undefined;
  if (!baseContext?.relative?.execution) {
    return additionalIndicators;
  }

  return {
    ...additionalRecord,
    baseContext: {
      ...baseContext,
      relative: {
        ...baseContext.relative,
        execution: {
          ...baseContext.relative.execution,
          targetVenue,
        },
      },
    },
  } as BuildEntrySignalDecisionParams['additionalIndicators'];
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
    normalizeAdditionalIndicatorsBaseContext(
      mergedAdditionalIndicators,
      direction,
    );

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
      const resolvedAdditionalIndicators = withTargetVenueContext(
        additionalIndicators,
        marketData.targetVenue,
      );
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
        additionalIndicators: resolvedAdditionalIndicators,
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
