import chalk from 'chalk';
const ListIt = require('list-it');
import fs from 'fs/promises';
import path from 'path';
import ProgressBar from 'progress';
import { toFileToken } from '@tradejs/infra/ai';
import type {
  AiTrainQualityThresholdSummary,
  AiTrainSummary,
} from '../aiTrainMetrics';
import {
  buildAiPocketMarkdownReport,
  type AiPocketMarkdownReport,
  type AiPocketResult,
  type AiPocketSummary,
} from '../aiPocketSearch';
import type { AiPocketSearchDatasetProgress } from './dataset';
import type { AiPocketSearchResearchProgress } from './research';

export type AiPocketSearchCommandResult = Omit<
  AiPocketMarkdownReport,
  'currentGate' | 'run'
> & {
  run: AiPocketMarkdownReport['run'] & {
    search: AiPocketMarkdownReport['run']['search'] & {
      validationSplit: number;
      testSplit: number;
      dedupeEquivalentSelections: boolean;
    };
  };
  currentGate: {
    summary: AiTrainSummary;
    qualityThresholds: AiTrainQualityThresholdSummary[];
  };
};

const tickProgressBarTo = (
  bar: ProgressBar,
  target: number,
  tokens: Record<string, string>,
) => {
  const current = Number((bar as unknown as { curr?: number }).curr ?? 0);
  const next = Math.max(current, Math.min(target, bar.total));
  const delta = next - current;
  if (delta > 0) {
    bar.tick(delta, tokens);
  }
};

const searchPhaseLabels = {
  features: 'features',
  predicates: 'preds',
  masks: 'masks',
  combinations: 'search',
} as const;

export const presentEmptyAiPocketSearchDataset = ({
  filePaths,
  recent,
  skip,
}: {
  filePaths: string[];
  recent: number;
  skip: number;
}) => {
  console.log(
    chalk.yellow(
      `No AI prompt rows selected in ${filePaths.join(', ')} (recent=${recent || 'all'}, skip=${skip})`,
    ),
  );
};

export const presentPendingAiPocketSearchReport = (reportPath: string) => {
  console.error(
    chalk.gray(`report: ${reportPath} (pending; final report after search)`),
  );
};

export const createAiPocketSearchDatasetProgressPresenter = (
  selectedRows: number,
) => {
  const bar = new ProgressBar(
    'eval   :current/:total [:bar] :percent :symbol :status',
    {
      total: selectedRows,
      width: 20,
      stream: process.stderr,
    },
  );

  return ({ symbol, status }: AiPocketSearchDatasetProgress) => {
    bar.tick(1, {
      symbol: chalk.gray(symbol),
      status:
        status === 'ok'
          ? chalk.green(status)
          : status === 'error'
            ? chalk.yellow(status)
            : chalk.gray(status),
    });
  };
};

export const createAiPocketSearchResearchProgressPresenter = () => {
  let searchBar: ProgressBar | null = null;
  let searchBarPhase: keyof typeof searchPhaseLabels | null = null;

  return ({ label, progress }: AiPocketSearchResearchProgress) => {
    if (searchBar && searchBarPhase !== progress.phase) {
      tickProgressBarTo(searchBar, searchBar.total, {
        status: chalk.gray('done'),
      });
      searchBar = null;
    }

    if (!searchBar) {
      searchBarPhase = progress.phase;
      const phaseLabel = searchPhaseLabels[progress.phase].padEnd(8, ' ');
      console.error(
        chalk.gray(
          `stage: ${label}/${searchPhaseLabels[progress.phase]} (${progress.total})`,
        ),
      );
      searchBar = new ProgressBar(
        `${phaseLabel} :current/:total [:bar] :percent :status`,
        {
          total: Math.max(progress.total, 1),
          width: 20,
          stream: process.stderr,
        },
      );
    }

    tickProgressBarTo(searchBar, progress.current, {
      status: progress.truncated ? chalk.yellow('truncated') : 'running',
    });
    if (progress.done) {
      tickProgressBarTo(searchBar, searchBar.total, {
        status: progress.truncated ? chalk.yellow('truncated') : 'done',
      });
      searchBar = null;
    }
  };
};

const createListIt = () =>
  new ListIt({
    autoAlign: true,
    headerUnderline: true,
  });

const createTable = (headers: string[], rows: string[][]) =>
  createListIt().setHeaderRow(headers).d(rows).toString();

const formatRatio = (value: number | null) =>
  value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;

const formatProfit = (value: number | null) =>
  value == null ? 'n/a' : value.toFixed(2);

const formatNumber = (value: number | null) =>
  value == null ? 'n/a' : value.toFixed(2);

const colorizeRatio = (value: number | null) => {
  const text = formatRatio(value);
  if (value == null) {
    return chalk.gray(text);
  }
  if (value >= 0.55) {
    return chalk.green(text);
  }
  if (value >= 0.45) {
    return chalk.yellow(text);
  }
  return chalk.red(text);
};

const colorizeProfit = (value: number | null) => {
  const text = formatProfit(value);
  if (value == null) {
    return chalk.gray(text);
  }
  if (value > 0) {
    return chalk.green(text);
  }
  if (value < 0) {
    return chalk.red(text);
  }
  return chalk.yellow(text);
};

const colorizeNumber = (value: number | null) =>
  value == null ? chalk.gray('n/a') : chalk.cyan(formatNumber(value));

const toReportTimestamp = (timestamp: number) =>
  new Date(timestamp)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[:]/g, '-');

const markdownPlainTable = (headers: string[], rows: string[][]) => {
  const escapeCell = (value: string) => value.replace(/\|/g, '\\|');
  return [
    `| ${headers.map(escapeCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`),
  ].join('\n');
};

const buildPendingMarkdownReport = ({
  generatedAt,
  strategy,
  filePaths,
  selectedRows,
  reportPath,
}: {
  generatedAt: number;
  strategy: string;
  filePaths: string[];
  selectedRows: number;
  reportPath: string;
}) =>
  [
    '# AI Pocket Search Report',
    '',
    'Status: running',
    '',
    `Generated at: ${new Date(generatedAt).toISOString()}`,
    '',
    markdownPlainTable(
      ['Field', 'Value'],
      [
        ['strategy', strategy],
        ['selected_rows', String(selectedRows)],
        ['report', reportPath],
      ],
    ),
    '',
    '## Source Files',
    '',
    ...filePaths.map((filePath) => `- \`${filePath}\``),
    '',
    'Final metrics and pockets will be written when the search finishes.',
    '',
  ].join('\n');

const getMergedGroupId = (filePath: string) => {
  const match = path
    .basename(filePath)
    .match(/^ai-dataset-(.+)-merged-(\d+)(?:-part(\d+))?\.jsonl$/);
  if (!match) {
    return null;
  }
  return { strategyToken: match[1], mergeId: match[2] };
};

const resolveMarkdownReportPath = ({
  explicitReportFile,
  reportDir,
  strategyName,
  filePath,
  scope,
  generatedAt,
}: {
  explicitReportFile: string;
  reportDir: string;
  strategyName: string;
  filePath: string;
  scope: string;
  generatedAt: number;
}) => {
  if (explicitReportFile) {
    return explicitReportFile;
  }

  const groupId = getMergedGroupId(filePath);
  const strategyToken = groupId?.strategyToken ?? toFileToken(strategyName);
  const mergeToken = groupId?.mergeId ? `merged-${groupId.mergeId}` : 'merged';
  return path.join(
    reportDir,
    `ai-pocket-search-${strategyToken}-${mergeToken}-${scope}-${toReportTimestamp(generatedAt)}.md`,
  );
};

export const writePendingAiPocketSearchReport = async ({
  explicitReportFile,
  reportDir,
  strategyName,
  filePaths,
  scope,
  generatedAt,
  selectedRows,
}: {
  explicitReportFile: string;
  reportDir: string;
  strategyName: string;
  filePaths: string[];
  scope: string;
  generatedAt: number;
  selectedRows: number;
}) => {
  const reportPath = resolveMarkdownReportPath({
    explicitReportFile,
    reportDir,
    strategyName,
    filePath: filePaths[0] || '',
    scope,
    generatedAt,
  });
  await fs.mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
  await fs.writeFile(
    reportPath,
    buildPendingMarkdownReport({
      generatedAt,
      strategy: strategyName,
      filePaths,
      selectedRows,
      reportPath,
    }),
    'utf8',
  );
  return reportPath;
};

const printSection = (title: string, table: string) => {
  console.log(chalk.gray(`${title}:`));
  console.log(table);
  console.log('');
};

const buildSummaryRows = (summary: AiPocketSummary) => [
  ['rows', chalk.cyan(String(summary.support))],
  ['events', chalk.cyan(String(summary.events))],
  ['event_balanced_profit', colorizeProfit(summary.eventBalancedProfit)],
  ['trades_per_event', colorizeNumber(summary.tradesPerEvent)],
  ['p95_batch', chalk.cyan(String(summary.p95Batch))],
  ['max_batch', chalk.cyan(String(summary.maxBatch))],
  ['top_event_count_share', colorizeRatio(summary.topEventCountShare)],
  ['top_symbol_count_share', colorizeRatio(summary.topSymbolCountShare)],
  ['win_rate', colorizeRatio(summary.winRate)],
  ['total_profit', colorizeProfit(summary.totalProfit)],
  ['gross_profit', colorizeProfit(summary.grossProfit)],
  ['gross_loss', colorizeProfit(-summary.grossLoss)],
  ['profit_factor', colorizeNumber(summary.profitFactor)],
  ['max_drawdown', colorizeProfit(-summary.maxDrawdown)],
  [
    'max_drawdown_pct_of_gross_profit',
    colorizeRatio(summary.maxDrawdownPctOfGrossProfit),
  ],
  [
    'max_drawdown_pct_of_total_profit',
    colorizeRatio(summary.maxDrawdownPctOfTotalProfit),
  ],
  ['max_consecutive_losses', chalk.red(String(summary.maxConsecutiveLosses))],
  ['avg_trades_per_day', colorizeNumber(summary.avgTradesPerDay)],
  ['avg_trades_per_week', colorizeNumber(summary.avgTradesPerWeek)],
  ['avg_profit_per_day', colorizeProfit(summary.avgProfitPerDay)],
  ['avg_profit_per_month', colorizeProfit(summary.avgProfitPerMonth)],
  ['losing_months', chalk.yellow(String(summary.losingMonths))],
  [
    'worst_month',
    summary.worstMonth
      ? `${summary.worstMonth.month} ${formatProfit(summary.worstMonth.totalProfit)}`
      : chalk.gray('n/a'),
  ],
];

const buildPocketRows = (pockets: AiPocketResult[]) =>
  pockets.map((pocket, index) => [
    chalk.gray(String(index + 1)),
    chalk.cyan(String(pocket.summary.support)),
    chalk.cyan(String(pocket.summary.events)),
    chalk.cyan(String(pocket.summary.maxBatch)),
    colorizeRatio(pocket.summary.supportRatio),
    colorizeRatio(pocket.summary.winRate),
    colorizeNumber(pocket.summary.profitFactor),
    colorizeProfit(pocket.summary.totalProfit),
    pocket.objectiveSummary
      ? colorizeProfit(pocket.objectiveSummary.totalProfit)
      : chalk.gray('n/a'),
    colorizeProfit(-pocket.summary.maxDrawdown),
    pocket.validationSummary
      ? chalk.cyan(String(pocket.validationSummary.support))
      : chalk.gray('n/a'),
    pocket.validationSummary
      ? chalk.cyan(String(pocket.validationSummary.events))
      : chalk.gray('n/a'),
    pocket.validationSummary
      ? colorizeRatio(pocket.validationSummary.winRate)
      : chalk.gray('n/a'),
    pocket.validationSummary
      ? colorizeNumber(pocket.validationSummary.profitFactor)
      : chalk.gray('n/a'),
    pocket.validationSummary
      ? colorizeProfit(pocket.validationSummary.totalProfit)
      : chalk.gray('n/a'),
    pocket.testSummary
      ? chalk.cyan(String(pocket.testSummary.support))
      : chalk.gray('n/a'),
    pocket.testSummary
      ? chalk.cyan(String(pocket.testSummary.events))
      : chalk.gray('n/a'),
    pocket.testSummary
      ? colorizeNumber(pocket.testSummary.profitFactor)
      : chalk.gray('n/a'),
    pocket.testSummary
      ? colorizeProfit(pocket.testSummary.totalProfit)
      : chalk.gray('n/a'),
    pocket.testObjectiveSummary
      ? colorizeProfit(pocket.testObjectiveSummary.totalProfit)
      : chalk.gray('n/a'),
    colorizeNumber(pocket.summary.avgTradesPerDay),
    chalk.yellow(String(pocket.summary.losingMonths)),
    colorizeNumber(pocket.score),
    pocket.readiness === 'production-candidate'
      ? chalk.green(pocket.readiness)
      : chalk.yellow(pocket.readiness),
    pocket.readinessReasons.length
      ? chalk.yellow(pocket.readinessReasons.join('; '))
      : chalk.gray('none'),
    pocket.condition,
  ]);

const buildQualityRows = (
  qualityThresholds: AiTrainQualityThresholdSummary[],
) =>
  qualityThresholds.map(({ label, summary }) => [
    chalk.magenta(label),
    chalk.cyan(String(summary.approved)),
    colorizeRatio(summary.approvedRisk.winRate),
    colorizeNumber(summary.approvedRisk.profitFactor),
    colorizeProfit(summary.approvedRisk.totalProfit),
    colorizeProfit(-summary.approvedRisk.maxDrawdown),
    colorizeNumber(summary.avgApprovedTradesPerDay),
    colorizeProfit(summary.avgProfitApprovedPerDay),
  ]);

export const writeAiPocketSearchArtifacts = async ({
  result,
  outputPath,
}: {
  result: AiPocketSearchCommandResult;
  outputPath: string;
}) => {
  const reportPath = result.run.reportPath;
  const markdownReport = buildAiPocketMarkdownReport(result);
  await fs.mkdir(path.dirname(path.resolve(reportPath)), {
    recursive: true,
  });
  await fs.writeFile(reportPath, markdownReport, 'utf8');

  if (outputPath) {
    await fs.mkdir(path.dirname(path.resolve(outputPath)), {
      recursive: true,
    });
    await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
};

export const presentAiPocketSearchResult = ({
  result,
  outputPath,
}: {
  result: AiPocketSearchCommandResult;
  outputPath: string;
}) => {
  const { run, pocketSearch: search } = result;
  const coverageSearches = result.coverageSearches ?? [];
  const currentGateQualityThresholds = result.currentGate.qualityThresholds;
  const errors = result.errors;
  const {
    strategy: resolvedStrategyName,
    filePaths,
    selectedRows,
    evaluatedRows,
    scope,
    direction,
    scopeRows: scopeRowCount,
    trainRows: trainRowCount,
    validationRows: validationRowCount,
    testRows: testRowCount,
    sourceRows: totalRows,
    dateSkipped,
    failed,
    recent,
    skip,
    since: sinceTimestamp,
    until: untilTimestamp,
    period: periodLabel,
    minQuality,
    includeSymbol,
    includeGateContext,
    validationSplit,
    testSplit,
    reportPath,
  } = run;
  const objective = run.objective ?? search.objective;
  const cadenceMode = run.cadenceMode ?? 'auto';
  const featureProfile = run.featureProfile ?? 'all';
  const featurePolicy = run.featurePolicy ?? 'causal-stationary';
  const coverageMode = run.coverageMode ?? 'auto';
  const sealedTest = run.sealedTest ?? {
    sealed: false,
    rows: 0,
    events: 0,
    startTimestamp: null,
    endTimestamp: null,
  };
  const {
    maxDepth,
    maxAtomicPredicates,
    maxCombinations,
    maxSymbolCountShare = 0.5,
    allowRiskRegression = false,
    requireValidationEligibility = true,
    validationSplit: _searchValidationSplit,
    testSplit: _searchTestSplit,
    dedupeEquivalentSelections,
  } = run.search;
  const maxBatch = run.search.maxBatch ?? 0;

  console.log('');
  console.log(chalk.green('AI pocket search finished'));
  filePaths.forEach((filePath) => console.log(chalk.gray(filePath)));
  console.log('');

  printSection(
    'RUN',
    createTable(
      [chalk.gray('FIELD'), chalk.gray('VALUE')],
      [
        ['strategy', chalk.yellow(resolvedStrategyName)],
        ['selected', chalk.blue(String(selectedRows))],
        ['evaluated', chalk.blue(String(evaluatedRows))],
        ['scope', chalk.yellow(scope)],
        ['objective', chalk.yellow(objective)],
        ['direction', direction ? chalk.yellow(direction) : chalk.gray('all')],
        ['scope_rows', chalk.blue(String(scopeRowCount))],
        ['train_rows', chalk.blue(String(trainRowCount))],
        ['validation_rows', chalk.blue(String(validationRowCount))],
        ['test_rows', chalk.blue(String(testRowCount))],
        ['source_rows', chalk.blue(String(totalRows))],
        ['date_skipped', chalk.blue(String(dateSkipped))],
        [
          'failed',
          failed > 0 ? chalk.yellow(String(failed)) : chalk.green('0'),
        ],
        ['recent', chalk.blue(recent === 0 ? 'all' : String(recent))],
        ['skip', chalk.blue(String(skip))],
        [
          'since',
          sinceTimestamp == null
            ? chalk.gray('n/a')
            : chalk.gray(new Date(sinceTimestamp).toISOString()),
        ],
        [
          'until',
          untilTimestamp == null
            ? chalk.gray('n/a')
            : chalk.gray(new Date(untilTimestamp).toISOString()),
        ],
        [
          'period',
          periodLabel == null ? chalk.gray('n/a') : chalk.gray(periodLabel),
        ],
        ['min_quality', chalk.magenta(String(minQuality))],
        ['max_depth', chalk.magenta(String(maxDepth))],
        ['cadence_mode', chalk.magenta(cadenceMode)],
        [
          'low_cadence',
          search.stats.cadence.lowCadence
            ? chalk.yellow('yes')
            : chalk.green('no'),
        ],
        [
          'sparse_sample',
          search.stats.cadence.sparseSample
            ? chalk.yellow('yes')
            : chalk.green('no'),
        ],
        [
          'adaptive_thresholds',
          search.stats.cadence.adaptiveThresholds
            ? chalk.yellow('on')
            : chalk.gray('off'),
        ],
        [
          'train_events',
          chalk.magenta(String(search.stats.cadence.trainEvents)),
        ],
        [
          'train_events_per_day',
          chalk.magenta(formatNumber(search.stats.cadence.trainEventsPerDay)),
        ],
        ['min_support', chalk.magenta(String(search.stats.cadence.minSupport))],
        ['min_events', chalk.magenta(String(search.stats.cadence.minEvents))],
        [
          'min_validation_events',
          chalk.magenta(String(search.stats.cadence.minValidationEvents)),
        ],
        ['max_batch', chalk.magenta(maxBatch > 0 ? String(maxBatch) : 'off')],
        [
          'max_event_share',
          chalk.magenta(formatRatio(search.stats.cadence.maxEventCountShare)),
        ],
        ['max_symbol_share', chalk.magenta(formatRatio(maxSymbolCountShare))],
        ['max_atomic_predicates', chalk.magenta(String(maxAtomicPredicates))],
        ['max_combinations', chalk.magenta(String(maxCombinations))],
        ['validation_split', chalk.magenta(formatRatio(validationSplit))],
        ['test_split', chalk.magenta(formatRatio(testSplit))],
        [
          'test_evidence',
          sealedTest.sealed
            ? chalk.green(
                `sealed (${sealedTest.rows} rows / ${sealedTest.events} events)`,
              )
            : chalk.yellow('open'),
        ],
        [
          'min_validation_support',
          chalk.magenta(String(search.stats.cadence.minValidationSupport)),
        ],
        [
          'dedupe_equivalent',
          dedupeEquivalentSelections ? chalk.green('on') : chalk.gray('off'),
        ],
        [
          'include_symbol',
          includeSymbol ? chalk.yellow('on') : chalk.gray('off'),
        ],
        [
          'include_gate_context',
          includeGateContext ? chalk.yellow('on') : chalk.gray('off'),
        ],
        ['feature_profile', chalk.magenta(featureProfile)],
        ['feature_policy', chalk.magenta(featurePolicy)],
        ['coverage_mode', chalk.magenta(coverageMode)],
        [
          'allow_risk_regression',
          allowRiskRegression ? chalk.yellow('on') : chalk.green('off'),
        ],
        [
          'validation_eligibility',
          requireValidationEligibility
            ? chalk.green('required')
            : chalk.yellow('off'),
        ],
        ['report', chalk.gray(reportPath)],
        ['output', outputPath ? chalk.gray(outputPath) : chalk.gray('off')],
      ],
    ),
  );

  printSection(
    'CURRENT GATE QN+ BASELINE',
    createTable(
      [
        chalk.gray('Q'),
        chalk.gray('APPROVED'),
        chalk.gray('WR'),
        chalk.gray('PF'),
        chalk.gray('PNL'),
        chalk.gray('MAX_DD'),
        chalk.gray('TRADES/D'),
        chalk.gray('PNL/D'),
      ],
      buildQualityRows(currentGateQualityThresholds),
    ),
  );

  printSection(
    'TRAIN BASELINE',
    createTable(
      [chalk.gray('METRIC'), chalk.gray('VALUE')],
      buildSummaryRows(search.baseline),
    ),
  );

  if (search.validationBaseline) {
    printSection(
      'VALIDATION BASELINE',
      createTable(
        [chalk.gray('METRIC'), chalk.gray('VALUE')],
        buildSummaryRows(search.validationBaseline),
      ),
    );
  }

  if (search.testBaseline) {
    printSection(
      'UNTOUCHED TEST BASELINE',
      createTable(
        [chalk.gray('METRIC'), chalk.gray('VALUE')],
        buildSummaryRows(search.testBaseline),
      ),
    );
  }

  if (search.objectiveBaseline) {
    printSection(
      'CURRENT GATE TRAIN BASELINE',
      createTable(
        [chalk.gray('METRIC'), chalk.gray('VALUE')],
        buildSummaryRows(search.objectiveBaseline),
      ),
    );
  }

  printSection(
    'SEARCH STATS',
    createTable(
      [chalk.gray('FIELD'), chalk.gray('VALUE')],
      [
        ['feature_keys', chalk.cyan(String(search.stats.featureKeys))],
        ['predicates', chalk.cyan(String(search.stats.predicates))],
        ['atomic_used', chalk.cyan(String(search.stats.atomicPredicatesUsed))],
        [
          'feature_families',
          chalk.cyan(search.stats.featureFamiliesUsed.join(', ')),
        ],
        [
          'required_feature_families',
          chalk.cyan(search.stats.requiredFeatureFamilies.join(', ') || 'none'),
        ],
        [
          'excluded_feature_families',
          chalk.cyan(search.stats.excludedFeatureFamilies.join(', ') || 'none'),
        ],
        [
          'estimated_combinations',
          chalk.cyan(String(search.stats.estimatedCombinations)),
        ],
        [
          'combinations_evaluated',
          chalk.cyan(String(search.stats.combinationsEvaluated)),
        ],
        ['validation_rows', chalk.cyan(String(search.stats.validationRows))],
        ['test_rows', chalk.cyan(String(search.stats.testRows))],
        ['train_events', chalk.cyan(String(search.stats.cadence.trainEvents))],
        [
          'train_events_per_day',
          chalk.cyan(formatNumber(search.stats.cadence.trainEventsPerDay)),
        ],
        [
          'effective_min_support',
          chalk.cyan(String(search.stats.cadence.minSupport)),
        ],
        [
          'effective_min_events',
          chalk.cyan(String(search.stats.cadence.minEvents)),
        ],
        [
          'effective_min_validation_support',
          chalk.cyan(String(search.stats.cadence.minValidationSupport)),
        ],
        [
          'effective_min_validation_events',
          chalk.cyan(String(search.stats.cadence.minValidationEvents)),
        ],
        [
          'duplicate_pockets_skipped',
          chalk.cyan(String(search.stats.duplicatePocketsSkipped)),
        ],
        [
          'truncated',
          search.stats.truncated ? chalk.yellow('yes') : chalk.green('no'),
        ],
      ],
    ),
  );

  printSection(
    'TOP POSITIVE POCKETS',
    createTable(
      [
        chalk.gray('#'),
        chalk.gray('N'),
        chalk.gray('EVENTS'),
        chalk.gray('MAX_B'),
        chalk.gray('SUP'),
        chalk.gray('WR'),
        chalk.gray('PF'),
        chalk.gray('PNL'),
        chalk.gray('OBJ_PNL'),
        chalk.gray('MAX_DD'),
        chalk.gray('VAL_N'),
        chalk.gray('VAL_EVENTS'),
        chalk.gray('VAL_WR'),
        chalk.gray('VAL_PF'),
        chalk.gray('VAL_PNL'),
        chalk.gray('TEST_N'),
        chalk.gray('TEST_EVENTS'),
        chalk.gray('TEST_PF'),
        chalk.gray('TEST_PNL'),
        chalk.gray('TEST_OBJ'),
        chalk.gray('TR/D'),
        chalk.gray('LOSS_M'),
        chalk.gray('SCORE'),
        chalk.gray('READINESS'),
        chalk.gray('REASONS'),
        chalk.gray('POCKET'),
      ],
      buildPocketRows(search.positivePockets),
    ),
  );

  printSection(
    'TOP LOSS POCKETS',
    createTable(
      [
        chalk.gray('#'),
        chalk.gray('N'),
        chalk.gray('EVENTS'),
        chalk.gray('MAX_B'),
        chalk.gray('SUP'),
        chalk.gray('WR'),
        chalk.gray('PF'),
        chalk.gray('PNL'),
        chalk.gray('OBJ_PNL'),
        chalk.gray('MAX_DD'),
        chalk.gray('VAL_N'),
        chalk.gray('VAL_EVENTS'),
        chalk.gray('VAL_WR'),
        chalk.gray('VAL_PF'),
        chalk.gray('VAL_PNL'),
        chalk.gray('TEST_N'),
        chalk.gray('TEST_EVENTS'),
        chalk.gray('TEST_PF'),
        chalk.gray('TEST_PNL'),
        chalk.gray('TEST_OBJ'),
        chalk.gray('TR/D'),
        chalk.gray('LOSS_M'),
        chalk.gray('SCORE'),
        chalk.gray('READINESS'),
        chalk.gray('REASONS'),
        chalk.gray('POCKET'),
      ],
      buildPocketRows(search.negativePockets),
    ),
  );

  for (const cohort of coverageSearches) {
    const title = cohort.family === 'cmc' ? 'CMC' : 'COINALYZE';
    printSection(
      `${title} COVERAGE COHORT`,
      createTable(
        [chalk.gray('FIELD'), chalk.gray('VALUE')],
        [
          ['coverage_rows', chalk.cyan(String(cohort.coverage.rows))],
          ['coverage_ratio', chalk.cyan(formatRatio(cohort.coverage.rowRatio))],
          ['coverage_events', chalk.cyan(String(cohort.coverage.events))],
          ['event_ratio', chalk.cyan(formatRatio(cohort.coverage.eventRatio))],
          [
            'coverage_from',
            cohort.coverage.minTimestamp == null
              ? chalk.gray('n/a')
              : chalk.gray(
                  new Date(cohort.coverage.minTimestamp).toISOString(),
                ),
          ],
          [
            'coverage_to',
            cohort.coverage.maxTimestamp == null
              ? chalk.gray('n/a')
              : chalk.gray(
                  new Date(cohort.coverage.maxTimestamp).toISOString(),
                ),
          ],
          ['scope_rows', chalk.cyan(String(cohort.scopeRows))],
          ['train_rows', chalk.cyan(String(cohort.trainRows))],
          ['validation_rows', chalk.cyan(String(cohort.validationRows))],
          ['test_rows', chalk.cyan(String(cohort.testRows))],
          [
            'low_cadence',
            cohort.search.stats.cadence.lowCadence
              ? chalk.yellow('yes')
              : chalk.green('no'),
          ],
          [
            'sparse_sample',
            cohort.search.stats.cadence.sparseSample
              ? chalk.yellow('yes')
              : chalk.green('no'),
          ],
          [
            'adaptive_thresholds',
            cohort.search.stats.cadence.adaptiveThresholds
              ? chalk.yellow('on')
              : chalk.gray('off'),
          ],
          [
            'train_events',
            chalk.cyan(String(cohort.search.stats.cadence.trainEvents)),
          ],
          [
            'effective_min_support',
            chalk.cyan(String(cohort.search.stats.cadence.minSupport)),
          ],
          [
            'effective_min_events',
            chalk.cyan(String(cohort.search.stats.cadence.minEvents)),
          ],
        ],
      ),
    );
    printSection(
      `${title} TRAIN BASELINE`,
      createTable(
        [chalk.gray('METRIC'), chalk.gray('VALUE')],
        buildSummaryRows(cohort.search.baseline),
      ),
    );
    printSection(
      `${title} TOP POSITIVE POCKETS`,
      createTable(
        [
          chalk.gray('#'),
          chalk.gray('N'),
          chalk.gray('EVENTS'),
          chalk.gray('MAX_B'),
          chalk.gray('SUP'),
          chalk.gray('WR'),
          chalk.gray('PF'),
          chalk.gray('PNL'),
          chalk.gray('OBJ_PNL'),
          chalk.gray('MAX_DD'),
          chalk.gray('VAL_N'),
          chalk.gray('VAL_EVENTS'),
          chalk.gray('VAL_WR'),
          chalk.gray('VAL_PF'),
          chalk.gray('VAL_PNL'),
          chalk.gray('TEST_N'),
          chalk.gray('TEST_EVENTS'),
          chalk.gray('TEST_PF'),
          chalk.gray('TEST_PNL'),
          chalk.gray('TEST_OBJ'),
          chalk.gray('TR/D'),
          chalk.gray('LOSS_M'),
          chalk.gray('SCORE'),
          chalk.gray('READINESS'),
          chalk.gray('REASONS'),
          chalk.gray('POCKET'),
        ],
        buildPocketRows(cohort.search.positivePockets),
      ),
    );
    printSection(
      `${title} TOP LOSS POCKETS`,
      createTable(
        [
          chalk.gray('#'),
          chalk.gray('N'),
          chalk.gray('EVENTS'),
          chalk.gray('MAX_B'),
          chalk.gray('SUP'),
          chalk.gray('WR'),
          chalk.gray('PF'),
          chalk.gray('PNL'),
          chalk.gray('OBJ_PNL'),
          chalk.gray('MAX_DD'),
          chalk.gray('VAL_N'),
          chalk.gray('VAL_EVENTS'),
          chalk.gray('VAL_WR'),
          chalk.gray('VAL_PF'),
          chalk.gray('VAL_PNL'),
          chalk.gray('TEST_N'),
          chalk.gray('TEST_EVENTS'),
          chalk.gray('TEST_PF'),
          chalk.gray('TEST_PNL'),
          chalk.gray('TEST_OBJ'),
          chalk.gray('TR/D'),
          chalk.gray('LOSS_M'),
          chalk.gray('SCORE'),
          chalk.gray('READINESS'),
          chalk.gray('REASONS'),
          chalk.gray('POCKET'),
        ],
        buildPocketRows(cohort.search.negativePockets),
      ),
    );
  }

  if (errors.length) {
    console.log(chalk.yellow('Errors:'));
    errors.forEach((error) => console.log(chalk.yellow(`- ${error}`)));
  }
};
