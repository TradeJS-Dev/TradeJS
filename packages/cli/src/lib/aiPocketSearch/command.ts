import fs from 'node:fs/promises';
import { sha256File, writeJsonAtomic } from '../coreResearch/io';
import { runGateWalkForward, validateGateWalkForwardPlan } from './walkForward';
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
    testSince,
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
    excludeFeaturePattern,
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

  if (typeof flags.walkForwardPlan === 'string' && flags.walkForwardPlan) {
    if (
      !options.explicitFile ||
      filePaths.length !== 1 ||
      !options.outputPath ||
      !options.sealTest ||
      options.testSince == null ||
      options.scope !== 'all' ||
      options.recent ||
      options.skip
    ) {
      throw new Error(
        '--walkForwardPlan requires one --file, --output, --testSince, --sealTest, --scope all and the full export (-n 0)',
      );
    }
    const plan = validateGateWalkForwardPlan(
      JSON.parse(await fs.readFile(flags.walkForwardPlan, 'utf8')),
      options.testSince,
    );
    const sources = await Promise.all(
      filePaths.map(async (path) => ({ path, sha256: await sha256File(path) })),
    );
    const dataset = await evaluateAiPocketSearchDataset({
      prepared: preparedDataset,
      options,
    });
    if (dataset.failed)
      throw new Error(
        'Gate walk-forward requires a reconciled dataset without failed evaluations',
      );
    for (const source of sources) {
      if (source.sha256 !== (await sha256File(source.path)))
        throw new Error('Gate walk-forward source changed during evaluation');
    }
    if (new Set(dataset.rows.map((row) => row.strategy)).size > 1) {
      throw new Error('Gate walk-forward requires one strategy export');
    }
    const report = runGateWalkForward(dataset.rows, plan, options);
    await writeJsonAtomic(options.outputPath, {
      ...report,
      sources,
      searchOptions: {
        ...options,
        excludeFeaturePattern: options.excludeFeaturePattern?.source,
      },
    });
    console.log(`Gate walk-forward: ${report.status} (${options.outputPath})`);
    return;
  }

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
    datasetLabelHorizonPurge: evaluatedDataset.labelHorizonPurge,
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
      ...(excludeFeaturePattern
        ? { excludeFeaturePattern: excludeFeaturePattern.source }
        : {}),
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
      testSince,
      partitionMode: testSince == null ? 'timestamp-ratio' : 'calendar-cutoff',
      ...(research.labelHorizonPurge
        ? { labelHorizonPurge: research.labelHorizonPurge }
        : {}),
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
