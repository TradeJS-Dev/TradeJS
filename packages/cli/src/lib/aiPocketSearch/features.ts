import type { AiPayload } from '@tradejs/types';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DAYS_PER_WEEK = 7;
export const DAYS_PER_MONTH = 30.4375;
export const PRODUCTION_CANDIDATE_MIN_EVENTS = 25;

import type {
  AiPocketCoverageFamily,
  AiPocketExcludedFeatureClassification,
  AiPocketFeatureCoverage,
  AiPocketFeatureMap,
  AiPocketFeaturePathClassification,
  AiPocketFeaturePolicy,
  AiPocketPredicate,
  AiPocketPrimitive,
  AiPocketSummary,
} from './contracts';

type FeatureCollectionOptions = {
  includeSymbol?: boolean;
  includeGateContext?: boolean;
  featureProfile?: 'compact' | 'all';
  featurePolicy?: AiPocketFeaturePolicy;
  onFeatureExcluded?: (event: {
    path: string;
    classification: AiPocketExcludedFeatureClassification;
  }) => void;
};

export type InternalPredicate = AiPocketPredicate & {
  mask: Uint8Array;
  support: number;
  atomSummary: AiPocketSummary;
};

export type ScoredPredicate = AiPocketPredicate & {
  support: number;
  atomSummary: AiPocketSummary;
};

export type FeatureBucket = {
  key: string;
  count: number;
  numericValues: number[];
  numericRowIndexes: number[];
  categoryCounts: Map<
    string,
    {
      value: string | boolean | null;
      count: number;
      rowIndexes: number[];
    }
  >;
};

const OUTCOME_SEGMENTS = new Set([
  'actual',
  'aiapproved',
  'approvalallowednow',
  'backtestexecution',
  'closedat',
  'closedpnl',
  'deterministicquality',
  'entrydelaybars',
  'entrydelaymovebps',
  'executionprice',
  'exitprice',
  'exitreason',
  'exittimestamp',
  'fillprice',
  'future',
  'futuremove',
  'futureprofit',
  'hardblockreasons',
  'label',
  'maxallowedquality',
  'maxquality',
  'modeldirection',
  'modeldirectionmatches',
  'outcome',
  'pnl',
  'profit',
  'profitabletrade',
  'q4continuationrecoveryallowed',
  'q4continuationrecoverycandidate',
  'q4trendshiftgatefeaturesrecoverycandidate',
  'q4usclosingoiconfirmationrecoverycandidate',
  'quality',
  'rawaiapproved',
  'recoveryallowed',
  'recoverycandidate',
  'realized',
  'realizedpnl',
  'rejectreason',
  'result',
  'structuralhardblockreasons',
  'target',
  'traderesult',
]);

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isFeaturePrimitive = (value: unknown): value is AiPocketPrimitive =>
  value == null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  isFiniteNumber(value);

const normalizeFeaturePrimitive = (
  value: AiPocketPrimitive,
): AiPocketPrimitive | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, 120) : undefined;
  }
  if (value == null) {
    return null;
  }
  return value;
};

const isOutcomePath = (segments: string[]) =>
  segments.some((segment) => OUTCOME_SEGMENTS.has(segment.toLowerCase()));

const DATA_QUALITY_LEAVES = new Set([
  'age',
  'agems',
  'available',
  'asofts',
  'calcbars',
  'coverage',
  'latestindex',
  'points',
  'rowcount',
  'rows',
  'stale',
  'timestamp',
  'windowendts',
]);

const METADATA_LEAVES = new Set([
  'connector',
  'exchange',
  'fingerprint',
  'interval',
  'provider',
  'source',
  'strategy',
  'symbol',
  'targetsymbol',
  'universe',
]);

const normalizeFeaturePath = (path: string | string[]) =>
  (Array.isArray(path) ? path : path.split('.'))
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());

export const classifyAiPocketCoverageFeaturePath = (
  path: string | string[],
): AiPocketCoverageFamily | null => {
  const segments = normalizeFeaturePath(path);
  const normalizedPath = segments.join('.');
  if (
    segments.some(
      (segment) => segment.includes('cmc') || segment.includes('coinmarketcap'),
    )
  ) {
    return 'cmc';
  }
  if (
    segments.some(
      (segment) =>
        segment.includes('derivative') || segment.includes('coinalyze'),
    ) ||
    /(?:^|\.)(?:funding|openinterest|oi(?:change|acceleration|divergence)|priceoi|liq(?:long|short|total|imbalance|spike)|liquidation)/.test(
      normalizedPath,
    )
  ) {
    return 'coinalyze';
  }
  return null;
};

const hasUsableContextPrimitive = (value: unknown): boolean => {
  if (Array.isArray(value) || value == null) {
    return false;
  }
  if (isFeaturePrimitive(value)) {
    return typeof value !== 'string' || value.toLowerCase() !== 'unknown';
  }
  if (!isPlainRecord(value)) {
    return false;
  }
  return Object.entries(value).some(([key, child]) => {
    const normalizedKey = key.toLowerCase();
    if (
      DATA_QUALITY_LEAVES.has(normalizedKey) ||
      METADATA_LEAVES.has(normalizedKey) ||
      normalizedKey === 'riskflags' ||
      normalizedKey.endsWith('timestamp') ||
      normalizedKey.endsWith('agems')
    ) {
      return false;
    }
    return hasUsableContextPrimitive(child);
  });
};

const isUsableCmcContext = (value: unknown) =>
  isPlainRecord(value) &&
  value.available !== false &&
  value.stale !== true &&
  hasUsableContextPrimitive(value);

const hasUsableCmcContext = (baseContext: Record<string, unknown> | null) => {
  const relative = isPlainRecord(baseContext?.relative)
    ? baseContext.relative
    : null;
  return Boolean(
    relative &&
      Object.entries(relative).some(
        ([key, value]) =>
          key.toLowerCase().startsWith('cmc') && isUsableCmcContext(value),
      ),
  );
};

const isUsableDerivativesContext = (
  context: Record<string, unknown> | null,
) => {
  if (!context) {
    return false;
  }
  const summary = isPlainRecord(context.summary) ? context.summary : null;
  const riskFlags = Array.isArray(summary?.riskFlags)
    ? summary.riskFlags.filter(
        (flag): flag is string => typeof flag === 'string',
      )
    : [];
  if (
    riskFlags.includes('missing_derivatives') ||
    riskFlags.includes('stale_derivatives')
  ) {
    return false;
  }
  const intervals = isPlainRecord(context.intervals) ? context.intervals : null;
  return Boolean(
    intervals &&
      Object.values(intervals).some(
        (interval) =>
          isPlainRecord(interval) &&
          interval.stale !== true &&
          hasUsableContextPrimitive(interval),
      ),
  );
};

const hasUsableCoinalyzeContext = (
  baseContext: Record<string, unknown> | null,
) => {
  const derivatives = isPlainRecord(baseContext?.derivatives)
    ? baseContext.derivatives
    : null;
  if (!derivatives) {
    return false;
  }
  if (isUsableDerivativesContext(derivatives)) {
    return true;
  }
  const targetContext = isPlainRecord(derivatives.targetContext)
    ? derivatives.targetContext
    : null;
  if (isUsableDerivativesContext(targetContext)) {
    return true;
  }
  const referenceContexts = isPlainRecord(derivatives.referenceContexts)
    ? derivatives.referenceContexts
    : null;
  return Boolean(
    referenceContexts &&
      Object.values(referenceContexts).some((context) =>
        isUsableDerivativesContext(isPlainRecord(context) ? context : null),
      ),
  );
};

export const resolveAiPocketFeatureCoverage = (
  payload: AiPayload,
): AiPocketFeatureCoverage => {
  const additionalIndicators = isPlainRecord(payload.additionalIndicators)
    ? payload.additionalIndicators
    : null;
  const baseContext = isPlainRecord(additionalIndicators?.baseContext)
    ? additionalIndicators.baseContext
    : null;
  return {
    cmc: hasUsableCmcContext(baseContext),
    coinalyze: hasUsableCoinalyzeContext(baseContext),
  };
};

const isAiPocketCoverageFeatureUsable = ({
  payload,
  segments,
  family,
  familyCoverage,
}: {
  payload: AiPayload;
  segments: string[];
  family: AiPocketCoverageFamily;
  familyCoverage: AiPocketFeatureCoverage;
}) => {
  const additionalIndicators = isPlainRecord(payload.additionalIndicators)
    ? payload.additionalIndicators
    : null;
  const baseContext = isPlainRecord(additionalIndicators?.baseContext)
    ? additionalIndicators.baseContext
    : null;
  const baseContextIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === 'basecontext',
  );

  if (family === 'cmc') {
    const relative = isPlainRecord(baseContext?.relative)
      ? baseContext.relative
      : null;
    if (
      relative &&
      baseContextIndex >= 0 &&
      segments[baseContextIndex + 1]?.toLowerCase() === 'relative'
    ) {
      const contextKey = segments[baseContextIndex + 2];
      if (contextKey?.toLowerCase().startsWith('cmc')) {
        return isUsableCmcContext(relative[contextKey]);
      }
    }
    return familyCoverage.cmc;
  }

  const derivatives = isPlainRecord(baseContext?.derivatives)
    ? baseContext.derivatives
    : null;
  if (
    !derivatives ||
    baseContextIndex < 0 ||
    segments[baseContextIndex + 1]?.toLowerCase() !== 'derivatives'
  ) {
    return isUsableDerivativesContext(derivatives);
  }
  const branch = segments[baseContextIndex + 2]?.toLowerCase();
  if (branch == null) {
    return familyCoverage.coinalyze;
  }
  if (branch === 'referencecontexts') {
    const referenceContexts = isPlainRecord(derivatives.referenceContexts)
      ? derivatives.referenceContexts
      : null;
    const symbol = segments[baseContextIndex + 3];
    if (!symbol) {
      return Boolean(
        referenceContexts &&
          Object.values(referenceContexts).some((context) =>
            isUsableDerivativesContext(isPlainRecord(context) ? context : null),
          ),
      );
    }
    return isUsableDerivativesContext(
      symbol && referenceContexts && isPlainRecord(referenceContexts[symbol])
        ? referenceContexts[symbol]
        : null,
    );
  }
  if (branch === 'targetcontext' || branch === 'targetderived') {
    return isUsableDerivativesContext(
      isPlainRecord(derivatives.targetContext)
        ? derivatives.targetContext
        : null,
    );
  }
  return isUsableDerivativesContext(derivatives);
};

const DERIVED_POLICY_FRAGMENTS = [
  'approval',
  'decisionhint',
  'gatefeature',
  'gatescore',
  'hardblock',
  'qualitycap',
  'recoverycandidate',
  'rejectreason',
  'riskflag',
];

const RAW_NONSTATIONARY_LEAVES = new Set([
  'activeassets',
  'activemarkets',
  'close',
  'current',
  'currentprice',
  'high',
  'indexprice',
  'liquidations',
  'liquidationsusd',
  'low',
  'marketcap',
  'marketcapusd',
  'notional',
  'open',
  'openinterest',
  'openinterestusd',
  'price',
  'quotevolume',
  'turnover',
  'turnoverusd',
  'volume',
  'volumeusd',
  'vwap',
]);

export const classifyAiPocketFeaturePath = (
  path: string | string[],
): AiPocketFeaturePathClassification => {
  const segments = (Array.isArray(path) ? path : path.split('.')).filter(
    Boolean,
  );
  const normalized = segments.map((segment) => segment.toLowerCase());
  const leaf = normalized.at(-1) ?? '';
  const normalizedPath = normalized.join('.');
  const strategyGateFeaturesIndex = normalized.findIndex(
    (segment) => segment !== 'gatefeatures' && segment.endsWith('gatefeatures'),
  );
  const strategyGateFeaturePath = normalized.slice(
    strategyGateFeaturesIndex + 1,
  );
  const isStrategySetupEvidence =
    normalized.includes('basecontext') &&
    strategyGateFeaturesIndex >= 0 &&
    (strategyGateFeaturePath.length === 0 ||
      strategyGateFeaturePath.some(
        (segment) => segment === 'geometry' || segment === 'path',
      ));

  if (
    DATA_QUALITY_LEAVES.has(leaf) ||
    leaf.endsWith('timestamp') ||
    leaf.endsWith('agems') ||
    normalized.some((segment) =>
      ['availability', 'dataquality', 'freshness'].includes(segment),
    )
  ) {
    return 'data-quality';
  }

  if (
    METADATA_LEAVES.has(leaf) ||
    leaf.endsWith('fingerprint') ||
    normalized.some((segment) => segment === 'metadata')
  ) {
    return 'metadata';
  }

  if (
    DERIVED_POLICY_FRAGMENTS.some(
      (fragment) =>
        !(fragment === 'gatefeature' && isStrategySetupEvidence) &&
        normalizedPath.includes(fragment),
    )
  ) {
    return 'derived-policy';
  }

  const isDerivedFeature = normalized[0] === 'derived';
  const isNormalizedLeaf =
    /(alpha|bps|change|delta|direction|distance|pct|percentile|ratio|regime|return|share|slope|trend|zscore)/.test(
      leaf,
    );
  const isRawMovingAverage = /^(?:ema|ma|sma|wma)(?:fast|slow|\d+)$/.test(leaf);
  const isRawAbsolutePositioning =
    /^(?:liq(?:long|net|short|total)|oi|openinterest(?:long|short)?)$/.test(
      leaf,
    );
  const isRawAbsoluteMeasure =
    /(?:liquidations?|marketcap|notional|openinterest|price|turnover|volume)$/.test(
      leaf,
    );
  const isRawStructureLevel =
    leaf === 'level' && normalized.includes('structure');
  if (
    !isDerivedFeature &&
    !isNormalizedLeaf &&
    (RAW_NONSTATIONARY_LEAVES.has(leaf) ||
      isRawMovingAverage ||
      isRawAbsolutePositioning ||
      isRawAbsoluteMeasure ||
      isRawStructureLevel)
  ) {
    return 'raw-nonstationary';
  }

  return 'eligible';
};

const isFeaturePathPrefix = (segments: string[], prefix: string[]) =>
  prefix.every((segment, index) => segments[index] === segment);

const isCompactFeaturePathSkipped = (segments: string[]) => {
  if (!segments.length) {
    return false;
  }

  const skippedPrefixes = [
    ['indicators'],
    ['additionalIndicators', 'marketContext'],
    ['additionalIndicators', 'baseContext', 'candle'],
    ['additionalIndicators', 'baseContext', 'prevCandle'],
    ['additionalIndicators', 'baseContext', 'regime', 'memory'],
    ['additionalIndicators', 'baseContext', 'structure', 'acceptance'],
    ['additionalIndicators', 'baseContext', 'structure', 'liquidity'],
    ['additionalIndicators', 'baseContext', 'structure', 'liquidityTails'],
    ['additionalIndicators', 'baseContext', 'structure', 'liquidityZones'],
    ['additionalIndicators', 'baseContext', 'structure', 'pivots'],
    ['additionalIndicators', 'baseContext', 'structure', 'srZones'],
    ['additionalIndicators', 'baseContext', 'structure', 'structureZones'],
    ['additionalIndicators', 'baseContext', 'structure', 'swing'],
    ['additionalIndicators', 'baseContext', 'structure', 'zones'],
    ['additionalIndicators', 'baseContext', 'derivatives', 'referenceContexts'],
    ['additionalIndicators', 'baseContext', 'derivatives', 'referenceSymbols'],
    ['additionalIndicators', 'baseContext', 'relative', 'cmcReferenceAssets'],
    ['additionalIndicators', 'baseContext', 'relative', 'cmcExchangeLiquidity'],
    ['additionalIndicators', 'baseContext', 'relative', 'referenceTradeFlow'],
  ];

  if (skippedPrefixes.some((prefix) => isFeaturePathPrefix(segments, prefix))) {
    return true;
  }

  const leaf = segments.at(-1)?.toLowerCase() ?? '';
  if (leaf === 'asofts' || leaf === 'timestamp' || leaf.endsWith('timestamp')) {
    return true;
  }

  if (
    isFeaturePathPrefix(segments, [
      'additionalIndicators',
      'baseContext',
      'derivatives',
    ]) &&
    [
      'source',
      'symbol',
      'timestamp',
      'targetSymbol',
      'primaryReferenceSymbol',
      'secondaryReferenceSymbol',
    ].includes(segments[3] ?? '')
  ) {
    return true;
  }

  return false;
};

const addFlattenedFeatures = ({
  output,
  value,
  segments,
  maxDepth,
  shouldSkipPath = () => false,
}: {
  output: AiPocketFeatureMap;
  value: unknown;
  segments: string[];
  maxDepth: number;
  shouldSkipPath?: (segments: string[]) => boolean;
}) => {
  if (!segments.length && !isPlainRecord(value)) {
    return;
  }
  if (
    segments.length > maxDepth ||
    isOutcomePath(segments) ||
    shouldSkipPath(segments)
  ) {
    return;
  }
  if (Array.isArray(value)) {
    return;
  }
  if (isFeaturePrimitive(value)) {
    const normalized = normalizeFeaturePrimitive(value);
    if (normalized !== undefined && segments.length) {
      output[segments.join('.')] = normalized;
    }
    return;
  }
  if (!isPlainRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (!key || key.startsWith('_')) {
      continue;
    }
    addFlattenedFeatures({
      output,
      value: child,
      segments: [...segments, key],
      maxDepth,
      shouldSkipPath,
    });
  }
};

const findFeatureNumber = (
  features: AiPocketFeatureMap,
  aliases: string[],
  requiredPathFragments: string[] = [],
) => {
  const normalizedAliases = new Set(
    aliases.map((alias) => alias.toLowerCase()),
  );
  const normalizedFragments = requiredPathFragments.map((fragment) =>
    fragment.toLowerCase(),
  );

  for (const [key, value] of Object.entries(features)) {
    if (!isFiniteNumber(value)) {
      continue;
    }

    const keyLower = key.toLowerCase();
    if (normalizedFragments.some((fragment) => !keyLower.includes(fragment))) {
      continue;
    }

    const lastSegment = keyLower.split('.').at(-1) ?? keyLower;
    if (normalizedAliases.has(lastSegment)) {
      return value;
    }
  }

  return null;
};

const findFeatureString = (features: AiPocketFeatureMap, aliases: string[]) => {
  const normalizedAliases = new Set(
    aliases.map((alias) => alias.toLowerCase()),
  );
  for (const [key, value] of Object.entries(features)) {
    if (typeof value !== 'string') {
      continue;
    }
    const lastSegment = key.toLowerCase().split('.').at(-1) ?? key;
    if (normalizedAliases.has(lastSegment)) {
      return value;
    }
  }
  return null;
};

const addDirectionalDerivedFeatures = (features: AiPocketFeatureMap) => {
  const direction = String(features['signal.direction'] ?? '').toUpperCase();
  const directionSign =
    direction === 'LONG' ? 1 : direction === 'SHORT' ? -1 : null;
  if (directionSign == null) {
    return;
  }

  const currentPrice = findFeatureNumber(features, [
    'current',
    'currentprice',
    'close',
    'last',
    'lastprice',
    'price',
  ]);
  const maFast = findFeatureNumber(features, [
    'fastma',
    'mafast',
    'ma_fast',
    'emafast',
    'emafastvalue',
    'smafast',
  ]);
  const maSlow = findFeatureNumber(features, [
    'slowma',
    'maslow',
    'ma_slow',
    'emaslow',
    'emaslowvalue',
    'smaslow',
  ]);
  const macdHistogram = findFeatureNumber(
    features,
    ['histogram', 'hist', 'macdhistogram', 'macdhist'],
    ['macd'],
  );
  const macdHistogramSlope = findFeatureNumber(
    features,
    ['histogramslope', 'histogramdelta', 'slope', 'delta'],
    ['macd'],
  );
  const obvSlope = findFeatureNumber(
    features,
    ['slope', 'delta', 'change', 'obvslope', 'obvdelta'],
    ['obv'],
  );
  const obvTrend = findFeatureString(features, [
    'obvtrend',
    'trend',
    'obvdirection',
  ]);

  let supportCount = 0;

  if (currentPrice != null && maFast != null && currentPrice !== 0) {
    const signedDistanceBps =
      ((currentPrice - maFast) / Math.abs(currentPrice)) *
      10_000 *
      directionSign;
    const aligned = signedDistanceBps >= 0;
    features['derived.maFastAligned'] = aligned;
    features['derived.priceMaFastDistanceBps'] = signedDistanceBps;
    if (aligned) {
      supportCount += 1;
    }
  }

  if (currentPrice != null && maSlow != null && currentPrice !== 0) {
    const signedDistanceBps =
      ((currentPrice - maSlow) / Math.abs(currentPrice)) *
      10_000 *
      directionSign;
    const aligned = signedDistanceBps >= 0;
    features['derived.maSlowAligned'] = aligned;
    features['derived.priceMaSlowDistanceBps'] = signedDistanceBps;
    if (aligned) {
      supportCount += 1;
    }
  }

  if (maFast != null && maSlow != null) {
    const signedDistance = (maFast - maSlow) * directionSign;
    const aligned = signedDistance >= 0;
    features['derived.maStackAligned'] = aligned;
    features['derived.maFastSlowDistanceSigned'] = signedDistance;
    if (aligned) {
      supportCount += 1;
    }
  }

  if (macdHistogram != null) {
    const signedHistogram = macdHistogram * directionSign;
    const aligned = signedHistogram >= 0;
    features['derived.macdHistogramAligned'] = aligned;
    features['derived.macdHistogramSigned'] = signedHistogram;
    if (aligned) {
      supportCount += 1;
    }
  }

  if (macdHistogramSlope != null) {
    const signedSlope = macdHistogramSlope * directionSign;
    const aligned = signedSlope >= 0;
    features['derived.macdHistogramSlopeAligned'] = aligned;
    features['derived.macdHistogramSlopeSigned'] = signedSlope;
    if (aligned) {
      supportCount += 1;
    }
  }

  if (obvSlope != null) {
    const signedSlope = obvSlope * directionSign;
    const aligned = signedSlope >= 0;
    features['derived.obvSlopeAligned'] = aligned;
    features['derived.obvSlopeSigned'] = signedSlope;
    if (aligned) {
      supportCount += 1;
    }
  } else if (obvTrend) {
    const normalizedTrend = obvTrend.toLowerCase();
    const aligned =
      (direction === 'LONG' &&
        ['up', 'rising', 'bullish', 'positive'].includes(normalizedTrend)) ||
      (direction === 'SHORT' &&
        ['down', 'falling', 'bearish', 'negative'].includes(normalizedTrend));
    features['derived.obvTrendAligned'] = aligned;
    if (aligned) {
      supportCount += 1;
    }
  }

  features['derived.directIndicatorSupportCount'] = supportCount;
};

const addSignalRiskDistanceFeatures = ({
  features,
  signal,
}: {
  features: AiPocketFeatureMap;
  signal: NonNullable<AiPayload['signal']>;
}) => {
  const currentPrice = isFiniteNumber(signal.prices?.currentPrice)
    ? signal.prices.currentPrice
    : null;
  const stopLossPrice = isFiniteNumber(signal.prices?.stopLossPrice)
    ? signal.prices.stopLossPrice
    : null;
  const takeProfitPrice = isFiniteNumber(signal.prices?.takeProfitPrice)
    ? signal.prices.takeProfitPrice
    : null;

  if (currentPrice == null || currentPrice === 0) {
    return;
  }

  if (stopLossPrice != null) {
    features['derived.stopDistanceBps'] =
      (Math.abs(currentPrice - stopLossPrice) / Math.abs(currentPrice)) *
      10_000;
  }

  if (takeProfitPrice != null) {
    features['derived.takeProfitDistanceBps'] =
      (Math.abs(takeProfitPrice - currentPrice) / Math.abs(currentPrice)) *
      10_000;
  }
};

export const collectAiPocketFeatureSnapshot = ({
  payload,
  gateContext,
  includeSymbol = false,
  includeGateContext = false,
  featureProfile = 'all',
  featurePolicy = 'all',
  onFeatureExcluded,
}: {
  payload: AiPayload;
  gateContext?: unknown;
} & FeatureCollectionOptions): {
  features: AiPocketFeatureMap;
  featureCoverage: AiPocketFeatureCoverage;
} => {
  const features: AiPocketFeatureMap = {};
  const featureCoverage = resolveAiPocketFeatureCoverage(payload);
  const signal = payload.signal ?? {};
  const source = {
    signal: {
      direction: signal.direction,
      interval: signal.interval,
      strategy: signal.strategy,
      ...(includeSymbol ? { symbol: signal.symbol } : {}),
    },
    indicators: payload.indicators,
    additionalIndicators: payload.additionalIndicators,
    ...(includeGateContext ? { gate: gateContext } : {}),
  };

  addFlattenedFeatures({
    output: features,
    value: source,
    segments: [],
    maxDepth: 8,
    shouldSkipPath: (segments) => {
      const coverageFamily = classifyAiPocketCoverageFeaturePath(segments);
      if (
        featurePolicy === 'causal-stationary' &&
        coverageFamily != null &&
        !isAiPocketCoverageFeatureUsable({
          payload,
          segments,
          family: coverageFamily,
          familyCoverage: featureCoverage,
        })
      ) {
        onFeatureExcluded?.({
          path: segments.join('.'),
          classification: 'data-quality',
        });
        return true;
      }
      if (
        featureProfile === 'compact' &&
        isCompactFeaturePathSkipped(segments)
      ) {
        return true;
      }
      if (featurePolicy !== 'causal-stationary') {
        return false;
      }
      const classification = classifyAiPocketFeaturePath(segments);
      if (classification === 'eligible') {
        return false;
      }
      onFeatureExcluded?.({
        path: segments.join('.'),
        classification,
      });
      return true;
    },
  });
  if (featurePolicy === 'causal-stationary') {
    for (const [key, value] of Object.entries(features)) {
      if (value === null) {
        onFeatureExcluded?.({
          path: key,
          classification: 'data-quality',
        });
        delete features[key];
      }
    }
  }
  addSignalRiskDistanceFeatures({ features, signal });
  addDirectionalDerivedFeatures(features);

  return { features, featureCoverage };
};

export const collectAiPocketFeatures = (
  options: {
    payload: AiPayload;
    gateContext?: unknown;
  } & FeatureCollectionOptions,
): AiPocketFeatureMap => collectAiPocketFeatureSnapshot(options).features;
