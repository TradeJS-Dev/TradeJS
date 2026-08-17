import { resolveAiPocketSearchCommandOptions } from './commandOptions';
import {
  createAiPocketSearchDatasetProgressPresenter,
  createAiPocketSearchResearchProgressPresenter,
  presentAiPocketSearchResult,
  presentEmptyAiPocketSearchDataset,
  presentPendingAiPocketSearchReport,
  writeAiPocketSearchArtifacts,
  writePendingAiPocketSearchReport,
  type AiPocketSearchCommandResult,
} from './presenter';
import {
  evaluateAiPocketSearchDataset,
  prepareAiPocketSearchDataset,
} from './dataset';
import { runAiPocketSearchResearch } from './research';

export const runAiPocketSearchCommand = async ({
  flags,
}: {
  flags: Record<string, unknown>;
}) => {
  const options = resolveAiPocketSearchCommandOptions({
    flags,
    argv: process.argv,
  });
  const {
    skip,
    minQuality,
    untilTimestamp,
    periodLabel,
    recent,
    qualityThresholds,
    scope,
    direction,
    maxDepth,
    minProfitFactor,
    minWinRate,
    minTotalProfit,
    maxAtomicPredicates,
    maxCombinations,
    validationSplit,
    testSplit,
    maxBatch,
    maxSymbolCountShare,
    objective,
    allowRiskRegression,
    requireValidationEligibility,
    dedupeEquivalentSelections,
    top,
    includeSymbol,
    includeGateContext,
    featureProfile,
    featurePolicy,
    coverageMode,
    cadenceMode,
    jsonOutput,
    outputPath,
    reportDir,
    explicitReportFile,
  } = options;
  const generatedAt = Date.now();
  const preparedDataset = await prepareAiPocketSearchDataset(options);
  const { filePaths, totalRows, selectedRows, sinceTimestamp } =
    preparedDataset;

  if (!selectedRows) {
    presentEmptyAiPocketSearchDataset({ filePaths, recent, skip });
    process.exit(0);
  }

  let resolvedStrategyName = preparedDataset.resolvedStrategyName;
  const reportPath = await writePendingAiPocketSearchReport({
    explicitReportFile,
    reportDir,
    strategyName: resolvedStrategyName,
    filePaths,
    scope,
    generatedAt,
    selectedRows,
  });
  presentPendingAiPocketSearchReport(reportPath);

  const evaluatedDataset = await evaluateAiPocketSearchDataset({
    prepared: preparedDataset,
    options,
    onProgress: createAiPocketSearchDatasetProgressPresenter(selectedRows),
  });
  const { rows, scanned, dateSkipped, failed, errors, excludedFeaturePaths } =
    evaluatedDataset;
  resolvedStrategyName = evaluatedDataset.resolvedStrategyName;

  const research = runAiPocketSearchResearch({
    rows,
    options,
    onProgress: createAiPocketSearchResearchProgressPresenter(),
  });
  const {
    scopeRows,
    trainRows,
    validationRows,
    testRows,
    sealedTest,
    currentGateSummary,
    currentGateQualityThresholds,
    search,
    coverageSearches,
  } = research;

  const result: AiPocketSearchCommandResult = {
    generatedAt,
    run: {
      strategy: resolvedStrategyName,
      filePaths,
      sourceRows: totalRows,
      selectedRows,
      evaluatedRows: rows.length,
      scope,
      direction: direction || null,
      scopeRows: scopeRows.length,
      trainRows: trainRows.length,
      validationRows: validationRows.length,
      testRows: testRows.length,
      scanned,
      dateSkipped,
      failed,
      recent,
      skip,
      since: sinceTimestamp,
      until: untilTimestamp,
      period: periodLabel,
      minQuality,
      qualityThresholds,
      includeSymbol,
      includeGateContext,
      featureProfile,
      featurePolicy,
      coverageMode,
      cadenceMode,
      coverageSearches: coverageSearches.map(
        ({
          family,
          coverage,
          scopeRows,
          trainRows,
          validationRows,
          testRows,
        }) => ({
          family,
          coverage,
          scopeRows,
          trainRows,
          validationRows,
          testRows,
        }),
      ),
      featurePolicyAudit: Object.fromEntries(
        [...excludedFeaturePaths.entries()].map(([classification, paths]) => [
          classification,
          {
            paths: paths.size,
            samples: [...paths].sort().slice(0, 5),
          },
        ]),
      ),
      objective,
      validationSplit,
      testSplit,
      sealedTest,
      minValidationSupport: search.stats.cadence.minValidationSupport,
      reportPath,
      search: {
        maxDepth,
        minSupport: search.stats.cadence.minSupport,
        minProfitFactor,
        minWinRate,
        minTotalProfit,
        maxAtomicPredicates,
        maxCombinations,
        minEvents: search.stats.cadence.minEvents,
        minValidationEvents: search.stats.cadence.minValidationEvents,
        ...(maxBatch > 0 ? { maxBatch } : {}),
        maxEventCountShare: search.stats.cadence.maxEventCountShare,
        maxSymbolCountShare,
        allowRiskRegression,
        requireValidationEligibility,
        cadence: search.stats.cadence,
        validationSplit,
        testSplit,
        dedupeEquivalentSelections,
        top,
      },
    },
    currentGate: {
      summary: currentGateSummary,
      qualityThresholds: currentGateQualityThresholds,
    },
    pocketSearch: search,
    coverageSearches,
    errors,
  };

  await writeAiPocketSearchArtifacts({ result, outputPath });

  if (jsonOutput) {
    console.log(JSON.stringify(result));
    process.exit(failed === selectedRows ? 1 : 0);
  }

  presentAiPocketSearchResult({ result, outputPath });

  process.exit(failed === selectedRows ? 1 : 0);
};
