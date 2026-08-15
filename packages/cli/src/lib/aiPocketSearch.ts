import type { AiPayload } from '@tradejs/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30.4375;
const PRODUCTION_CANDIDATE_MIN_EVENTS = 25;

import type {
  AiPocketCadenceProfile,
  AiPocketCoverageFamily,
  AiPocketCoverageSummary,
  AiPocketExcludedFeatureClassification,
  AiPocketFeatureCoverage,
  AiPocketFeatureMap,
  AiPocketFeaturePathClassification,
  AiPocketFeaturePolicy,
  AiPocketPredicate,
  AiPocketPrimitive,
  AiPocketResult,
  AiPocketSearchObjective,
  AiPocketSearchOptions,
  AiPocketSearchProgress,
  AiPocketSearchProgressPhase,
  AiPocketSearchResult,
  AiPocketSearchRow,
  AiPocketSummary,
} from './aiPocketSearch/contracts';
export type * from './aiPocketSearch/contracts';

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

type InternalPredicate = AiPocketPredicate & {
  mask: Uint8Array;
  support: number;
  atomSummary: AiPocketSummary;
};

type ScoredPredicate = AiPocketPredicate & {
  support: number;
  atomSummary: AiPocketSummary;
};

type FeatureBucket = {
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

const isFiniteNumber = (value: unknown): value is number =>
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

const formatNumber = (value: number) => {
  if (Number.isInteger(value)) {
    return String(value);
  }
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.001) {
    return value.toExponential(3);
  }
  return Number(value.toPrecision(6)).toString();
};

const formatPredicateValue = (value: string | number | boolean | null) => {
  if (typeof value === 'number') {
    return formatNumber(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  return String(value);
};

const roundThreshold = (value: number) => Number(value.toPrecision(8));

const quantileAt = (values: number[], quantile: number) => {
  const index = Math.floor((values.length - 1) * quantile);
  return values[Math.max(0, Math.min(values.length - 1, index))];
};

const getPeriodDays = (rows: AiPocketSearchRow[]) => {
  let minTimestamp: number | null = null;
  let maxTimestamp: number | null = null;
  for (const row of rows) {
    const timestamp =
      typeof row.timestamp === 'number' && Number.isFinite(row.timestamp)
        ? row.timestamp
        : null;
    if (timestamp == null) {
      continue;
    }
    minTimestamp =
      minTimestamp == null ? timestamp : Math.min(minTimestamp, timestamp);
    maxTimestamp =
      maxTimestamp == null ? timestamp : Math.max(maxTimestamp, timestamp);
  }
  if (minTimestamp == null || maxTimestamp == null) {
    return null;
  }
  return Math.max((maxTimestamp - minTimestamp) / DAY_MS, 1);
};

type AiPocketSummaryAccumulator = {
  support: number;
  grossProfit: number;
  grossLoss: number;
  wins: number;
  directionCounts: Map<string, number>;
  symbolCounts: Map<
    string,
    {
      count: number;
      totalProfit: number;
    }
  >;
  monthProfits: Map<string, number>;
  eventStats: Map<string, { count: number; totalProfit: number }>;
  equityPoints: Array<{ timestamp: number; profit: number }>;
};

const createSummaryAccumulator = (): AiPocketSummaryAccumulator => ({
  support: 0,
  grossProfit: 0,
  grossLoss: 0,
  wins: 0,
  directionCounts: new Map<string, number>(),
  symbolCounts: new Map<
    string,
    {
      count: number;
      totalProfit: number;
    }
  >(),
  monthProfits: new Map<string, number>(),
  eventStats: new Map<string, { count: number; totalProfit: number }>(),
  equityPoints: [],
});

const addSummaryRow = (
  accumulator: AiPocketSummaryAccumulator,
  row: AiPocketSearchRow,
) => {
  const profit = Number(row.profit);
  accumulator.support += 1;

  if (profit > 0) {
    accumulator.grossProfit += profit;
    accumulator.wins += 1;
  } else if (profit < 0) {
    accumulator.grossLoss += Math.abs(profit);
  }

  const direction =
    typeof row.direction === 'string' && row.direction.trim()
      ? row.direction
      : 'UNKNOWN';
  accumulator.directionCounts.set(
    direction,
    (accumulator.directionCounts.get(direction) ?? 0) + 1,
  );

  const symbol =
    typeof row.symbol === 'string' && row.symbol.trim()
      ? row.symbol
      : 'UNKNOWN';
  const symbolBucket = accumulator.symbolCounts.get(symbol) ?? {
    count: 0,
    totalProfit: 0,
  };
  symbolBucket.count += 1;
  symbolBucket.totalProfit += profit;
  accumulator.symbolCounts.set(symbol, symbolBucket);

  const timestamp =
    typeof row.timestamp === 'number' && Number.isFinite(row.timestamp)
      ? row.timestamp
      : Number.POSITIVE_INFINITY;
  const eventKey = Number.isFinite(timestamp)
    ? String(timestamp)
    : `UNKNOWN:${accumulator.support}`;
  const event = accumulator.eventStats.get(eventKey) ?? {
    count: 0,
    totalProfit: 0,
  };
  event.count += 1;
  event.totalProfit += profit;
  accumulator.eventStats.set(eventKey, event);
  const month =
    Number.isFinite(timestamp) && timestamp !== Number.POSITIVE_INFINITY
      ? new Date(timestamp).toISOString().slice(0, 7)
      : 'UNKNOWN';
  accumulator.monthProfits.set(
    month,
    (accumulator.monthProfits.get(month) ?? 0) + profit,
  );
  accumulator.equityPoints.push({ timestamp, profit });
};

const emptyAiPocketSummary = ({
  fullPeriodDays,
  supportRatio,
}: {
  fullPeriodDays: number | null;
  supportRatio: number;
}): AiPocketSummary => ({
  support: 0,
  supportRatio,
  events: 0,
  eventBalancedProfit: 0,
  tradesPerEvent: null,
  p95Batch: 0,
  maxBatch: 0,
  topEventCountShare: null,
  topEventProfitShare: null,
  topSymbolCountShare: null,
  topSymbolProfitShare: null,
  totalProfit: 0,
  grossProfit: 0,
  grossLoss: 0,
  profitFactor: null,
  winRate: null,
  avgProfit: null,
  maxDrawdown: 0,
  maxDrawdownPctOfGrossProfit: null,
  maxDrawdownPctOfTotalProfit: null,
  recoveryFactor: null,
  maxConsecutiveWins: 0,
  maxConsecutiveLosses: 0,
  avgTradesPerDay: fullPeriodDays == null ? null : 0,
  avgTradesPerWeek: fullPeriodDays == null ? null : 0,
  avgProfitPerDay: fullPeriodDays == null ? null : 0,
  avgProfitPerMonth: fullPeriodDays == null ? null : 0,
  losingMonths: 0,
  worstMonth: null,
  directionCounts: {},
  topSymbols: [],
});

const finalizeAiPocketSummary = ({
  rows,
  accumulator,
}: {
  rows: AiPocketSearchRow[];
  accumulator: AiPocketSummaryAccumulator;
}): AiPocketSummary => {
  const fullPeriodDays = getPeriodDays(rows);
  const support = accumulator.support;
  const supportRatio = rows.length > 0 ? support / rows.length : 0;

  if (support === 0) {
    return {
      ...emptyAiPocketSummary({ fullPeriodDays, supportRatio }),
    };
  }

  let equity = 0;
  let peakEquity = 0;
  let maxDrawdown = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;

  accumulator.equityPoints.sort(
    (left, right) => left.timestamp - right.timestamp,
  );
  for (const point of accumulator.equityPoints) {
    equity += point.profit;
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdown = Math.max(maxDrawdown, Math.max(0, peakEquity - equity));

    if (point.profit > 0) {
      currentWinStreak += 1;
      currentLossStreak = 0;
    } else if (point.profit < 0) {
      currentLossStreak += 1;
      currentWinStreak = 0;
    } else {
      currentWinStreak = 0;
      currentLossStreak = 0;
    }

    maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWinStreak);
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLossStreak);
  }

  const grossProfit = accumulator.grossProfit;
  const grossLoss = accumulator.grossLoss;
  const totalProfit = grossProfit - grossLoss;
  const avgTradesPerDay =
    fullPeriodDays == null ? null : support / fullPeriodDays;
  const avgProfitPerDay =
    fullPeriodDays == null ? null : totalProfit / fullPeriodDays;
  const losingMonthEntries = [...accumulator.monthProfits.entries()].filter(
    ([, profit]) => profit < 0,
  );
  const worstMonth =
    [...accumulator.monthProfits.entries()].sort(
      (left, right) => left[1] - right[1],
    )[0] ?? null;
  const eventStats = [...accumulator.eventStats.values()];
  const events = eventStats.length;
  const batchSizes = eventStats
    .map((event) => event.count)
    .sort((left, right) => left - right);
  const p95Batch =
    batchSizes[Math.max(0, Math.ceil(batchSizes.length * 0.95) - 1)] ?? 0;
  const maxBatch = batchSizes.at(-1) ?? 0;
  const absoluteEventProfit = eventStats.reduce(
    (sum, event) => sum + Math.abs(event.totalProfit),
    0,
  );
  const absoluteSymbolProfit = [...accumulator.symbolCounts.values()].reduce(
    (sum, symbol) => sum + Math.abs(symbol.totalProfit),
    0,
  );

  return {
    support,
    supportRatio,
    events,
    eventBalancedProfit: eventStats.reduce(
      (sum, event) => sum + event.totalProfit / event.count,
      0,
    ),
    tradesPerEvent: events > 0 ? support / events : null,
    p95Batch,
    maxBatch,
    topEventCountShare: support > 0 ? maxBatch / support : null,
    topEventProfitShare:
      absoluteEventProfit > 0
        ? Math.max(...eventStats.map((event) => Math.abs(event.totalProfit))) /
          absoluteEventProfit
        : null,
    topSymbolCountShare:
      support > 0
        ? Math.max(
            ...[...accumulator.symbolCounts.values()].map(
              (symbol) => symbol.count,
            ),
          ) / support
        : null,
    topSymbolProfitShare:
      absoluteSymbolProfit > 0
        ? Math.max(
            ...[...accumulator.symbolCounts.values()].map((symbol) =>
              Math.abs(symbol.totalProfit),
            ),
          ) / absoluteSymbolProfit
        : null,
    totalProfit,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    winRate: support > 0 ? accumulator.wins / support : null,
    avgProfit: support > 0 ? totalProfit / support : null,
    maxDrawdown,
    maxDrawdownPctOfGrossProfit:
      grossProfit > 0 ? maxDrawdown / grossProfit : null,
    maxDrawdownPctOfTotalProfit:
      totalProfit > 0 ? maxDrawdown / totalProfit : null,
    recoveryFactor: maxDrawdown > 0 ? totalProfit / maxDrawdown : null,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    avgTradesPerDay,
    avgTradesPerWeek:
      avgTradesPerDay == null ? null : avgTradesPerDay * DAYS_PER_WEEK,
    avgProfitPerDay,
    avgProfitPerMonth:
      avgProfitPerDay == null ? null : avgProfitPerDay * DAYS_PER_MONTH,
    losingMonths: losingMonthEntries.length,
    worstMonth: worstMonth
      ? {
          month: worstMonth[0],
          totalProfit: worstMonth[1],
        }
      : null,
    directionCounts: Object.fromEntries(accumulator.directionCounts.entries()),
    topSymbols: [...accumulator.symbolCounts.entries()]
      .map(([symbol, value]) => ({
        symbol,
        ...value,
      }))
      .sort(
        (left, right) =>
          right.count - left.count ||
          Math.abs(right.totalProfit) - Math.abs(left.totalProfit),
      )
      .slice(0, 5),
  };
};

const summarizeSelectedRows = (
  rows: AiPocketSearchRow[],
  selected: AiPocketSearchRow[],
): AiPocketSummary => {
  const accumulator = createSummaryAccumulator();
  for (const row of selected) {
    addSummaryRow(accumulator, row);
  }
  return finalizeAiPocketSummary({ rows, accumulator });
};

const summarizeMask = (rows: AiPocketSearchRow[], mask: Uint8Array) => {
  const accumulator = createSummaryAccumulator();
  for (let index = 0; index < rows.length; index += 1) {
    if (mask[index] === 1) {
      addSummaryRow(accumulator, rows[index]);
    }
  }
  return finalizeAiPocketSummary({ rows, accumulator });
};

const summarizeRowIndexes = (
  rows: AiPocketSearchRow[],
  rowIndexes: number[],
) => {
  const accumulator = createSummaryAccumulator();
  for (const rowIndex of rowIndexes) {
    addSummaryRow(accumulator, rows[rowIndex]);
  }
  return finalizeAiPocketSummary({ rows, accumulator });
};

export const summarizeAiPocketRows = (rows: AiPocketSearchRow[]) =>
  summarizeSelectedRows(rows, rows);

export const summarizeAiPocketFeatureCoverage = (
  rows: AiPocketSearchRow[],
  family: AiPocketCoverageFamily,
): AiPocketCoverageSummary => {
  const coveredRows = rows.filter(
    (row) => row.featureCoverage?.[family] === true,
  );
  const allEvents = new Set<number>();
  const coveredEvents = new Set<number>();
  let minTimestamp: number | null = null;
  let maxTimestamp: number | null = null;

  for (const row of rows) {
    if (isFiniteNumber(row.timestamp)) {
      allEvents.add(row.timestamp);
    }
  }
  for (const row of coveredRows) {
    if (!isFiniteNumber(row.timestamp)) {
      continue;
    }
    coveredEvents.add(row.timestamp);
    minTimestamp =
      minTimestamp == null
        ? row.timestamp
        : Math.min(minTimestamp, row.timestamp);
    maxTimestamp =
      maxTimestamp == null
        ? row.timestamp
        : Math.max(maxTimestamp, row.timestamp);
  }

  return {
    family,
    rows: coveredRows.length,
    rowRatio: rows.length > 0 ? coveredRows.length / rows.length : 0,
    events: coveredEvents.size,
    eventRatio: allEvents.size > 0 ? coveredEvents.size / allEvents.size : 0,
    minTimestamp,
    maxTimestamp,
  };
};

const matchesPredicate = (
  value: AiPocketPrimitive | undefined,
  predicate: AiPocketPredicate,
) => {
  if (predicate.kind === 'numeric') {
    if (!isFiniteNumber(value)) {
      return false;
    }
    return predicate.op === '<='
      ? value <= predicate.threshold
      : value >= predicate.threshold;
  }

  return value === predicate.value;
};

const buildMask = (rows: AiPocketSearchRow[], predicate: AiPocketPredicate) => {
  const mask = new Uint8Array(rows.length);
  let support = 0;
  rows.forEach((row, index) => {
    if (matchesPredicate(row.features[predicate.featureKey], predicate)) {
      mask[index] = 1;
      support += 1;
    }
  });
  return { mask, support };
};

const intersectMasks = (left: Uint8Array, right: Uint8Array) => {
  const mask = new Uint8Array(left.length);
  let support = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === 1 && right[index] === 1) {
      mask[index] = 1;
      support += 1;
    }
  }
  return { mask, support };
};

const buildPredicateListMask = (
  rows: AiPocketSearchRow[],
  predicates: AiPocketPredicate[],
) => {
  const mask = new Uint8Array(rows.length);
  let support = 0;
  rows.forEach((row, index) => {
    if (
      predicates.every((predicate) =>
        matchesPredicate(row.features[predicate.featureKey], predicate),
      )
    ) {
      mask[index] = 1;
      support += 1;
    }
  });
  return { mask, support };
};

const toPublicPredicate = (predicate: AiPocketPredicate): AiPocketPredicate => {
  if (predicate.kind === 'numeric') {
    return {
      id: predicate.id,
      featureKey: predicate.featureKey,
      label: predicate.label,
      kind: predicate.kind,
      op: predicate.op,
      threshold: predicate.threshold,
    };
  }

  return {
    id: predicate.id,
    featureKey: predicate.featureKey,
    label: predicate.label,
    kind: predicate.kind,
    op: predicate.op,
    value: predicate.value,
  };
};

const buildAiPocketPredicateResult = (
  rows: AiPocketSearchRow[],
  options: {
    minSupport?: number;
    maxCategories?: number;
    progressInterval?: number;
    onProgress?: (progress: AiPocketSearchProgress) => void;
  } = {},
): { featureKeys: number; predicates: ScoredPredicate[] } => {
  const minSupport = Math.max(1, Math.trunc(options.minSupport ?? 20));
  const maxCategories = Math.max(2, Math.trunc(options.maxCategories ?? 24));
  const progressInterval = Math.max(
    1,
    Math.trunc(options.progressInterval ?? 500),
  );
  const onProgress = options.onProgress;
  const buckets = new Map<string, FeatureBucket>();
  let lastFeatureProgress = 0;
  let lastPredicateProgress = 0;

  const emitProgress = (
    phase: AiPocketSearchProgressPhase,
    current: number,
    total: number,
    done = false,
  ) => {
    if (!onProgress) {
      return;
    }
    const lastProgress =
      phase === 'features' ? lastFeatureProgress : lastPredicateProgress;
    if (!done && current - lastProgress < progressInterval) {
      return;
    }
    if (phase === 'features') {
      lastFeatureProgress = current;
    } else if (phase === 'predicates') {
      lastPredicateProgress = current;
    }
    onProgress({
      phase,
      current,
      total,
      done,
      truncated: false,
    });
  };

  rows.forEach((row, rowIndex) => {
    for (const [key, value] of Object.entries(row.features)) {
      if (value === undefined) {
        continue;
      }
      const bucket = buckets.get(key) ?? {
        key,
        count: 0,
        numericValues: [],
        numericRowIndexes: [],
        categoryCounts: new Map<
          string,
          {
            value: string | boolean | null;
            count: number;
            rowIndexes: number[];
          }
        >(),
      };
      bucket.count += 1;

      if (isFiniteNumber(value)) {
        bucket.numericValues.push(value);
        bucket.numericRowIndexes.push(rowIndex);
      }
      if (
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        value === null
      ) {
        const serialized = JSON.stringify(value);
        const categoryBucket = bucket.categoryCounts.get(serialized) ?? {
          value,
          count: 0,
          rowIndexes: [],
        };
        categoryBucket.count += 1;
        categoryBucket.rowIndexes.push(rowIndex);
        bucket.categoryCounts.set(serialized, categoryBucket);
      }

      buckets.set(key, bucket);
    }
    emitProgress('features', rowIndex + 1, rows.length);
  });
  emitProgress('features', rows.length, rows.length, true);

  const bucketList = [...buckets.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
  const predicates: ScoredPredicate[] = [];

  for (let bucketIndex = 0; bucketIndex < bucketList.length; bucketIndex += 1) {
    const bucket = bucketList[bucketIndex];
    const key = bucket.key;
    if (bucket.count < minSupport) {
      emitProgress('predicates', bucketIndex + 1, bucketList.length);
      continue;
    }

    const numericEntries = bucket.numericValues
      .map((value, index) => ({
        value,
        rowIndex: bucket.numericRowIndexes[index],
      }))
      .sort((left, right) => left.value - right.value);
    const numericValues = numericEntries.map((entry) => entry.value);
    if (numericValues.length >= minSupport) {
      const uniqueValues = [...new Set(numericValues.map(roundThreshold))];
      if (uniqueValues.length > 1) {
        const thresholdSet = new Set<number>();
        [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].forEach((quantile) =>
          thresholdSet.add(roundThreshold(quantileAt(numericValues, quantile))),
        );
        if (numericValues[0] < 0 && numericValues.at(-1)! > 0) {
          thresholdSet.add(0);
        }

        const thresholds = [...thresholdSet].sort((left, right) => {
          return left - right;
        });
        const summaryByPredicate = new Map<
          string,
          { support: number; summary: AiPocketSummary }
        >();

        const lessOrEqualAccumulator = createSummaryAccumulator();
        let lessOrEqualIndex = 0;
        for (const threshold of thresholds) {
          while (
            lessOrEqualIndex < numericEntries.length &&
            numericEntries[lessOrEqualIndex].value <= threshold
          ) {
            addSummaryRow(
              lessOrEqualAccumulator,
              rows[numericEntries[lessOrEqualIndex].rowIndex],
            );
            lessOrEqualIndex += 1;
          }

          const support = lessOrEqualAccumulator.support;
          if (support >= minSupport && support < rows.length) {
            summaryByPredicate.set(`<=:${threshold}`, {
              support,
              summary: finalizeAiPocketSummary({
                rows,
                accumulator: lessOrEqualAccumulator,
              }),
            });
          }
        }

        const greaterOrEqualAccumulator = createSummaryAccumulator();
        let greaterOrEqualIndex = numericEntries.length - 1;
        for (const threshold of [...thresholds].reverse()) {
          while (
            greaterOrEqualIndex >= 0 &&
            numericEntries[greaterOrEqualIndex].value >= threshold
          ) {
            addSummaryRow(
              greaterOrEqualAccumulator,
              rows[numericEntries[greaterOrEqualIndex].rowIndex],
            );
            greaterOrEqualIndex -= 1;
          }

          const support = greaterOrEqualAccumulator.support;
          if (support >= minSupport && support < rows.length) {
            summaryByPredicate.set(`>=:${threshold}`, {
              support,
              summary: finalizeAiPocketSummary({
                rows,
                accumulator: greaterOrEqualAccumulator,
              }),
            });
          }
        }

        for (const threshold of thresholds) {
          for (const op of ['<=', '>='] as const) {
            const scored = summaryByPredicate.get(`${op}:${threshold}`);
            if (!scored) {
              continue;
            }
            predicates.push({
              id: `${key}${op}${formatNumber(threshold)}`,
              featureKey: key,
              label: `${key} ${op} ${formatNumber(threshold)}`,
              kind: 'numeric',
              op,
              threshold,
              support: scored.support,
              atomSummary: scored.summary,
            });
          }
        }
      }
      emitProgress('predicates', bucketIndex + 1, bucketList.length);
      continue;
    }

    if (
      !bucket.categoryCounts.size ||
      bucket.categoryCounts.size > maxCategories
    ) {
      emitProgress('predicates', bucketIndex + 1, bucketList.length);
      continue;
    }

    for (const { value, count, rowIndexes } of bucket.categoryCounts.values()) {
      if (count < minSupport || count >= rows.length) {
        continue;
      }
      predicates.push({
        id: `${key}==${formatPredicateValue(value)}`,
        featureKey: key,
        label: `${key} == ${formatPredicateValue(value)}`,
        kind: 'category',
        op: '==',
        value,
        support: count,
        atomSummary: summarizeRowIndexes(rows, rowIndexes),
      });
    }

    emitProgress('predicates', bucketIndex + 1, bucketList.length);
  }
  emitProgress('predicates', bucketList.length, bucketList.length, true);

  return { featureKeys: buckets.size, predicates };
};

export const buildAiPocketPredicates = (
  rows: AiPocketSearchRow[],
  options: {
    minSupport?: number;
    maxCategories?: number;
    progressInterval?: number;
    onProgress?: (progress: AiPocketSearchProgress) => void;
  } = {},
): AiPocketPredicate[] =>
  buildAiPocketPredicateResult(rows, options).predicates.map(toPublicPredicate);

const scorePositivePocket = (summary: AiPocketSummary) => {
  const profitFactor =
    summary.profitFactor ?? (summary.grossLoss === 0 ? 8 : 0);
  const winRate = summary.winRate ?? 0;
  return (
    summary.eventBalancedProfit -
    summary.maxDrawdown * 0.6 +
    Math.min(profitFactor, 8) * 12 +
    winRate * 30 +
    Math.log10(summary.events + 1) * 6
  );
};

const scoreNegativePocket = (summary: AiPocketSummary) =>
  -summary.totalProfit +
  summary.maxDrawdown * 0.4 +
  summary.grossLoss * 0.2 +
  summary.maxConsecutiveLosses * 3;

const comparePositivePockets = (left: AiPocketResult, right: AiPocketResult) =>
  (right.validationScore ?? right.score) -
    (left.validationScore ?? left.score) ||
  right.score - left.score ||
  (right.validationSummary?.totalProfit ?? right.summary.totalProfit) -
    (left.validationSummary?.totalProfit ?? left.summary.totalProfit) ||
  right.summary.totalProfit - left.summary.totalProfit ||
  (right.summary.profitFactor ?? 999) - (left.summary.profitFactor ?? 999) ||
  right.summary.support - left.summary.support;

const compareNegativePockets = (left: AiPocketResult, right: AiPocketResult) =>
  (right.validationScore ?? right.score) -
    (left.validationScore ?? left.score) ||
  right.score - left.score ||
  (left.validationSummary?.totalProfit ?? left.summary.totalProfit) -
    (right.validationSummary?.totalProfit ?? right.summary.totalProfit) ||
  left.summary.totalProfit - right.summary.totalProfit ||
  right.summary.grossLoss - left.summary.grossLoss ||
  right.summary.support - left.summary.support;

const mergeDistinctRows = (
  left: AiPocketSearchRow[],
  right: AiPocketSearchRow[],
) => {
  const seenRows = new Set<AiPocketSearchRow>();
  const seenSignalIds = new Set<string>();
  return [...left, ...right].filter((row) => {
    if (seenRows.has(row)) {
      return false;
    }
    seenRows.add(row);
    const signalId =
      typeof row.signalId === 'string' && row.signalId.trim()
        ? row.signalId
        : null;
    if (signalId == null) {
      return true;
    }
    if (seenSignalIds.has(signalId)) {
      return false;
    }
    seenSignalIds.add(signalId);
    return true;
  });
};

const resolveObjectiveRows = ({
  objective,
  selectedRows,
  baselineRows,
}: {
  objective: AiPocketSearchObjective;
  selectedRows: AiPocketSearchRow[];
  baselineRows: AiPocketSearchRow[];
}) =>
  objective === 'add-to-gate'
    ? mergeDistinctRows(baselineRows, selectedRows)
    : selectedRows;

const effectiveProfitFactor = (summary: AiPocketSummary) =>
  summary.profitFactor ??
  (summary.grossLoss === 0 && summary.totalProfit >= 0
    ? Number.POSITIVE_INFINITY
    : 0);

const doesNotRegressRisk = (
  candidate: AiPocketSummary,
  baseline: AiPocketSummary,
) =>
  candidate.totalProfit >= baseline.totalProfit - 1e-9 &&
  effectiveProfitFactor(candidate) >= effectiveProfitFactor(baseline) &&
  candidate.maxDrawdown <= baseline.maxDrawdown + 1e-9 &&
  candidate.maxConsecutiveLosses <= baseline.maxConsecutiveLosses &&
  candidate.losingMonths <= baseline.losingMonths;

const createPocketResult = (
  rows: AiPocketSearchRow[],
  predicates: AiPocketPredicate[],
  mask: Uint8Array,
  validationRows: AiPocketSearchRow[],
  testRows: AiPocketSearchRow[],
  objective: AiPocketSearchObjective,
  baselineRows: AiPocketSearchRow[],
  validationBaselineRows: AiPocketSearchRow[],
  testBaselineRows: AiPocketSearchRow[],
  objectiveBaseline: AiPocketSummary,
  validationObjectiveBaseline: AiPocketSummary,
  testObjectiveBaseline: AiPocketSummary,
) => {
  const publicPredicates = predicates.map(toPublicPredicate);
  const summary = summarizeMask(rows, mask);
  const selectedRows = rows.filter((_, index) => mask[index] === 1);
  const objectiveRows = resolveObjectiveRows({
    objective,
    selectedRows,
    baselineRows,
  });
  const objectiveSummary =
    objective === 'add-to-gate'
      ? summarizeAiPocketRows(objectiveRows)
      : summary;
  const validationMask = validationRows.length
    ? buildPredicateListMask(validationRows, publicPredicates).mask
    : null;
  const validationSummary =
    validationMask == null
      ? undefined
      : summarizeMask(validationRows, validationMask);
  const validationSelectedRows =
    validationMask == null
      ? []
      : validationRows.filter((_, index) => validationMask[index] === 1);
  const validationObjectiveRows = resolveObjectiveRows({
    objective,
    selectedRows: validationSelectedRows,
    baselineRows: validationBaselineRows,
  });
  const validationObjectiveSummary = validationRows.length
    ? objective === 'add-to-gate'
      ? summarizeAiPocketRows(validationObjectiveRows)
      : validationSummary
    : undefined;
  const testMask = testRows.length
    ? buildPredicateListMask(testRows, publicPredicates).mask
    : null;
  const testSummary =
    testMask == null ? undefined : summarizeMask(testRows, testMask);
  const testSelectedRows =
    testMask == null
      ? []
      : testRows.filter((_, index) => testMask[index] === 1);
  const testObjectiveRows = resolveObjectiveRows({
    objective,
    selectedRows: testSelectedRows,
    baselineRows: testBaselineRows,
  });
  const testObjectiveSummary = testRows.length
    ? objective === 'add-to-gate'
      ? summarizeAiPocketRows(testObjectiveRows)
      : testSummary
    : undefined;
  const condition = publicPredicates
    .map((predicate) => predicate.label)
    .join(' AND ');
  const validationScore =
    validationSummary == null || validationObjectiveSummary == null
      ? undefined
      : validationSummary.support > 0
        ? scorePositivePocket(validationObjectiveSummary) -
          (objective === 'standalone'
            ? 0
            : scorePositivePocket(validationObjectiveBaseline))
        : Number.NEGATIVE_INFINITY;
  const testScore =
    testSummary == null || testObjectiveSummary == null
      ? undefined
      : testSummary.support > 0
        ? scorePositivePocket(testObjectiveSummary) -
          (objective === 'standalone'
            ? 0
            : scorePositivePocket(testObjectiveBaseline))
        : Number.NEGATIVE_INFINITY;
  const readinessReasons: string[] = [];
  if (summary.events < PRODUCTION_CANDIDATE_MIN_EVENTS) {
    readinessReasons.push(
      `train events ${summary.events} < ${PRODUCTION_CANDIDATE_MIN_EVENTS}`,
    );
  }
  if (testSummary == null) {
    readinessReasons.push('untouched test missing');
  } else if (testSummary.events < PRODUCTION_CANDIDATE_MIN_EVENTS) {
    readinessReasons.push(
      `test events ${testSummary.events} < ${PRODUCTION_CANDIDATE_MIN_EVENTS}`,
    );
  }
  return {
    id: publicPredicates.map((predicate) => predicate.id).join('&&'),
    depth: publicPredicates.length,
    predicates: publicPredicates,
    condition,
    summary,
    ...(objective === 'standalone' ? {} : { objectiveSummary }),
    ...(validationSummary ? { validationSummary } : {}),
    ...(testSummary ? { testSummary } : {}),
    ...(objective !== 'standalone' && validationObjectiveSummary
      ? { validationObjectiveSummary }
      : {}),
    ...(objective !== 'standalone' && testObjectiveSummary
      ? { testObjectiveSummary }
      : {}),
    ...(validationScore != null ? { validationScore } : {}),
    ...(testScore != null ? { testScore } : {}),
    readiness:
      readinessReasons.length === 0 ? 'production-candidate' : 'research-only',
    readinessReasons,
    score:
      scorePositivePocket(objectiveSummary) -
      (objective === 'standalone' ? 0 : scorePositivePocket(objectiveBaseline)),
  } satisfies AiPocketResult;
};

const hashMask = (mask: Uint8Array) => {
  let hash = 2166136261;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] !== 1) {
      continue;
    }
    hash ^= index + 1;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const isBetterRepresentativePocket = (
  candidate: AiPocketResult,
  existing: AiPocketResult,
  compare: (left: AiPocketResult, right: AiPocketResult) => number,
) =>
  candidate.depth < existing.depth ||
  (candidate.depth === existing.depth &&
    candidate.condition.length < existing.condition.length) ||
  (candidate.depth === existing.depth &&
    candidate.condition.length === existing.condition.length &&
    compare(candidate, existing) < 0);

const estimateCombinationCount = (
  poolSize: number,
  maxDepth: number,
  maxCombinations: number,
) => {
  if (poolSize <= 0 || maxCombinations <= 0) {
    return 0;
  }

  let total = 0;
  let combinationsAtDepth = 1;
  const depthLimit = Math.min(poolSize, maxDepth);
  for (let depth = 1; depth <= depthLimit; depth += 1) {
    combinationsAtDepth =
      (combinationsAtDepth * (poolSize - depth + 1)) / depth;
    total += combinationsAtDepth;
    if (total >= maxCombinations) {
      return maxCombinations;
    }
  }

  return Math.min(Math.trunc(total), maxCombinations);
};

const classifyFeatureFamily = (featureKey: string) => {
  const key = featureKey.toLowerCase();
  if (/(setup|liquidity|doubletap|trendline|pivot|swing|zone)/.test(key)) {
    return 'strategy-structure';
  }
  if (/(structure|breakout|rejection|range|level)/.test(key)) {
    return 'market-structure';
  }
  if (/(participation|volume|turnover|obv|effort)/.test(key)) {
    return 'participation';
  }
  if (/(relative|benchmark|cmc|breadth|targetvs|btc|eth)/.test(key)) {
    return 'relative-market';
  }
  if (/(derivative|funding|openinterest|liquidation|longshort)/.test(key)) {
    return 'derivatives';
  }
  if (/(risk|stop|takeprofit|execution|spread|slippage)/.test(key)) {
    return 'execution-risk';
  }
  if (/(regime|momentum|trend|volatility|atr|macd|rsi|ma)/.test(key)) {
    return 'regime-indicators';
  }
  return 'other';
};

const diversifyPredicatePool = (
  predicates: ScoredPredicate[],
  maximum: number,
) => {
  const byFamily = new Map<string, ScoredPredicate[]>();
  const featureCounts = new Map<string, number>();
  for (const predicate of predicates) {
    const family = classifyFeatureFamily(predicate.featureKey);
    const familyPredicates = byFamily.get(family) ?? [];
    familyPredicates.push(predicate);
    byFamily.set(family, familyPredicates);
  }

  const selected: ScoredPredicate[] = [];
  const selectedIds = new Set<string>();
  while (selected.length < maximum) {
    let added = false;
    for (const familyPredicates of byFamily.values()) {
      while (familyPredicates.length) {
        const predicate = familyPredicates.shift()!;
        if (
          selectedIds.has(predicate.id) ||
          (featureCounts.get(predicate.featureKey) ?? 0) >= 4
        ) {
          continue;
        }
        selected.push(predicate);
        selectedIds.add(predicate.id);
        featureCounts.set(
          predicate.featureKey,
          (featureCounts.get(predicate.featureKey) ?? 0) + 1,
        );
        added = true;
        break;
      }
      if (selected.length >= maximum) {
        break;
      }
    }
    if (!added) {
      break;
    }
  }
  return selected;
};

const prioritizeRequiredFeatureFamilyPredicates = ({
  selected,
  predicates,
  requiredFeatureFamilies,
  maximum,
}: {
  selected: ScoredPredicate[];
  predicates: ScoredPredicate[];
  requiredFeatureFamilies: AiPocketCoverageFamily[];
  maximum: number;
}) => {
  if (!requiredFeatureFamilies.length) {
    return selected;
  }
  const perFamilyLimit = Math.max(
    6,
    Math.floor((maximum * 0.2) / requiredFeatureFamilies.length),
  );
  const prioritized = new Map<string, ScoredPredicate>();
  for (const family of requiredFeatureFamilies) {
    const familyPredicates = predicates.filter(
      (predicate) =>
        classifyAiPocketCoverageFeaturePath(predicate.featureKey) === family,
    );
    const positive = [...familyPredicates]
      .sort(
        (left, right) =>
          scorePositivePocket(right.atomSummary) -
          scorePositivePocket(left.atomSummary),
      )
      .slice(0, Math.ceil(perFamilyLimit * 0.5));
    const negative = [...familyPredicates]
      .sort(
        (left, right) =>
          scoreNegativePocket(right.atomSummary) -
          scoreNegativePocket(left.atomSummary),
      )
      .slice(0, Math.ceil(perFamilyLimit * 0.3));
    const broad = [...familyPredicates]
      .sort((left, right) => right.support - left.support)
      .slice(0, Math.ceil(perFamilyLimit * 0.2));
    for (const predicate of [...positive, ...negative, ...broad]) {
      if (prioritized.size >= perFamilyLimit * requiredFeatureFamilies.length) {
        break;
      }
      prioritized.set(predicate.id, predicate);
    }
  }
  for (const predicate of selected) {
    prioritized.set(predicate.id, predicate);
  }
  return [...prioritized.values()].slice(0, maximum);
};

const canCombinePredicate = (
  chosen: InternalPredicate[],
  candidate: InternalPredicate,
) => {
  const sameFeature = chosen.filter(
    (predicate) => predicate.featureKey === candidate.featureKey,
  );
  if (!sameFeature.length) {
    return true;
  }
  if (
    sameFeature.length !== 1 ||
    sameFeature[0].kind !== 'numeric' ||
    candidate.kind !== 'numeric' ||
    sameFeature[0].op === candidate.op
  ) {
    return false;
  }
  const lower =
    candidate.op === '>=' ? candidate.threshold : sameFeature[0].threshold;
  const upper =
    candidate.op === '<=' ? candidate.threshold : sameFeature[0].threshold;
  return lower <= upper;
};

export const searchAiPockets = (
  rows: AiPocketSearchRow[],
  options: AiPocketSearchOptions = {},
): AiPocketSearchResult => {
  const cadenceProfileOption = options.cadenceProfile;
  const minSupport = Math.max(
    1,
    Math.trunc(cadenceProfileOption?.minSupport ?? options.minSupport ?? 20),
  );
  const minProfitFactor = Math.max(0, options.minProfitFactor ?? 1.2);
  const minTotalProfit = options.minTotalProfit ?? 0;
  const minWinRate = Math.max(0, options.minWinRate ?? 0);
  const maxDepth = Math.max(1, Math.trunc(options.maxDepth ?? 2));
  const maxAtomicPredicates = Math.max(
    1,
    Math.trunc(options.maxAtomicPredicates ?? 180),
  );
  const maxCombinations = Math.max(
    0,
    Math.trunc(options.maxCombinations ?? 60_000),
  );
  const top = Math.max(1, Math.trunc(options.top ?? 50));
  const validationRows = options.validationRows ?? [];
  const testRows = options.testRows ?? [];
  const minValidationSupport = Math.max(
    0,
    Math.trunc(
      cadenceProfileOption?.minValidationSupport ??
        options.minValidationSupport ??
        0,
    ),
  );
  const minEvents = Math.max(
    1,
    Math.trunc(cadenceProfileOption?.minEvents ?? options.minEvents ?? 1),
  );
  const minValidationEvents = Math.max(
    0,
    Math.trunc(
      cadenceProfileOption?.minValidationEvents ??
        options.minValidationEvents ??
        0,
    ),
  );
  const maxBatch = Math.max(1, options.maxBatch ?? Number.POSITIVE_INFINITY);
  const maxEventCountShare = Math.max(
    0,
    Math.min(
      1,
      cadenceProfileOption?.maxEventCountShare ??
        options.maxEventCountShare ??
        1,
    ),
  );
  const maxSymbolCountShare = Math.max(
    0,
    Math.min(1, options.maxSymbolCountShare ?? 1),
  );
  const objective = options.objective ?? 'standalone';
  const baselineRows =
    options.baselineRows ?? (objective === 'filter-gate' ? rows : []);
  const validationBaselineRows =
    options.validationBaselineRows ??
    (objective === 'filter-gate' ? validationRows : []);
  const testBaselineRows =
    options.testBaselineRows ?? (objective === 'filter-gate' ? testRows : []);
  const objectiveBaseline = summarizeAiPocketRows(baselineRows);
  const validationObjectiveBaseline = summarizeAiPocketRows(
    validationBaselineRows,
  );
  const testObjectiveBaseline = summarizeAiPocketRows(testBaselineRows);
  const allowRiskRegression = options.allowRiskRegression === true;
  const requireValidationEligibility =
    options.requireValidationEligibility === true;
  const dedupeEquivalentSelections =
    options.dedupeEquivalentSelections !== false;
  const requiredFeatureFamilies = [
    ...new Set(options.requiredFeatureFamilies ?? []),
  ];
  const excludedFeatureFamilies = [
    ...new Set(options.excludedFeatureFamilies ?? []),
  ];
  const progressInterval = Math.max(
    1,
    Math.trunc(options.progressInterval ?? 500),
  );
  const onProgress = options.onProgress;
  const summarizePartition = (partitionRows: AiPocketSearchRow[]) => {
    const summary = summarizeAiPocketRows(partitionRows);
    const periodDays = getPeriodDays(partitionRows);
    return {
      rows: partitionRows.length,
      events: summary.events,
      periodDays,
      eventsPerDay: periodDays == null ? null : summary.events / periodDays,
    };
  };
  const trainPartition = summarizePartition(rows);
  const validationPartition = summarizePartition(validationRows);
  const testPartition = summarizePartition(testRows);
  const cadenceProfile: AiPocketCadenceProfile = cadenceProfileOption ?? {
    mode: 'fixed',
    lowCadence: false,
    sparseSample: false,
    adaptiveThresholds: false,
    trainRows: trainPartition.rows,
    trainEvents: trainPartition.events,
    trainPeriodDays: trainPartition.periodDays,
    trainEventsPerDay: trainPartition.eventsPerDay,
    validationRows: validationPartition.rows,
    validationEvents: validationPartition.events,
    testRows: testPartition.rows,
    testEvents: testPartition.events,
    minSupport,
    minEvents,
    minValidationSupport,
    minValidationEvents,
    maxEventCountShare,
  };

  const predicateResult = buildAiPocketPredicateResult(rows, {
    minSupport,
    maxCategories: options.maxCategories,
    progressInterval,
    onProgress,
  });
  const predicates = predicateResult.predicates.filter((predicate) => {
    const family = classifyAiPocketCoverageFeaturePath(predicate.featureKey);
    return family == null || !excludedFeatureFamilies.includes(family);
  });
  let lastMaskProgress = 0;
  const emitMaskProgress = (current: number, done = false) => {
    if (!onProgress) {
      return;
    }
    if (!done && current - lastMaskProgress < progressInterval) {
      return;
    }
    lastMaskProgress = current;
    onProgress({
      phase: 'masks',
      current,
      total: predicates.length,
      done,
      truncated: false,
    });
  };
  predicates.forEach((_, index) => emitMaskProgress(index + 1));
  const scoredPredicates = predicates;
  emitMaskProgress(predicates.length, true);

  const predicatePool = [...scoredPredicates]
    .sort(
      (left, right) =>
        scorePositivePocket(right.atomSummary) -
        scorePositivePocket(left.atomSummary),
    )
    .slice(0, Math.ceil(maxAtomicPredicates * 0.55));
  const negativePool = [...scoredPredicates]
    .sort(
      (left, right) =>
        scoreNegativePocket(right.atomSummary) -
        scoreNegativePocket(left.atomSummary),
    )
    .slice(0, Math.ceil(maxAtomicPredicates * 0.3));
  const supportPool = [...scoredPredicates]
    .sort((left, right) => right.support - left.support)
    .slice(0, Math.ceil(maxAtomicPredicates * 0.2));
  const predicatePoolById = new Map<string, ScoredPredicate>();
  [...predicatePool, ...negativePool, ...supportPool].forEach((predicate) => {
    predicatePoolById.set(predicate.id, predicate);
  });
  const diversifiedPredicates = prioritizeRequiredFeatureFamilyPredicates({
    selected: diversifyPredicatePool(
      [...predicatePoolById.values()],
      maxAtomicPredicates,
    ),
    predicates: scoredPredicates,
    requiredFeatureFamilies,
    maximum: maxAtomicPredicates,
  });
  const selectedPredicatePool = diversifiedPredicates.map(
    (predicate): InternalPredicate => {
      const { mask, support } = buildMask(rows, predicate);
      return {
        ...predicate,
        mask,
        support,
      };
    },
  );
  const estimatedCombinations = estimateCombinationCount(
    selectedPredicatePool.length,
    maxDepth,
    maxCombinations,
  );

  const positivePockets = new Map<string, AiPocketResult>();
  const negativePockets = new Map<string, AiPocketResult>();
  const positiveSelectionKeys = new Map<string, AiPocketResult>();
  const negativeSelectionKeys = new Map<string, AiPocketResult>();
  let combinationsEvaluated = 0;
  let duplicatePocketsSkipped = 0;
  let truncated = false;
  let lastProgressCombinations = 0;

  const emitProgress = (done = false) => {
    if (!onProgress) {
      return;
    }
    if (
      !done &&
      combinationsEvaluated - lastProgressCombinations < progressInterval
    ) {
      return;
    }

    lastProgressCombinations = combinationsEvaluated;
    onProgress({
      phase: 'combinations',
      current: Math.min(combinationsEvaluated, estimatedCombinations),
      total: estimatedCombinations,
      done,
      truncated,
    });
  };

  const addPocket = (
    pocketPredicates: AiPocketPredicate[],
    mask: Uint8Array,
  ) => {
    if (
      requiredFeatureFamilies.some(
        (family) =>
          !pocketPredicates.some(
            (predicate) =>
              classifyAiPocketCoverageFeaturePath(predicate.featureKey) ===
              family,
          ),
      )
    ) {
      return;
    }
    const pocket = createPocketResult(
      rows,
      pocketPredicates,
      mask,
      validationRows,
      testRows,
      objective,
      baselineRows,
      validationBaselineRows,
      testBaselineRows,
      objectiveBaseline,
      validationObjectiveBaseline,
      testObjectiveBaseline,
    );
    const { summary } = pocket;
    const scoredSummary = pocket.objectiveSummary ?? summary;
    const profitFactor =
      scoredSummary.profitFactor ??
      (scoredSummary.grossLoss === 0 && scoredSummary.totalProfit > 0
        ? Number.POSITIVE_INFINITY
        : 0);
    const winRate = scoredSummary.winRate ?? 0;
    const validationSupport = pocket.validationSummary?.support ?? 0;
    const validationEligible =
      !validationRows.length ||
      (validationSupport >= minValidationSupport &&
        (pocket.validationSummary?.events ?? 0) >= minValidationEvents &&
        (pocket.validationSummary?.maxBatch ?? 0) <= maxBatch &&
        (pocket.validationSummary?.topEventCountShare ?? 0) <=
          maxEventCountShare &&
        (pocket.validationSummary?.topSymbolCountShare ?? 0) <=
          maxSymbolCountShare &&
        (!requireValidationEligibility ||
          ((pocket.validationObjectiveSummary ?? pocket.validationSummary)!
            .totalProfit >= minTotalProfit &&
            effectiveProfitFactor(
              (pocket.validationObjectiveSummary ?? pocket.validationSummary)!,
            ) >= minProfitFactor &&
            ((pocket.validationObjectiveSummary ?? pocket.validationSummary)!
              .winRate ?? 0) >= minWinRate)));
    const concentrationEligible =
      summary.events >= minEvents &&
      summary.maxBatch <= maxBatch &&
      (summary.topEventCountShare ?? 0) <= maxEventCountShare &&
      (summary.topSymbolCountShare ?? 0) <= maxSymbolCountShare;
    const riskEligible =
      objective === 'standalone' ||
      allowRiskRegression ||
      ((!objectiveBaseline.support ||
        doesNotRegressRisk(scoredSummary, objectiveBaseline)) &&
        (!validationRows.length ||
          !validationObjectiveBaseline.support ||
          doesNotRegressRisk(
            pocket.validationObjectiveSummary ?? pocket.validationSummary!,
            validationObjectiveBaseline,
          )));

    if (
      summary.support >= minSupport &&
      scoredSummary.totalProfit >= minTotalProfit &&
      profitFactor >= minProfitFactor &&
      winRate >= minWinRate &&
      validationEligible &&
      concentrationEligible &&
      riskEligible
    ) {
      const selectionKey = `${summary.support}:${hashMask(mask)}`;
      const mapKey = dedupeEquivalentSelections ? selectionKey : pocket.id;
      const existing = dedupeEquivalentSelections
        ? positiveSelectionKeys.get(mapKey)
        : positivePockets.get(mapKey);
      if (
        !existing ||
        isBetterRepresentativePocket(pocket, existing, comparePositivePockets)
      ) {
        positivePockets.delete(existing?.id ?? '');
        positivePockets.set(pocket.id, pocket);
        positiveSelectionKeys.set(mapKey, pocket);
      } else {
        duplicatePocketsSkipped += 1;
      }
    }

    if (summary.support >= minSupport && summary.totalProfit < 0) {
      const negativePocket = {
        ...pocket,
        score: scoreNegativePocket(summary),
        ...(pocket.validationSummary
          ? { validationScore: scoreNegativePocket(pocket.validationSummary) }
          : {}),
      };
      const selectionKey = `${summary.support}:${hashMask(mask)}`;
      const mapKey = dedupeEquivalentSelections ? selectionKey : pocket.id;
      const existing = dedupeEquivalentSelections
        ? negativeSelectionKeys.get(mapKey)
        : negativePockets.get(mapKey);
      if (
        !existing ||
        isBetterRepresentativePocket(
          negativePocket,
          existing,
          compareNegativePockets,
        )
      ) {
        negativePockets.delete(existing?.id ?? '');
        negativePockets.set(negativePocket.id, negativePocket);
        negativeSelectionKeys.set(mapKey, negativePocket);
      } else {
        duplicatePocketsSkipped += 1;
      }
    }
  };

  const visit = ({
    startIndex,
    chosen,
    mask,
  }: {
    startIndex: number;
    chosen: InternalPredicate[];
    mask: Uint8Array | null;
  }) => {
    if (truncated) {
      return;
    }
    for (
      let index = startIndex;
      index < selectedPredicatePool.length;
      index += 1
    ) {
      if (combinationsEvaluated >= maxCombinations) {
        truncated = true;
        return;
      }

      const predicate = selectedPredicatePool[index];
      if (!canCombinePredicate(chosen, predicate)) {
        continue;
      }

      const intersection =
        mask == null
          ? { mask: predicate.mask, support: predicate.support }
          : intersectMasks(mask, predicate.mask);
      const nextMask = intersection.mask;
      combinationsEvaluated += 1;
      emitProgress();
      const support = intersection.support;
      if (support < minSupport) {
        continue;
      }

      const nextChosen = [...chosen, predicate];
      addPocket(nextChosen, nextMask);

      if (nextChosen.length >= maxDepth) {
        continue;
      }

      visit({
        startIndex: index + 1,
        chosen: nextChosen,
        mask: nextMask,
      });
    }
  };

  visit({
    startIndex: 0,
    chosen: [],
    mask: null,
  });
  emitProgress(true);

  return {
    objective,
    baseline: summarizeAiPocketRows(rows),
    ...(validationRows.length
      ? { validationBaseline: summarizeAiPocketRows(validationRows) }
      : {}),
    ...(testRows.length
      ? { testBaseline: summarizeAiPocketRows(testRows) }
      : {}),
    ...(objective === 'standalone' ? {} : { objectiveBaseline }),
    ...(objective !== 'standalone' && validationRows.length
      ? { validationObjectiveBaseline }
      : {}),
    ...(objective !== 'standalone' && testRows.length
      ? { testObjectiveBaseline }
      : {}),
    predicates: predicates.map(toPublicPredicate),
    positivePockets: [...positivePockets.values()]
      .sort(comparePositivePockets)
      .slice(0, top),
    negativePockets: [...negativePockets.values()]
      .sort(compareNegativePockets)
      .slice(0, top),
    stats: {
      rows: rows.length,
      featureKeys: new Set(predicates.map((predicate) => predicate.featureKey))
        .size,
      predicates: predicates.length,
      atomicPredicatesUsed: selectedPredicatePool.length,
      estimatedCombinations,
      combinationsEvaluated,
      validationRows: validationRows.length,
      testRows: testRows.length,
      duplicatePocketsSkipped,
      featureFamiliesUsed: [
        ...new Set(
          selectedPredicatePool.map((predicate) =>
            classifyFeatureFamily(predicate.featureKey),
          ),
        ),
      ],
      requiredFeatureFamilies,
      excludedFeatureFamilies,
      cadence: cadenceProfile,
      truncated,
    },
  };
};

export { buildAiPocketMarkdownReport } from './aiPocketSearch/markdownReport';
