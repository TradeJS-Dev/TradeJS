import type { AiPayload } from '@tradejs/types';
import type {
  AiTrainEvaluation,
  AiTrainQualityThresholdSummary,
} from './aiTrainMetrics';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30.4375;

export type AiPocketPrimitive = string | number | boolean | null;

export type AiPocketFeatureMap = Record<string, AiPocketPrimitive>;

export type AiPocketSearchRow = AiTrainEvaluation & {
  signalId?: string;
  symbol?: string;
  strategy?: string;
  modelCandidate?: boolean;
  features: AiPocketFeatureMap;
};

export type AiPocketSearchOptions = {
  minSupport?: number;
  minProfitFactor?: number;
  minTotalProfit?: number;
  minWinRate?: number;
  maxDepth?: number;
  maxAtomicPredicates?: number;
  maxCombinations?: number;
  maxCategories?: number;
  top?: number;
  progressInterval?: number;
  onProgress?: (progress: AiPocketSearchProgress) => void;
  validationRows?: AiPocketSearchRow[];
  minValidationSupport?: number;
  dedupeEquivalentSelections?: boolean;
};

export type AiPocketPredicate =
  | {
      id: string;
      featureKey: string;
      label: string;
      kind: 'numeric';
      op: '<=' | '>=';
      threshold: number;
    }
  | {
      id: string;
      featureKey: string;
      label: string;
      kind: 'category';
      op: '==';
      value: string | boolean | null;
    };

export type AiPocketSummary = {
  support: number;
  supportRatio: number;
  totalProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  winRate: number | null;
  avgProfit: number | null;
  maxDrawdown: number;
  maxDrawdownPctOfGrossProfit: number | null;
  maxDrawdownPctOfTotalProfit: number | null;
  recoveryFactor: number | null;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  avgTradesPerDay: number | null;
  avgTradesPerWeek: number | null;
  avgProfitPerDay: number | null;
  avgProfitPerMonth: number | null;
  losingMonths: number;
  worstMonth: { month: string; totalProfit: number } | null;
  directionCounts: Record<string, number>;
  topSymbols: Array<{ symbol: string; count: number; totalProfit: number }>;
};

export type AiPocketResult = {
  id: string;
  depth: number;
  predicates: AiPocketPredicate[];
  condition: string;
  summary: AiPocketSummary;
  validationSummary?: AiPocketSummary;
  validationScore?: number;
  score: number;
};

export type AiPocketSearchResult = {
  baseline: AiPocketSummary;
  validationBaseline?: AiPocketSummary;
  predicates: AiPocketPredicate[];
  positivePockets: AiPocketResult[];
  negativePockets: AiPocketResult[];
  stats: {
    rows: number;
    featureKeys: number;
    predicates: number;
    atomicPredicatesUsed: number;
    estimatedCombinations: number;
    combinationsEvaluated: number;
    validationRows: number;
    duplicatePocketsSkipped: number;
    truncated: boolean;
  };
};

export type AiPocketSearchProgress = {
  phase: 'combinations';
  current: number;
  total: number;
  done: boolean;
  truncated: boolean;
};

export type AiPocketSearchRunReport = {
  strategy: string;
  filePaths: string[];
  sourceRows: number;
  selectedRows: number;
  evaluatedRows: number;
  scope: string;
  scopeRows: number;
  trainRows: number;
  validationRows: number;
  scanned: number;
  dateSkipped: number;
  failed: number;
  recent: number;
  skip: number;
  since: number | null;
  until: number | null;
  period: string | null;
  minQuality: number;
  qualityThresholds: number[];
  includeSymbol: boolean;
  includeGateContext: boolean;
  validationSplit: number;
  minValidationSupport: number;
  reportPath: string;
  search: {
    maxDepth: number;
    minSupport: number;
    minProfitFactor: number;
    minWinRate: number;
    minTotalProfit: number;
    maxAtomicPredicates: number;
    maxCombinations: number;
    top: number;
  };
};

export type AiPocketMarkdownReport = {
  generatedAt: number;
  run: AiPocketSearchRunReport;
  currentGate: {
    qualityThresholds: AiTrainQualityThresholdSummary[];
  };
  pocketSearch: AiPocketSearchResult;
  errors: string[];
};

type FeatureCollectionOptions = {
  includeSymbol?: boolean;
  includeGateContext?: boolean;
};

type InternalPredicate = AiPocketPredicate & {
  mask: Uint8Array;
  support: number;
  atomSummary: AiPocketSummary;
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

const addFlattenedFeatures = ({
  output,
  value,
  segments,
  maxDepth,
}: {
  output: AiPocketFeatureMap;
  value: unknown;
  segments: string[];
  maxDepth: number;
}) => {
  if (!segments.length && !isPlainRecord(value)) {
    return;
  }
  if (segments.length > maxDepth || isOutcomePath(segments)) {
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

export const collectAiPocketFeatures = ({
  payload,
  gateContext,
  includeSymbol = false,
  includeGateContext = false,
}: {
  payload: AiPayload;
  gateContext?: unknown;
} & FeatureCollectionOptions): AiPocketFeatureMap => {
  const features: AiPocketFeatureMap = {};
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
  });
  addDirectionalDerivedFeatures(features);

  return features;
};

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

const summarizeSelectedRows = (
  rows: AiPocketSearchRow[],
  selected: AiPocketSearchRow[],
): AiPocketSummary => {
  const fullPeriodDays = getPeriodDays(rows);
  const support = selected.length;
  const supportRatio = rows.length > 0 ? support / rows.length : 0;

  if (!selected.length) {
    return {
      support: 0,
      supportRatio,
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
    };
  }

  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  const directionCounts = new Map<string, number>();
  const symbolCounts = new Map<
    string,
    {
      count: number;
      totalProfit: number;
    }
  >();
  const monthProfits = new Map<string, number>();

  for (const row of selected) {
    const profit = Number(row.profit);
    if (profit > 0) {
      grossProfit += profit;
      wins += 1;
      currentWinStreak += 1;
      currentLossStreak = 0;
    } else if (profit < 0) {
      grossLoss += Math.abs(profit);
      losses += 1;
      currentLossStreak += 1;
      currentWinStreak = 0;
    } else {
      currentWinStreak = 0;
      currentLossStreak = 0;
    }

    maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWinStreak);
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLossStreak);

    const direction =
      typeof row.direction === 'string' && row.direction.trim()
        ? row.direction
        : 'UNKNOWN';
    directionCounts.set(direction, (directionCounts.get(direction) ?? 0) + 1);

    const symbol =
      typeof row.symbol === 'string' && row.symbol.trim()
        ? row.symbol
        : 'UNKNOWN';
    const symbolBucket = symbolCounts.get(symbol) ?? {
      count: 0,
      totalProfit: 0,
    };
    symbolBucket.count += 1;
    symbolBucket.totalProfit += profit;
    symbolCounts.set(symbol, symbolBucket);

    const month =
      typeof row.timestamp === 'number' && Number.isFinite(row.timestamp)
        ? new Date(row.timestamp).toISOString().slice(0, 7)
        : 'UNKNOWN';
    monthProfits.set(month, (monthProfits.get(month) ?? 0) + profit);
  }

  let equity = 0;
  let peakEquity = 0;
  let maxDrawdown = 0;
  const sortedSelected = [...selected].sort((left, right) => {
    const leftTimestamp =
      typeof left.timestamp === 'number' && Number.isFinite(left.timestamp)
        ? left.timestamp
        : Number.POSITIVE_INFINITY;
    const rightTimestamp =
      typeof right.timestamp === 'number' && Number.isFinite(right.timestamp)
        ? right.timestamp
        : Number.POSITIVE_INFINITY;
    return leftTimestamp - rightTimestamp;
  });

  for (const row of sortedSelected) {
    equity += Number(row.profit);
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdown = Math.max(maxDrawdown, Math.max(0, peakEquity - equity));
  }

  const totalProfit = grossProfit - grossLoss;
  const avgTradesPerDay =
    fullPeriodDays == null ? null : support / fullPeriodDays;
  const avgProfitPerDay =
    fullPeriodDays == null ? null : totalProfit / fullPeriodDays;
  const losingMonthEntries = [...monthProfits.entries()].filter(
    ([, profit]) => profit < 0,
  );
  const worstMonth =
    [...monthProfits.entries()].sort((left, right) => left[1] - right[1])[0] ??
    null;

  return {
    support,
    supportRatio,
    totalProfit,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    winRate: support > 0 ? wins / support : null,
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
    directionCounts: Object.fromEntries(directionCounts.entries()),
    topSymbols: [...symbolCounts.entries()]
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

const selectedRowsFromMask = (rows: AiPocketSearchRow[], mask: Uint8Array) =>
  rows.filter((_, index) => mask[index] === 1);

const summarizeMask = (rows: AiPocketSearchRow[], mask: Uint8Array) =>
  summarizeSelectedRows(rows, selectedRowsFromMask(rows, mask));

export const summarizeAiPocketRows = (rows: AiPocketSearchRow[]) =>
  summarizeSelectedRows(rows, rows);

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

export const buildAiPocketPredicates = (
  rows: AiPocketSearchRow[],
  options: {
    minSupport?: number;
    maxCategories?: number;
  } = {},
): AiPocketPredicate[] => {
  const minSupport = Math.max(1, Math.trunc(options.minSupport ?? 20));
  const maxCategories = Math.max(2, Math.trunc(options.maxCategories ?? 24));
  const keys = new Set<string>();
  for (const row of rows) {
    Object.keys(row.features).forEach((key) => keys.add(key));
  }

  const predicates: AiPocketPredicate[] = [];
  for (const key of [...keys].sort()) {
    const values = rows
      .map((row) => row.features[key])
      .filter((value): value is AiPocketPrimitive => value !== undefined);
    if (values.length < minSupport) {
      continue;
    }

    const numericValues = values
      .filter(isFiniteNumber)
      .sort((left, right) => left - right);
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

        for (const threshold of [...thresholdSet].sort(
          (left, right) => left - right,
        )) {
          for (const op of ['<=', '>='] as const) {
            const support = numericValues.filter((value) =>
              op === '<=' ? value <= threshold : value >= threshold,
            ).length;
            if (support < minSupport || support >= rows.length) {
              continue;
            }
            predicates.push({
              id: `${key}${op}${formatNumber(threshold)}`,
              featureKey: key,
              label: `${key} ${op} ${formatNumber(threshold)}`,
              kind: 'numeric',
              op,
              threshold,
            });
          }
        }
      }
      continue;
    }

    const categoryCounts = new Map<
      string,
      {
        value: string | boolean | null;
        count: number;
      }
    >();
    for (const value of values) {
      if (
        typeof value !== 'string' &&
        typeof value !== 'boolean' &&
        value !== null
      ) {
        continue;
      }
      const serialized = JSON.stringify(value);
      const bucket = categoryCounts.get(serialized) ?? {
        value,
        count: 0,
      };
      bucket.count += 1;
      categoryCounts.set(serialized, bucket);
    }

    if (!categoryCounts.size || categoryCounts.size > maxCategories) {
      continue;
    }

    for (const { value, count } of categoryCounts.values()) {
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
      });
    }
  }

  return predicates;
};

const scorePositivePocket = (summary: AiPocketSummary) => {
  const profitFactor =
    summary.profitFactor ?? (summary.grossLoss === 0 ? 8 : 0);
  const winRate = summary.winRate ?? 0;
  return (
    summary.totalProfit -
    summary.maxDrawdown * 0.6 +
    Math.min(profitFactor, 8) * 12 +
    winRate * 30 +
    Math.log10(summary.support + 1) * 6
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

const createPocketResult = (
  rows: AiPocketSearchRow[],
  predicates: AiPocketPredicate[],
  mask: Uint8Array,
  validationRows: AiPocketSearchRow[],
) => {
  const summary = summarizeMask(rows, mask);
  const validationMask = validationRows.length
    ? buildPredicateListMask(validationRows, predicates).mask
    : null;
  const validationSummary =
    validationMask == null
      ? undefined
      : summarizeMask(validationRows, validationMask);
  const condition = predicates
    .map((predicate) => predicate.label)
    .join(' AND ');
  const validationScore =
    validationSummary == null
      ? undefined
      : validationSummary.support > 0
        ? scorePositivePocket(validationSummary)
        : Number.NEGATIVE_INFINITY;
  return {
    id: predicates.map((predicate) => predicate.id).join('&&'),
    depth: predicates.length,
    predicates,
    condition,
    summary,
    ...(validationSummary ? { validationSummary } : {}),
    ...(validationScore != null ? { validationScore } : {}),
    score: scorePositivePocket(summary),
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

export const searchAiPockets = (
  rows: AiPocketSearchRow[],
  options: AiPocketSearchOptions = {},
): AiPocketSearchResult => {
  const minSupport = Math.max(1, Math.trunc(options.minSupport ?? 20));
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
  const minValidationSupport = Math.max(
    0,
    Math.trunc(options.minValidationSupport ?? 0),
  );
  const dedupeEquivalentSelections =
    options.dedupeEquivalentSelections !== false;
  const progressInterval = Math.max(
    1,
    Math.trunc(options.progressInterval ?? 500),
  );
  const onProgress = options.onProgress;

  const featureKeys = new Set<string>();
  rows.forEach((row) =>
    Object.keys(row.features).forEach((key) => featureKeys.add(key)),
  );
  const predicates = buildAiPocketPredicates(rows, {
    minSupport,
    maxCategories: options.maxCategories,
  });
  const internalPredicates = predicates
    .map((predicate): InternalPredicate | null => {
      const { mask, support } = buildMask(rows, predicate);
      if (support < minSupport) {
        return null;
      }
      return {
        ...predicate,
        mask,
        support,
        atomSummary: summarizeMask(rows, mask),
      };
    })
    .filter((predicate): predicate is InternalPredicate => predicate != null);

  const predicatePool = [...internalPredicates]
    .sort(
      (left, right) =>
        scorePositivePocket(right.atomSummary) -
        scorePositivePocket(left.atomSummary),
    )
    .slice(0, Math.ceil(maxAtomicPredicates * 0.55));
  const negativePool = [...internalPredicates]
    .sort(
      (left, right) =>
        scoreNegativePocket(right.atomSummary) -
        scoreNegativePocket(left.atomSummary),
    )
    .slice(0, Math.ceil(maxAtomicPredicates * 0.3));
  const supportPool = [...internalPredicates]
    .sort((left, right) => right.support - left.support)
    .slice(0, Math.ceil(maxAtomicPredicates * 0.2));
  const predicatePoolById = new Map<string, InternalPredicate>();
  [...predicatePool, ...negativePool, ...supportPool].forEach((predicate) => {
    if (predicatePoolById.size < maxAtomicPredicates) {
      predicatePoolById.set(predicate.id, predicate);
    }
  });
  const selectedPredicatePool = [...predicatePoolById.values()];
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
    const pocket = createPocketResult(
      rows,
      pocketPredicates,
      mask,
      validationRows,
    );
    const { summary } = pocket;
    const profitFactor =
      summary.profitFactor ??
      (summary.grossLoss === 0 && summary.totalProfit > 0
        ? Number.POSITIVE_INFINITY
        : 0);
    const winRate = summary.winRate ?? 0;
    const validationSupport = pocket.validationSummary?.support ?? 0;
    const validationEligible =
      !validationRows.length || validationSupport >= minValidationSupport;

    if (
      summary.support >= minSupport &&
      summary.totalProfit >= minTotalProfit &&
      profitFactor >= minProfitFactor &&
      winRate >= minWinRate &&
      validationEligible
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
    usedFeatureKeys,
  }: {
    startIndex: number;
    chosen: InternalPredicate[];
    mask: Uint8Array | null;
    usedFeatureKeys: Set<string>;
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
      if (usedFeatureKeys.has(predicate.featureKey)) {
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

      const nextUsedFeatureKeys = new Set(usedFeatureKeys);
      nextUsedFeatureKeys.add(predicate.featureKey);
      visit({
        startIndex: index + 1,
        chosen: nextChosen,
        mask: nextMask,
        usedFeatureKeys: nextUsedFeatureKeys,
      });
    }
  };

  visit({
    startIndex: 0,
    chosen: [],
    mask: null,
    usedFeatureKeys: new Set(),
  });
  emitProgress(true);

  return {
    baseline: summarizeAiPocketRows(rows),
    ...(validationRows.length
      ? { validationBaseline: summarizeAiPocketRows(validationRows) }
      : {}),
    predicates,
    positivePockets: [...positivePockets.values()]
      .sort(comparePositivePockets)
      .slice(0, top),
    negativePockets: [...negativePockets.values()]
      .sort(compareNegativePockets)
      .slice(0, top),
    stats: {
      rows: rows.length,
      featureKeys: featureKeys.size,
      predicates: predicates.length,
      atomicPredicatesUsed: selectedPredicatePool.length,
      estimatedCombinations,
      combinationsEvaluated,
      validationRows: validationRows.length,
      duplicatePocketsSkipped,
      truncated,
    },
  };
};

const formatMdNumber = (value: number | null, digits = 2) =>
  value == null || !Number.isFinite(value) ? 'n/a' : value.toFixed(digits);

const formatMdPercent = (value: number | null) =>
  value == null || !Number.isFinite(value)
    ? 'n/a'
    : `${(value * 100).toFixed(1)}%`;

const escapeMarkdownCell = (value: unknown) =>
  String(value ?? 'n/a')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>');

const markdownTable = (headers: string[], rows: unknown[][]) => {
  const header = `| ${headers.map(escapeMarkdownCell).join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(
    (row) => `| ${row.map(escapeMarkdownCell).join(' | ')} |`,
  );
  return [header, divider, ...body].join('\n');
};

const summaryMetricRows = (summary: AiPocketSummary) => [
  ['rows', summary.support],
  ['win_rate', formatMdPercent(summary.winRate)],
  ['total_profit', formatMdNumber(summary.totalProfit)],
  ['gross_profit', formatMdNumber(summary.grossProfit)],
  ['gross_loss', formatMdNumber(-summary.grossLoss)],
  ['profit_factor', formatMdNumber(summary.profitFactor)],
  ['max_drawdown', formatMdNumber(summary.maxDrawdown)],
  [
    'max_drawdown_pct_of_gross_profit',
    formatMdPercent(summary.maxDrawdownPctOfGrossProfit),
  ],
  [
    'max_drawdown_pct_of_total_profit',
    formatMdPercent(summary.maxDrawdownPctOfTotalProfit),
  ],
  ['max_consecutive_losses', summary.maxConsecutiveLosses],
  ['avg_trades_per_day', formatMdNumber(summary.avgTradesPerDay)],
  ['avg_trades_per_week', formatMdNumber(summary.avgTradesPerWeek)],
  ['avg_profit_per_day', formatMdNumber(summary.avgProfitPerDay)],
  ['avg_profit_per_month', formatMdNumber(summary.avgProfitPerMonth)],
  ['losing_months', summary.losingMonths],
  [
    'worst_month',
    summary.worstMonth
      ? `${summary.worstMonth.month} ${formatMdNumber(summary.worstMonth.totalProfit)}`
      : 'n/a',
  ],
];

const pocketRows = (pockets: AiPocketResult[]) =>
  pockets.map((pocket, index) => [
    index + 1,
    pocket.summary.support,
    formatMdPercent(pocket.summary.supportRatio),
    formatMdPercent(pocket.summary.winRate),
    formatMdNumber(pocket.summary.profitFactor),
    formatMdNumber(pocket.summary.totalProfit),
    formatMdNumber(pocket.summary.maxDrawdown),
    pocket.validationSummary?.support ?? 'n/a',
    pocket.validationSummary
      ? formatMdPercent(pocket.validationSummary.winRate)
      : 'n/a',
    pocket.validationSummary
      ? formatMdNumber(pocket.validationSummary.profitFactor)
      : 'n/a',
    pocket.validationSummary
      ? formatMdNumber(pocket.validationSummary.totalProfit)
      : 'n/a',
    formatMdNumber(pocket.summary.avgTradesPerDay),
    pocket.summary.losingMonths,
    formatMdNumber(pocket.score),
    pocket.condition,
  ]);

export const buildAiPocketMarkdownReport = ({
  generatedAt,
  run,
  currentGate,
  pocketSearch,
  errors,
}: AiPocketMarkdownReport) => {
  const generatedIso = new Date(generatedAt).toISOString();
  const lines = [
    '# AI Pocket Search Report',
    '',
    `Generated: ${generatedIso}`,
    '',
    '## Run',
    '',
    markdownTable(
      ['Field', 'Value'],
      [
        ['strategy', run.strategy],
        ['source_rows', run.sourceRows],
        ['selected_rows', run.selectedRows],
        ['evaluated_rows', run.evaluatedRows],
        ['scope', run.scope],
        ['scope_rows', run.scopeRows],
        ['train_rows', run.trainRows],
        ['validation_rows', run.validationRows],
        ['validation_split', formatMdPercent(run.validationSplit)],
        ['min_validation_support', run.minValidationSupport],
        ['failed', run.failed],
        ['recent', run.recent === 0 ? 'all' : run.recent],
        ['skip', run.skip],
        [
          'since',
          run.since == null ? 'n/a' : new Date(run.since).toISOString(),
        ],
        [
          'until',
          run.until == null ? 'n/a' : new Date(run.until).toISOString(),
        ],
        ['period', run.period ?? 'n/a'],
        ['min_quality', run.minQuality],
        ['max_depth', run.search.maxDepth],
        ['min_support', run.search.minSupport],
        ['max_atomic_predicates', run.search.maxAtomicPredicates],
        ['max_combinations', run.search.maxCombinations],
        ['include_symbol', run.includeSymbol ? 'on' : 'off'],
        ['include_gate_context', run.includeGateContext ? 'on' : 'off'],
        ['report_path', run.reportPath],
      ],
    ),
    '',
    '## Dataset Files',
    '',
    ...run.filePaths.map((filePath) => `- \`${filePath}\``),
    '',
    '## Current Gate qN+ Baseline',
    '',
    markdownTable(
      ['Q', 'Approved', 'WR', 'PF', 'PNL', 'Max DD', 'Trades/Day', 'PNL/Day'],
      currentGate.qualityThresholds.map(({ label, summary }) => [
        label,
        summary.approved,
        formatMdPercent(summary.approvedRisk.winRate),
        formatMdNumber(summary.approvedRisk.profitFactor),
        formatMdNumber(summary.approvedRisk.totalProfit),
        formatMdNumber(summary.approvedRisk.maxDrawdown),
        formatMdNumber(summary.avgApprovedTradesPerDay),
        formatMdNumber(summary.avgProfitApprovedPerDay),
      ]),
    ),
    '',
    '## Train Baseline',
    '',
    markdownTable(
      ['Metric', 'Value'],
      summaryMetricRows(pocketSearch.baseline),
    ),
    '',
    ...(pocketSearch.validationBaseline
      ? [
          '## Validation Baseline',
          '',
          markdownTable(
            ['Metric', 'Value'],
            summaryMetricRows(pocketSearch.validationBaseline),
          ),
          '',
        ]
      : []),
    '## Search Stats',
    '',
    markdownTable(
      ['Field', 'Value'],
      [
        ['feature_keys', pocketSearch.stats.featureKeys],
        ['predicates', pocketSearch.stats.predicates],
        ['atomic_used', pocketSearch.stats.atomicPredicatesUsed],
        ['estimated_combinations', pocketSearch.stats.estimatedCombinations],
        ['combinations_evaluated', pocketSearch.stats.combinationsEvaluated],
        ['validation_rows', pocketSearch.stats.validationRows],
        [
          'duplicate_pockets_skipped',
          pocketSearch.stats.duplicatePocketsSkipped,
        ],
        ['truncated', pocketSearch.stats.truncated ? 'yes' : 'no'],
      ],
    ),
    '',
    '## Top Positive Pockets',
    '',
    markdownTable(
      [
        '#',
        'N',
        'Support',
        'WR',
        'PF',
        'PNL',
        'Max DD',
        'Val N',
        'Val WR',
        'Val PF',
        'Val PNL',
        'Trades/Day',
        'Losing Months',
        'Score',
        'Pocket',
      ],
      pocketRows(pocketSearch.positivePockets),
    ),
    '',
    '## Top Loss Pockets',
    '',
    markdownTable(
      [
        '#',
        'N',
        'Support',
        'WR',
        'PF',
        'PNL',
        'Max DD',
        'Val N',
        'Val WR',
        'Val PF',
        'Val PNL',
        'Trades/Day',
        'Losing Months',
        'Score',
        'Pocket',
      ],
      pocketRows(pocketSearch.negativePockets),
    ),
    '',
  ];

  if (errors.length) {
    lines.push('## Errors', '', ...errors.map((error) => `- ${error}`), '');
  }

  return `${lines.join('\n')}\n`;
};
