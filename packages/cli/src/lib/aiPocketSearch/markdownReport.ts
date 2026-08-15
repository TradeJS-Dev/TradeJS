import type {
  AiPocketMarkdownReport,
  AiPocketResult,
  AiPocketSummary,
} from './contracts';

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
  ['events', summary.events],
  ['event_balanced_profit', formatMdNumber(summary.eventBalancedProfit)],
  ['trades_per_event', formatMdNumber(summary.tradesPerEvent)],
  ['p95_batch', summary.p95Batch],
  ['max_batch', summary.maxBatch],
  ['top_event_count_share', formatMdPercent(summary.topEventCountShare)],
  ['top_symbol_count_share', formatMdPercent(summary.topSymbolCountShare)],
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
    pocket.summary.events,
    pocket.summary.maxBatch,
    formatMdPercent(pocket.summary.supportRatio),
    formatMdPercent(pocket.summary.winRate),
    formatMdNumber(pocket.summary.profitFactor),
    formatMdNumber(pocket.summary.totalProfit),
    pocket.objectiveSummary
      ? formatMdNumber(pocket.objectiveSummary.totalProfit)
      : 'n/a',
    formatMdNumber(pocket.summary.maxDrawdown),
    pocket.validationSummary?.support ?? 'n/a',
    pocket.validationSummary?.events ?? 'n/a',
    pocket.validationSummary
      ? formatMdPercent(pocket.validationSummary.winRate)
      : 'n/a',
    pocket.validationSummary
      ? formatMdNumber(pocket.validationSummary.profitFactor)
      : 'n/a',
    pocket.validationSummary
      ? formatMdNumber(pocket.validationSummary.totalProfit)
      : 'n/a',
    pocket.testSummary?.support ?? 'n/a',
    pocket.testSummary?.events ?? 'n/a',
    pocket.testSummary
      ? formatMdNumber(pocket.testSummary.profitFactor)
      : 'n/a',
    pocket.testSummary ? formatMdNumber(pocket.testSummary.totalProfit) : 'n/a',
    pocket.testObjectiveSummary
      ? formatMdNumber(pocket.testObjectiveSummary.totalProfit)
      : 'n/a',
    formatMdNumber(pocket.summary.avgTradesPerDay),
    pocket.summary.losingMonths,
    formatMdNumber(pocket.score),
    pocket.readiness,
    pocket.readinessReasons.join('; ') || 'none',
    pocket.condition,
  ]);

export const buildAiPocketMarkdownReport = ({
  generatedAt,
  run,
  currentGate,
  pocketSearch,
  coverageSearches = [],
  errors,
}: AiPocketMarkdownReport) => {
  const generatedIso = new Date(generatedAt).toISOString();
  const featurePolicyAuditRows = Object.entries(
    run.featurePolicyAudit ?? {},
  ).map(([classification, audit]) => [
    classification,
    audit?.paths ?? 0,
    audit?.samples.join(', ') ?? '',
  ]);
  const pocketTableHeaders = [
    '#',
    'N',
    'Events',
    'Max batch',
    'Support',
    'WR',
    'PF',
    'PNL',
    'Objective PNL',
    'Max DD',
    'Val N',
    'Val Events',
    'Val WR',
    'Val PF',
    'Val PNL',
    'Test N',
    'Test Events',
    'Test PF',
    'Test PNL',
    'Test objective PNL',
    'Trades/Day',
    'Losing Months',
    'Score',
    'Readiness',
    'Readiness reasons',
    'Pocket',
  ];
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
        ['objective', run.objective ?? pocketSearch.objective],
        ['direction', run.direction ?? 'all'],
        ['scope_rows', run.scopeRows],
        ['train_rows', run.trainRows],
        ['validation_rows', run.validationRows],
        ['test_rows', run.testRows],
        ['validation_split', formatMdPercent(run.validationSplit)],
        ['test_split', formatMdPercent(run.testSplit)],
        ['test_sealed', run.sealedTest?.sealed ? 'yes' : 'no'],
        ['sealed_test_rows', run.sealedTest?.rows ?? run.testRows],
        ['sealed_test_events', run.sealedTest?.events ?? 'n/a'],
        [
          'sealed_test_start',
          run.sealedTest?.startTimestamp == null
            ? 'n/a'
            : new Date(run.sealedTest.startTimestamp).toISOString(),
        ],
        [
          'sealed_test_end',
          run.sealedTest?.endTimestamp == null
            ? 'n/a'
            : new Date(run.sealedTest.endTimestamp).toISOString(),
        ],
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
        ['min_events', run.search.minEvents ?? 1],
        ['min_validation_events', run.search.minValidationEvents ?? 0],
        ['max_batch', run.search.maxBatch ?? 'off'],
        [
          'max_event_count_share',
          run.search.maxEventCountShare == null
            ? 'off'
            : formatMdPercent(run.search.maxEventCountShare),
        ],
        [
          'max_symbol_count_share',
          run.search.maxSymbolCountShare == null
            ? 'off'
            : formatMdPercent(run.search.maxSymbolCountShare),
        ],
        [
          'allow_risk_regression',
          run.search.allowRiskRegression ? 'yes' : 'no',
        ],
        [
          'require_validation_eligibility',
          run.search.requireValidationEligibility ? 'yes' : 'no',
        ],
        ['max_atomic_predicates', run.search.maxAtomicPredicates],
        ['max_combinations', run.search.maxCombinations],
        ['include_symbol', run.includeSymbol ? 'on' : 'off'],
        ['include_gate_context', run.includeGateContext ? 'on' : 'off'],
        ['feature_profile', run.featureProfile ?? 'all'],
        ['feature_policy', run.featurePolicy ?? 'all'],
        ['coverage_mode', run.coverageMode ?? 'full'],
        ['cadence_mode', run.cadenceMode ?? 'fixed'],
        ['low_cadence', pocketSearch.stats.cadence.lowCadence ? 'yes' : 'no'],
        [
          'sparse_sample',
          pocketSearch.stats.cadence.sparseSample ? 'yes' : 'no',
        ],
        [
          'adaptive_thresholds',
          pocketSearch.stats.cadence.adaptiveThresholds ? 'on' : 'off',
        ],
        ['train_events', pocketSearch.stats.cadence.trainEvents],
        [
          'train_events_per_day',
          formatMdNumber(pocketSearch.stats.cadence.trainEventsPerDay, 4),
        ],
        ['report_path', run.reportPath],
      ],
    ),
    '',
    ...(featurePolicyAuditRows.length
      ? [
          '## Feature Policy Audit',
          '',
          markdownTable(
            ['Classification', 'Excluded paths', 'Samples'],
            featurePolicyAuditRows,
          ),
          '',
        ]
      : []),
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
    ...(pocketSearch.testBaseline
      ? [
          '## Untouched Test Baseline',
          '',
          markdownTable(
            ['Metric', 'Value'],
            summaryMetricRows(pocketSearch.testBaseline),
          ),
          '',
        ]
      : []),
    ...(pocketSearch.objectiveBaseline
      ? [
          '## Current Gate Train Baseline',
          '',
          markdownTable(
            ['Metric', 'Value'],
            summaryMetricRows(pocketSearch.objectiveBaseline),
          ),
          '',
        ]
      : []),
    ...(pocketSearch.testObjectiveBaseline
      ? [
          '## Current Gate Untouched Test Baseline',
          '',
          markdownTable(
            ['Metric', 'Value'],
            summaryMetricRows(pocketSearch.testObjectiveBaseline),
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
        ['feature_families', pocketSearch.stats.featureFamiliesUsed.join(', ')],
        [
          'required_feature_families',
          pocketSearch.stats.requiredFeatureFamilies.join(', ') || 'none',
        ],
        [
          'excluded_feature_families',
          pocketSearch.stats.excludedFeatureFamilies.join(', ') || 'none',
        ],
        ['estimated_combinations', pocketSearch.stats.estimatedCombinations],
        ['combinations_evaluated', pocketSearch.stats.combinationsEvaluated],
        ['validation_rows', pocketSearch.stats.validationRows],
        ['test_rows', pocketSearch.stats.testRows],
        ['effective_min_support', pocketSearch.stats.cadence.minSupport],
        ['effective_min_events', pocketSearch.stats.cadence.minEvents],
        [
          'effective_min_validation_support',
          pocketSearch.stats.cadence.minValidationSupport,
        ],
        [
          'effective_min_validation_events',
          pocketSearch.stats.cadence.minValidationEvents,
        ],
        [
          'effective_max_event_count_share',
          formatMdPercent(pocketSearch.stats.cadence.maxEventCountShare),
        ],
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
    markdownTable(pocketTableHeaders, pocketRows(pocketSearch.positivePockets)),
    '',
    '## Top Loss Pockets',
    '',
    markdownTable(pocketTableHeaders, pocketRows(pocketSearch.negativePockets)),
    '',
  ];

  for (const cohort of coverageSearches) {
    const title = cohort.family === 'cmc' ? 'CMC' : 'Coinalyze';
    lines.push(
      `## Coverage Cohort: ${title}`,
      '',
      markdownTable(
        ['Field', 'Value'],
        [
          ['coverage_rows', cohort.coverage.rows],
          ['coverage_row_ratio', formatMdPercent(cohort.coverage.rowRatio)],
          ['coverage_events', cohort.coverage.events],
          ['coverage_event_ratio', formatMdPercent(cohort.coverage.eventRatio)],
          [
            'coverage_from',
            cohort.coverage.minTimestamp == null
              ? 'n/a'
              : new Date(cohort.coverage.minTimestamp).toISOString(),
          ],
          [
            'coverage_to',
            cohort.coverage.maxTimestamp == null
              ? 'n/a'
              : new Date(cohort.coverage.maxTimestamp).toISOString(),
          ],
          ['scope_rows', cohort.scopeRows],
          ['train_rows', cohort.trainRows],
          ['validation_rows', cohort.validationRows],
          ['test_rows', cohort.testRows],
          [
            'low_cadence',
            cohort.search.stats.cadence.lowCadence ? 'yes' : 'no',
          ],
          [
            'sparse_sample',
            cohort.search.stats.cadence.sparseSample ? 'yes' : 'no',
          ],
          [
            'adaptive_thresholds',
            cohort.search.stats.cadence.adaptiveThresholds ? 'on' : 'off',
          ],
          ['train_events', cohort.search.stats.cadence.trainEvents],
          [
            'train_events_per_day',
            formatMdNumber(cohort.search.stats.cadence.trainEventsPerDay, 4),
          ],
          ['effective_min_support', cohort.search.stats.cadence.minSupport],
          ['effective_min_events', cohort.search.stats.cadence.minEvents],
          [
            'effective_min_validation_support',
            cohort.search.stats.cadence.minValidationSupport,
          ],
          [
            'effective_min_validation_events',
            cohort.search.stats.cadence.minValidationEvents,
          ],
          [
            'effective_max_event_count_share',
            formatMdPercent(cohort.search.stats.cadence.maxEventCountShare),
          ],
          [
            'required_feature_families',
            cohort.search.stats.requiredFeatureFamilies.join(', ') || 'none',
          ],
        ],
      ),
      '',
      `### ${title} Train Baseline`,
      '',
      markdownTable(
        ['Metric', 'Value'],
        summaryMetricRows(cohort.search.baseline),
      ),
      '',
      `### ${title} Top Positive Pockets`,
      '',
      markdownTable(
        pocketTableHeaders,
        pocketRows(cohort.search.positivePockets),
      ),
      '',
      `### ${title} Top Loss Pockets`,
      '',
      markdownTable(
        pocketTableHeaders,
        pocketRows(cohort.search.negativePockets),
      ),
      '',
    );
  }

  if (errors.length) {
    lines.push('## Errors', '', ...errors.map((error) => `- ${error}`), '');
  }

  return `${lines.join('\n')}\n`;
};
