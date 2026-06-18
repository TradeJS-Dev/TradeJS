import args from 'args';
import chalk from 'chalk';
const ListIt = require('list-it');
import fs from 'fs/promises';
import path from 'path';
import ProgressBar from 'progress';
import {
  countAiDatasetRows,
  streamAiDatasetRows,
  toFileToken,
} from '@tradejs/infra/ai';
import {
  buildAiPayload,
  ensureAiStrategyPluginsLoaded,
  getDeterministicAiGateContext,
  runAiPromptLocal,
} from '@tradejs/node/ai';
import type { AiDatasetRow, Signal, SignalAnalysis } from '@tradejs/types';
import { extractSignalFromAiDatasetRow } from '../lib/aiTrainDataset';
import {
  summarizeAiTrainEvaluations,
  summarizeAiTrainEvaluationsByQualityThreshold,
} from '../lib/aiTrainMetrics';
import {
  parseQualityThresholds,
  parseTimestampFilter,
  parseTrailingPeriodMs,
  resolveAiTrainRecentLimit,
} from '../lib/aiTrainOptions';
import {
  collectAiPocketFeatures,
  searchAiPockets,
  type AiPocketResult,
  type AiPocketSearchRow,
  type AiPocketSummary,
} from '../lib/aiPocketSearch';

args.example(
  'yarn ai-pocket-search --strategy LiquidityZones -n 0 --maxDepth 2 --minSupport 25',
  'Search deterministic AI-gate pockets over the latest LiquidityZones AI export',
);

args.option(['o', 'outDir'], 'Dataset directory', 'data/ai/export');
args.option(['s', 'strategy'], 'Strategy name filter for merged file', '');
args.option(['f', 'file'], 'Explicit merged dataset file path', '');
args.option(
  ['n', 'recent'],
  'How many recent trades to evaluate from the end (0 = all)',
  50,
);
args.option(
  ['k', 'skip'],
  'How many recent trades to skip from the end before selecting replay rows',
  0,
);
args.option(
  ['M', 'minQuality'],
  'Minimum deterministic gate quality used for current qN+ baseline',
  4,
);
args.option(
  ['S', 'since'],
  'Only evaluate rows at or after this timestamp (ISO date or epoch ms)',
  '',
);
args.option(
  ['u', 'until'],
  'Only evaluate rows at or before this timestamp (ISO date or epoch ms)',
  '',
);
args.option(
  ['P', 'period'],
  'Evaluate a trailing selected-row period such as last365d, last90d, or last30d',
  '',
);
args.option(
  ['q', 'qualityThresholds'],
  'Comma-separated qN+ thresholds for current-gate baseline',
  '3,4,5',
);
args.option(
  ['g', 'scope'],
  'Search scope: all, approved, rejected, or candidates',
  'all',
);
args.option(['d', 'maxDepth'], 'Maximum predicate-combination depth', 2);
args.option(['m', 'minSupport'], 'Minimum rows required for a pocket', 20);
args.option(
  ['F', 'minProfitFactor'],
  'Minimum profit factor required for positive pockets',
  1.2,
);
args.option(
  ['W', 'minWinRate'],
  'Minimum win rate required for positive pockets',
  0,
);
args.option(
  ['R', 'minTotalProfit'],
  'Minimum total PnL required for positive pockets',
  0,
);
args.option(
  ['a', 'maxAtomicPredicates'],
  'Maximum strongest atomic predicates used for combinations',
  180,
);
args.option(
  ['C', 'maxCombinations'],
  'Maximum predicate combinations to evaluate',
  60000,
);
args.option(['t', 'top'], 'Top pockets to print in each section', 30);
args.option(['Y', 'includeSymbol'], 'Allow symbol as a pocket feature', false);
args.option(
  ['E', 'includeGateContext'],
  'Allow current deterministic gate output fields as pocket features',
  false,
);
args.option(['j', 'json'], 'Print structured JSON summary', false);
args.option(['O', 'output'], 'Write structured JSON summary to file', '');

const flags = args.parse(process.argv);

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

const normalizeInt = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
};

const normalizePositiveInt = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
};

const normalizeNonNegativeNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const normalizeQuality = (analysis: Partial<SignalAnalysis>) => {
  const quality = Number(analysis?.quality);
  return Number.isFinite(quality) ? Math.round(quality) : null;
};

const isAiApproval = (
  row: AiDatasetRow,
  analysis: Partial<SignalAnalysis>,
  minQuality: number,
) => {
  const quality = normalizeQuality(analysis);
  return (
    analysis.direction === row.direction &&
    quality != null &&
    quality >= minQuality
  );
};

const listMergedFiles = async (params: {
  outDir: string;
  strategyName?: string;
}) => {
  const { outDir, strategyName } = params;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(outDir);
  } catch {
    return [];
  }

  const prefix = strategyName
    ? `ai-dataset-${toFileToken(strategyName)}-merged-`
    : 'ai-dataset-';

  return entries
    .filter((name) => name.startsWith(prefix))
    .filter((name) => {
      if (!name.endsWith('.jsonl') || !name.includes('-merged-')) {
        return false;
      }
      return (
        /-merged-\d+\.jsonl$/.test(name) ||
        /-merged-\d+-part\d+\.jsonl$/.test(name)
      );
    })
    .sort()
    .map((name) => path.join(outDir, name));
};

const deriveStrategyNameFromFile = (filePath: string) => {
  const match = path
    .basename(filePath)
    .match(/^ai-dataset-(.+)-merged-\d+(?:-part\d+)?\.jsonl$/);
  return match?.[1] ? match[1] : 'unknown';
};

const getMergedGroupId = (filePath: string) => {
  const match = path
    .basename(filePath)
    .match(/^ai-dataset-(.+)-merged-(\d+)(?:-part(\d+))?\.jsonl$/);
  if (!match) {
    return null;
  }

  return {
    strategyToken: match[1],
    mergeId: match[2],
  };
};

const sortDatasetPartPaths = (filePaths: string[]) =>
  [...filePaths].sort((left, right) => {
    const leftMatch = path.basename(left).match(/-part(\d+)\.jsonl$/);
    const rightMatch = path.basename(right).match(/-part(\d+)\.jsonl$/);
    const leftPart = leftMatch ? Number(leftMatch[1]) : 0;
    const rightPart = rightMatch ? Number(rightMatch[1]) : 0;
    return leftPart - rightPart || left.localeCompare(right);
  });

const resolveMergedDatasetFiles = async ({
  outDir,
  strategyName,
  explicitFile,
}: {
  outDir: string;
  strategyName?: string;
  explicitFile?: string;
}) => {
  const mergedFiles = await listMergedFiles({
    outDir,
    strategyName,
  });
  if (!mergedFiles.length) {
    throw new Error(
      strategyName
        ? `No merged AI dataset found for strategy "${strategyName}" in ${outDir}. Run yarn ai-export first.`
        : `No merged AI dataset found in ${outDir}. Run yarn ai-export first.`,
    );
  }

  const resolvedExplicitFile = explicitFile ? path.resolve(explicitFile) : null;
  if (resolvedExplicitFile) {
    const groupId = getMergedGroupId(resolvedExplicitFile);
    if (!groupId) {
      return [resolvedExplicitFile];
    }

    const groupedFiles = sortDatasetPartPaths(
      mergedFiles.filter((candidate) => {
        const candidateGroup = getMergedGroupId(candidate);
        return (
          candidateGroup?.strategyToken === groupId.strategyToken &&
          candidateGroup?.mergeId === groupId.mergeId
        );
      }),
    );
    return groupedFiles.length ? groupedFiles : [resolvedExplicitFile];
  }

  const latestFile = mergedFiles[mergedFiles.length - 1];
  const latestGroupId = getMergedGroupId(latestFile);
  if (!latestGroupId) {
    return [latestFile];
  }

  return sortDatasetPartPaths(
    mergedFiles.filter((candidate) => {
      const candidateGroup = getMergedGroupId(candidate);
      return (
        candidateGroup?.strategyToken === latestGroupId.strategyToken &&
        candidateGroup?.mergeId === latestGroupId.mergeId
      );
    }),
  );
};

const getDatasetRowTimestamp = (row: AiDatasetRow) => {
  const timestamp = Number(row.timestamp);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const findMaxSelectedTimestamp = async ({
  filePaths,
  recent,
  skip,
}: {
  filePaths: string[];
  recent: number;
  skip: number;
}) => {
  let maxTimestamp: number | null = null;

  await streamAiDatasetRows({
    filePaths,
    limitFromEnd: recent,
    skipFromEnd: skip,
    onRow: async (row) => {
      const timestamp = getDatasetRowTimestamp(row);
      if (timestamp != null) {
        maxTimestamp =
          maxTimestamp == null ? timestamp : Math.max(maxTimestamp, timestamp);
      }
    },
  });

  return maxTimestamp;
};

const getDeterministicModelCandidate = (signal: Signal | null) => {
  if (!signal) {
    return false;
  }

  const payload = buildAiPayload(signal);
  const gateContext = getDeterministicAiGateContext(payload);
  const structuralHardBlockReasons = Array.isArray(
    gateContext?.structuralHardBlockReasons,
  )
    ? gateContext.structuralHardBlockReasons.filter(
        (reason): reason is string =>
          typeof reason === 'string' && reason.trim().length > 0,
      )
    : [];
  if (structuralHardBlockReasons.length) {
    return false;
  }

  if (typeof gateContext?.approvalAllowedNow === 'boolean') {
    return gateContext.approvalAllowedNow;
  }

  return true;
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
    return rows.filter((row) => row.modelCandidate);
  }
  return rows;
};

const printSection = (title: string, table: string) => {
  console.log(chalk.gray(`${title}:`));
  console.log(table);
  console.log('');
};

const buildSummaryRows = (summary: AiPocketSummary) => [
  ['rows', chalk.cyan(String(summary.support))],
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
    colorizeRatio(pocket.summary.winRate),
    colorizeNumber(pocket.summary.profitFactor),
    colorizeProfit(pocket.summary.totalProfit),
    colorizeProfit(-pocket.summary.maxDrawdown),
    colorizeNumber(pocket.summary.avgTradesPerDay),
    chalk.yellow(String(pocket.summary.losingMonths)),
    colorizeNumber(pocket.score),
    pocket.condition,
  ]);

const buildQualityRows = (
  qualityThresholds: ReturnType<
    typeof summarizeAiTrainEvaluationsByQualityThreshold
  >,
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

export const main = async () => {
  const outDir = String(flags.outDir || 'data/ai/export');
  const strategyName = String(flags.strategy || '').trim() || undefined;
  const explicitFile = String(flags.file || '').trim();
  const skip = normalizeInt(flags.skip, 0);
  const minQuality = normalizeInt(flags.minQuality, 4);
  const sinceInput = parseTimestampFilter(flags.since);
  const untilTimestamp = parseTimestampFilter(flags.until);
  const trailingPeriodMs = parseTrailingPeriodMs(flags.period);
  const periodLabel = String(flags.period || '').trim() || null;
  const hasDateFilter =
    trailingPeriodMs != null || sinceInput != null || untilTimestamp != null;
  const recent = resolveAiTrainRecentLimit({
    argv: process.argv,
    recentValue: flags.recent,
    hasDateFilter,
  });
  const qualityThresholds = parseQualityThresholds(flags.qualityThresholds);
  const scope = String(flags.scope || 'all')
    .trim()
    .toLowerCase();
  if (!['all', 'approved', 'rejected', 'candidates'].includes(scope)) {
    throw new Error(
      `Unsupported --scope "${scope}". Use all, approved, rejected, or candidates.`,
    );
  }
  const maxDepth = normalizePositiveInt(flags.maxDepth, 2);
  const minSupport = normalizePositiveInt(flags.minSupport, 20);
  const minProfitFactor = normalizeNonNegativeNumber(
    flags.minProfitFactor,
    1.2,
  );
  const minWinRate = normalizeNonNegativeNumber(flags.minWinRate, 0);
  const minTotalProfit = Number.isFinite(Number(flags.minTotalProfit))
    ? Number(flags.minTotalProfit)
    : 0;
  const maxAtomicPredicates = normalizePositiveInt(
    flags.maxAtomicPredicates,
    180,
  );
  const maxCombinations = normalizePositiveInt(flags.maxCombinations, 60_000);
  const top = normalizePositiveInt(flags.top, 30);
  const includeSymbol = Boolean(flags.includeSymbol);
  const includeGateContext = Boolean(flags.includeGateContext);
  const jsonOutput = Boolean(flags.json);
  const outputPath = String(flags.output || '').trim();

  await ensureAiStrategyPluginsLoaded();
  const filePaths = await resolveMergedDatasetFiles({
    outDir,
    strategyName,
    explicitFile,
  });
  const { totalRows, selectedRows } = await countAiDatasetRows({
    filePaths,
    limitFromEnd: recent,
    skipFromEnd: skip,
  });
  const maxSelectedTimestamp =
    trailingPeriodMs == null
      ? null
      : await findMaxSelectedTimestamp({ filePaths, recent, skip });
  const sinceTimestamp =
    trailingPeriodMs != null && maxSelectedTimestamp != null
      ? maxSelectedTimestamp - trailingPeriodMs
      : sinceInput;

  if (!selectedRows) {
    console.log(
      chalk.yellow(
        `No AI prompt rows selected in ${filePaths.join(', ')} (recent=${recent || 'all'}, skip=${skip})`,
      ),
    );
    process.exit(0);
  }

  let resolvedStrategyName = deriveStrategyNameFromFile(filePaths[0] || '');
  let scanned = 0;
  let dateSkipped = 0;
  let failed = 0;
  const errors: string[] = [];
  const rows: AiPocketSearchRow[] = [];
  const bar = jsonOutput
    ? null
    : new ProgressBar(':current/:total [:bar][:percent] :symbol :status', {
        total: selectedRows,
        width: 20,
      });

  await streamAiDatasetRows({
    filePaths,
    limitFromEnd: recent,
    skipFromEnd: skip,
    onRow: async (row) => {
      scanned += 1;
      if (
        resolvedStrategyName === 'unknown' &&
        typeof row.strategyName === 'string' &&
        row.strategyName.trim()
      ) {
        resolvedStrategyName = row.strategyName.trim();
      }

      const timestamp = getDatasetRowTimestamp(row);
      if (
        (sinceTimestamp != null &&
          (timestamp == null || timestamp < sinceTimestamp)) ||
        (untilTimestamp != null &&
          (timestamp == null || timestamp > untilTimestamp))
      ) {
        dateSkipped += 1;
        bar?.tick(1, {
          symbol: chalk.gray(row.symbol),
          status: chalk.gray('date-skip'),
        });
        return;
      }

      try {
        const signal = extractSignalFromAiDatasetRow(row);
        const payload = buildAiPayload(signal);
        const gateContext = getDeterministicAiGateContext(payload);
        const analysis = await runAiPromptLocal(signal, { payload });
        const quality = normalizeQuality(analysis);
        const modelDirection =
          typeof analysis.direction === 'string' && analysis.direction.trim()
            ? analysis.direction
            : null;
        const modelDirectionMatches = modelDirection === row.direction;
        const profit = Number(row.profit);
        rows.push({
          signalId: row.signalId,
          strategy: row.strategyName,
          symbol: row.symbol,
          direction: row.direction,
          timestamp,
          profit,
          profitableTrade: profit > 0,
          aiApproved: isAiApproval(row, analysis, minQuality),
          quality,
          modelDirectionMatches,
          modelCandidate: getDeterministicModelCandidate(signal),
          features: collectAiPocketFeatures({
            payload,
            gateContext,
            includeSymbol,
            includeGateContext,
          }),
        });
        bar?.tick(1, {
          symbol: chalk.gray(row.symbol),
          status: chalk.green('ok'),
        });
      } catch (error) {
        failed += 1;
        if (errors.length < 5) {
          errors.push(
            `[${row.symbol}/${row.signalId}] ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        bar?.tick(1, {
          symbol: chalk.gray(row.symbol),
          status: chalk.yellow('error'),
        });
      }
    },
  });

  const scopeRows = resolveScopeRows(rows, scope);
  const currentGateSummary = summarizeAiTrainEvaluations(rows);
  const currentGateQualityThresholds =
    summarizeAiTrainEvaluationsByQualityThreshold(rows, qualityThresholds);
  const search = searchAiPockets(scopeRows, {
    minSupport,
    minProfitFactor,
    minTotalProfit,
    minWinRate,
    maxDepth,
    maxAtomicPredicates,
    maxCombinations,
    top,
  });

  const result = {
    run: {
      strategy: resolvedStrategyName,
      filePaths,
      sourceRows: totalRows,
      selectedRows,
      evaluatedRows: rows.length,
      scope,
      scopeRows: scopeRows.length,
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
      search: {
        maxDepth,
        minSupport,
        minProfitFactor,
        minWinRate,
        minTotalProfit,
        maxAtomicPredicates,
        maxCombinations,
        top,
      },
    },
    currentGate: {
      summary: currentGateSummary,
      qualityThresholds: currentGateQualityThresholds,
    },
    pocketSearch: search,
    errors,
  };

  if (outputPath) {
    await fs.mkdir(path.dirname(path.resolve(outputPath)), {
      recursive: true,
    });
    await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  }

  if (jsonOutput) {
    console.log(JSON.stringify(result));
    process.exit(failed === selectedRows ? 1 : 0);
  }

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
        ['evaluated', chalk.blue(String(rows.length))],
        ['scope', chalk.yellow(scope)],
        ['scope_rows', chalk.blue(String(scopeRows.length))],
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
        ['min_support', chalk.magenta(String(minSupport))],
        ['max_atomic_predicates', chalk.magenta(String(maxAtomicPredicates))],
        ['max_combinations', chalk.magenta(String(maxCombinations))],
        [
          'include_symbol',
          includeSymbol ? chalk.yellow('on') : chalk.gray('off'),
        ],
        [
          'include_gate_context',
          includeGateContext ? chalk.yellow('on') : chalk.gray('off'),
        ],
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
    'SEARCH SCOPE BASELINE',
    createTable(
      [chalk.gray('METRIC'), chalk.gray('VALUE')],
      buildSummaryRows(search.baseline),
    ),
  );

  printSection(
    'SEARCH STATS',
    createTable(
      [chalk.gray('FIELD'), chalk.gray('VALUE')],
      [
        ['feature_keys', chalk.cyan(String(search.stats.featureKeys))],
        ['predicates', chalk.cyan(String(search.stats.predicates))],
        ['atomic_used', chalk.cyan(String(search.stats.atomicPredicatesUsed))],
        [
          'combinations_evaluated',
          chalk.cyan(String(search.stats.combinationsEvaluated)),
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
        chalk.gray('WR'),
        chalk.gray('PF'),
        chalk.gray('PNL'),
        chalk.gray('MAX_DD'),
        chalk.gray('TR/D'),
        chalk.gray('LOSS_M'),
        chalk.gray('SCORE'),
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
        chalk.gray('WR'),
        chalk.gray('PF'),
        chalk.gray('PNL'),
        chalk.gray('MAX_DD'),
        chalk.gray('TR/D'),
        chalk.gray('LOSS_M'),
        chalk.gray('SCORE'),
        chalk.gray('POCKET'),
      ],
      buildPocketRows(search.negativePockets),
    ),
  );

  if (errors.length) {
    console.log(chalk.yellow('Errors:'));
    errors.forEach((error) => console.log(chalk.yellow(`- ${error}`)));
  }

  process.exit(failed === selectedRows ? 1 : 0);
};
