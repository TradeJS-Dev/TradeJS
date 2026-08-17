import {
  summarizeAiTrainEvaluations,
  summarizeAiTrainEvaluationsByQualityThreshold,
} from '../aiTrainMetrics';
import {
  searchAiPockets,
  summarizeAiPocketFeatureCoverage,
  type AiPocketCoverageFamily,
  type AiPocketCoverageSearchResult,
  type AiPocketSearchProgress,
  type AiPocketSearchResult,
  type AiPocketSearchRow,
} from '../aiPocketSearch';
import {
  resolveAiPocketCadenceProfile,
  sealAiPocketTestPartition,
  splitAiPocketCoverageRowsByTimestamp,
  splitAiPocketResearchRowsByTimestamp,
} from '../aiPocketSearchCli';
import type { AiPocketSearchCommandOptions } from './commandOptions';

export type AiPocketSearchResearchProgress = {
  label: string;
  progress: AiPocketSearchProgress;
};

export type AiPocketSearchResearchResult = {
  scopeRows: AiPocketSearchRow[];
  trainRows: AiPocketSearchRow[];
  validationRows: AiPocketSearchRow[];
  testRows: AiPocketSearchRow[];
  sealedTest: {
    sealed: boolean;
    rows: number;
    events: number;
    startTimestamp: number | null;
    endTimestamp: number | null;
  };
  currentGateSummary: ReturnType<typeof summarizeAiTrainEvaluations>;
  currentGateQualityThresholds: ReturnType<
    typeof summarizeAiTrainEvaluationsByQualityThreshold
  >;
  search: AiPocketSearchResult;
  coverageSearches: AiPocketCoverageSearchResult[];
};

const resolveScopeRows = (
  rows: AiPocketSearchRow[],
  scope: string,
): AiPocketSearchRow[] => {
  if (scope === 'approved') {
    return rows.filter((row) => row.aiApproved);
  }
  if (scope === 'rejected') {
    return rows.filter((row) => !row.aiApproved);
  }
  if (scope === 'candidates') {
    return rows.filter((row) => row.modelCandidate && !row.aiApproved);
  }
  return rows;
};

export const runAiPocketSearchResearch = ({
  rows,
  options,
  onProgress,
}: {
  rows: AiPocketSearchRow[];
  options: AiPocketSearchCommandOptions;
  onProgress?: (event: AiPocketSearchResearchProgress) => void;
}): AiPocketSearchResearchResult => {
  const {
    direction,
    scope,
    qualityThresholds,
    validationSplit,
    testSplit,
    sealTest,
    cadenceMode,
    explicitMinSupport,
    explicitMinEvents,
    explicitMinValidationSupport,
    explicitMinValidationEvents,
    maxEventCountShare,
    explicitMaxEventCountShare,
    minProfitFactor,
    minTotalProfit,
    minWinRate,
    maxDepth,
    maxAtomicPredicates,
    maxCombinations,
    top,
    maxBatch,
    maxSymbolCountShare,
    objective,
    allowRiskRegression,
    requireValidationEligibility,
    dedupeEquivalentSelections,
    coverageMode,
  } = options;
  const directionRows = direction
    ? rows.filter((row) => row.direction === direction)
    : rows;
  const scopeRows = resolveScopeRows(directionRows, scope);
  const fullSplit = splitAiPocketResearchRowsByTimestamp(
    directionRows,
    validationSplit,
    testSplit,
  );
  const sealedFullSplit = sealAiPocketTestPartition(fullSplit, sealTest);
  const discoveryRows = sealedFullSplit.discoveryRows;
  const trainRows = resolveScopeRows(fullSplit.trainRows, scope);
  const validationRows = resolveScopeRows(fullSplit.validationRows, scope);
  const testRows = resolveScopeRows(sealedFullSplit.searchTestRows, scope);
  const baselineRows = fullSplit.trainRows.filter((row) => row.aiApproved);
  const validationBaselineRows = fullSplit.validationRows.filter(
    (row) => row.aiApproved,
  );
  const testBaselineRows = sealedFullSplit.searchTestRows.filter(
    (row) => row.aiApproved,
  );
  const currentGateSummary = summarizeAiTrainEvaluations(discoveryRows);
  const currentGateQualityThresholds =
    summarizeAiTrainEvaluationsByQualityThreshold(
      discoveryRows,
      qualityThresholds,
    );

  const runSearch = ({
    label,
    train,
    validation,
    test,
    trainBaseline,
    validationBaseline,
    testBaseline,
    requiredFeatureFamilies = [],
    excludedFeatureFamilies = [],
  }: {
    label: string;
    train: AiPocketSearchRow[];
    validation: AiPocketSearchRow[];
    test: AiPocketSearchRow[];
    trainBaseline: AiPocketSearchRow[];
    validationBaseline: AiPocketSearchRow[];
    testBaseline: AiPocketSearchRow[];
    requiredFeatureFamilies?: AiPocketCoverageFamily[];
    excludedFeatureFamilies?: AiPocketCoverageFamily[];
  }) => {
    const cadenceProfile = resolveAiPocketCadenceProfile({
      trainRows: train,
      validationRows: validation,
      testRows: test,
      mode: cadenceMode,
      validationSplit,
      ...(explicitMinSupport != null ? { minSupport: explicitMinSupport } : {}),
      ...(explicitMinEvents > 0 ? { minEvents: explicitMinEvents } : {}),
      ...(explicitMinValidationSupport > 0
        ? { minValidationSupport: explicitMinValidationSupport }
        : {}),
      ...(explicitMinValidationEvents > 0
        ? { minValidationEvents: explicitMinValidationEvents }
        : {}),
      maxEventCountShare,
      explicitMaxEventCountShare,
    });
    return searchAiPockets(train, {
      minSupport: cadenceProfile.minSupport,
      minProfitFactor,
      minTotalProfit,
      minWinRate,
      maxDepth,
      maxAtomicPredicates,
      maxCombinations,
      top,
      validationRows: validation,
      testRows: test,
      minValidationSupport: cadenceProfile.minValidationSupport,
      minEvents: cadenceProfile.minEvents,
      minValidationEvents: cadenceProfile.minValidationEvents,
      ...(maxBatch > 0 ? { maxBatch } : {}),
      maxEventCountShare: cadenceProfile.maxEventCountShare,
      maxSymbolCountShare,
      objective,
      baselineRows: trainBaseline,
      validationBaselineRows: validationBaseline,
      testBaselineRows: testBaseline,
      allowRiskRegression,
      requireValidationEligibility,
      dedupeEquivalentSelections,
      requiredFeatureFamilies,
      excludedFeatureFamilies,
      cadenceProfile,
      progressInterval: 250,
      onProgress: (progress) => onProgress?.({ label, progress }),
    });
  };

  const search = runSearch({
    label: 'full',
    train: trainRows,
    validation: validationRows,
    test: testRows,
    trainBaseline: baselineRows,
    validationBaseline: validationBaselineRows,
    testBaseline: testBaselineRows,
    ...(coverageMode === 'auto'
      ? {
          excludedFeatureFamilies: [
            'cmc',
            'coinalyze',
          ] satisfies AiPocketCoverageFamily[],
        }
      : {}),
  });

  const coverageSearches: AiPocketCoverageSearchResult[] = [];
  if (coverageMode === 'auto') {
    for (const family of ['cmc', 'coinalyze'] as const) {
      const cohortSplit = splitAiPocketCoverageRowsByTimestamp(
        directionRows,
        family,
        validationSplit,
        testSplit,
      );
      const sealedCohortSplit = sealAiPocketTestPartition(
        cohortSplit,
        sealTest,
      );
      const cohortTrainRows = resolveScopeRows(cohortSplit.trainRows, scope);
      const cohortValidationRows = resolveScopeRows(
        cohortSplit.validationRows,
        scope,
      );
      const cohortTestRows = resolveScopeRows(
        sealedCohortSplit.searchTestRows,
        scope,
      );
      const cohortSearch = runSearch({
        label: family,
        train: cohortTrainRows,
        validation: cohortValidationRows,
        test: cohortTestRows,
        trainBaseline: cohortSplit.trainRows.filter((row) => row.aiApproved),
        validationBaseline: cohortSplit.validationRows.filter(
          (row) => row.aiApproved,
        ),
        testBaseline: sealedCohortSplit.searchTestRows.filter(
          (row) => row.aiApproved,
        ),
        requiredFeatureFamilies: [family],
      });
      coverageSearches.push({
        family,
        coverage: summarizeAiPocketFeatureCoverage(
          sealedCohortSplit.discoveryRows,
          family,
        ),
        scopeRows: resolveScopeRows(
          sealedCohortSplit.discoveryRows.filter(
            (row) => row.featureCoverage?.[family] === true,
          ),
          scope,
        ).length,
        trainRows: cohortTrainRows.length,
        validationRows: cohortValidationRows.length,
        testRows: cohortTestRows.length,
        search: cohortSearch,
      });
    }
  }

  return {
    scopeRows,
    trainRows,
    validationRows,
    testRows,
    sealedTest: sealedFullSplit.evidence,
    currentGateSummary,
    currentGateQualityThresholds,
    search,
    coverageSearches,
  };
};
