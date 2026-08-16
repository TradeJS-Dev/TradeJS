import type {
  AiPocketCoverageFamily,
  AiPocketCadenceProfile,
  AiPocketSearchObjective,
  AiPocketSearchRow,
  AiPocketSearchOptions,
  AiPocketPredicate,
  AiPocketSummary,
  AiPocketResult,
  AiPocketSearchResult,
} from './contracts';
import {
  PRODUCTION_CANDIDATE_MIN_EVENTS,
  classifyAiPocketCoverageFeaturePath,
  type InternalPredicate,
  type ScoredPredicate,
} from './features';
import { getPeriodDays, summarizeMask, summarizeAiPocketRows } from './summary';
import {
  buildMask,
  intersectMasks,
  buildPredicateListMask,
  toPublicPredicate,
  buildAiPocketPredicateResult,
} from './predicates';

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
