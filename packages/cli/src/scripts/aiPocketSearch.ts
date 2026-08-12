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
  buildAiPocketMarkdownReport,
  collectAiPocketFeatureSnapshot,
  searchAiPockets,
  summarizeAiPocketFeatureCoverage,
  type AiPocketCadenceMode,
  type AiPocketCoverageFamily,
  type AiPocketCoverageSearchResult,
  type AiPocketResult,
  type AiPocketFeaturePolicy,
  type AiPocketExcludedFeatureClassification,
  type AiPocketSearchProgressPhase,
  type AiPocketSearchObjective,
  type AiPocketSearchRow,
  type AiPocketSummary,
} from '../lib/aiPocketSearch';
import {
  AI_POCKET_SEARCH_CLI_DECIMAL_DEFAULTS,
  readAiPocketSearchCliOption,
  resolveAiPocketCadenceProfile,
  sealAiPocketTestPartition,
  splitAiPocketCoverageRowsByTimestamp,
  splitAiPocketResearchRowsByTimestamp,
} from '../lib/aiPocketSearchCli';

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
args.option(
  ['I', 'direction'],
  'Only search rows with this signal direction: LONG or SHORT',
  '',
);
args.option(['d', 'maxDepth'], 'Maximum predicate-combination depth', 2);
args.option(
  ['m', 'minSupport'],
  'Minimum rows override; cadence auto derives it when omitted',
  20,
);
args.option(
  ['F', 'minProfitFactor'],
  'Minimum profit factor required for positive pockets',
  AI_POCKET_SEARCH_CLI_DECIMAL_DEFAULTS.minProfitFactor,
);
args.option(
  ['W', 'minWinRate'],
  'Minimum win rate required for positive pockets',
  AI_POCKET_SEARCH_CLI_DECIMAL_DEFAULTS.minWinRate,
);
args.option(
  ['R', 'minTotalProfit'],
  'Minimum total PnL required for positive pockets',
  AI_POCKET_SEARCH_CLI_DECIMAL_DEFAULTS.minTotalProfit,
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
args.option(
  ['V', 'validationSplit'],
  'Trailing time-ordered scope share reserved for validation (0 disables)',
  AI_POCKET_SEARCH_CLI_DECIMAL_DEFAULTS.validationSplit,
);
args.option(
  ['T', 'testSplit'],
  'Trailing timestamp-grouped scope share withheld as untouched test',
  AI_POCKET_SEARCH_CLI_DECIMAL_DEFAULTS.testSplit,
);
args.option(
  ['w', 'sealTest'],
  'Reserve test bounds without exposing its rows or economics to discovery',
  false,
);
args.option(
  ['N', 'minValidationSupport'],
  'Minimum validation rows required for positive pockets (0 = auto)',
  0,
);
args.option(
  ['H', 'minEvents'],
  'Minimum independent timestamp events required (0 = auto)',
  0,
);
args.option(
  ['J', 'minValidationEvents'],
  'Minimum validation timestamp events required (0 = auto)',
  0,
);
args.option(
  ['X', 'maxBatch'],
  'Maximum selected rows at one timestamp (0 disables)',
  5,
);
args.option(
  ['U', 'maxEventCountShare'],
  'Maximum row share contributed by one timestamp event',
  '0.25',
);
args.option(
  ['Z', 'maxSymbolCountShare'],
  'Maximum row share contributed by one symbol',
  '0.5',
);
args.option(
  ['A', 'objective'],
  'Search objective: auto, standalone, add-to-gate, or filter-gate',
  'auto',
);
args.option(
  ['G', 'allowRiskRegression'],
  'Allow incremental pockets to worsen q4+ PF, PnL, drawdown, or loss streak',
  false,
);
args.option(
  ['L', 'allowValidationRegression'],
  'Keep train-positive pockets that fail validation PnL/PF thresholds',
  false,
);
args.option(
  ['D', 'dedupeEquivalentSelections'],
  'Collapse pockets that select the same train rows',
  true,
);
args.option(['t', 'top'], 'Top pockets to print in each section', 30);
args.option(['Y', 'includeSymbol'], 'Allow symbol as a pocket feature', false);
args.option(
  ['E', 'includeGateContext'],
  'Allow current deterministic gate output fields as pocket features',
  false,
);
args.option(
  ['p', 'featureProfile'],
  'Feature extraction profile: compact or all',
  'all',
);
args.option(
  ['K', 'featurePolicy'],
  'Feature policy: causal-stationary or all',
  'causal-stationary',
);
args.option(
  ['Q', 'coverageMode'],
  'Coverage-aware search mode: auto or full',
  'auto',
);
args.option(
  ['c', 'cadenceMode'],
  'Cadence thresholds: auto adapts discovery support, fixed keeps legacy defaults',
  'auto',
);
args.option(
  ['r', 'reportDir'],
  'Directory for generated Markdown reports',
  'data/ai/output',
);
args.option(['B', 'reportFile'], 'Explicit Markdown report file path', '');
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

const normalizeRatio = (value: unknown, fallback: number) => {
  if (typeof value === 'boolean') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(0.9, parsed));
};

const normalizeUnitRatio = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
};

const normalizeFeatureProfile = (value: unknown): 'compact' | 'all' => {
  const normalized = String(value || 'all')
    .trim()
    .toLowerCase();
  return normalized === 'compact' ? 'compact' : 'all';
};

const normalizeFeaturePolicy = (value: unknown): AiPocketFeaturePolicy => {
  const normalized = String(value || 'causal-stationary')
    .trim()
    .toLowerCase();
  if (!['causal-stationary', 'all'].includes(normalized)) {
    throw new Error(
      `Unsupported --featurePolicy "${normalized}". Use causal-stationary or all.`,
    );
  }
  return normalized as AiPocketFeaturePolicy;
};

const normalizeCoverageMode = (value: unknown): 'auto' | 'full' => {
  const normalized = String(value || 'auto')
    .trim()
    .toLowerCase();
  if (!['auto', 'full'].includes(normalized)) {
    throw new Error(
      `Unsupported --coverageMode "${normalized}". Use auto or full.`,
    );
  }
  return normalized as 'auto' | 'full';
};

const normalizeCadenceMode = (value: unknown): AiPocketCadenceMode => {
  const normalized = String(value || 'auto')
    .trim()
    .toLowerCase();
  if (!['auto', 'fixed'].includes(normalized)) {
    throw new Error(
      `Unsupported --cadenceMode "${normalized}". Use auto or fixed.`,
    );
  }
  return normalized as AiPocketCadenceMode;
};

const normalizeObjective = (
  value: unknown,
  scope: string,
): AiPocketSearchObjective => {
  const normalized = String(value || 'auto')
    .trim()
    .toLowerCase();
  if (normalized === 'auto') {
    if (scope === 'approved') {
      return 'filter-gate';
    }
    if (scope === 'rejected' || scope === 'candidates') {
      return 'add-to-gate';
    }
    return 'standalone';
  }
  if (!['standalone', 'add-to-gate', 'filter-gate'].includes(normalized)) {
    throw new Error(
      `Unsupported --objective "${normalized}". Use auto, standalone, add-to-gate, or filter-gate.`,
    );
  }
  return normalized as AiPocketSearchObjective;
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
    return rows.filter((row) => row.modelCandidate && !row.aiApproved);
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

const searchPhaseLabels: Record<AiPocketSearchProgressPhase, string> = {
  features: 'features',
  predicates: 'preds',
  masks: 'masks',
  combinations: 'search',
};

const hasCliOption = (longName: string, shortName?: string) =>
  process.argv.some(
    (arg) =>
      arg === `--${longName}` ||
      arg.startsWith(`--${longName}=`) ||
      (shortName ? arg === `-${shortName}` : false),
  );

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
  const direction = String(flags.direction || '')
    .trim()
    .toUpperCase();
  if (direction && !['LONG', 'SHORT'].includes(direction)) {
    throw new Error(
      `Unsupported --direction "${direction}". Use LONG or SHORT.`,
    );
  }
  const maxDepth = normalizePositiveInt(flags.maxDepth, 2);
  const explicitMinSupport = hasCliOption('minSupport', 'm')
    ? normalizePositiveInt(flags.minSupport, 20)
    : undefined;
  const minProfitFactor = normalizeNonNegativeNumber(
    readAiPocketSearchCliOption({
      argv: process.argv,
      longName: 'minProfitFactor',
      shortName: 'F',
    }) ?? flags.minProfitFactor,
    1.2,
  );
  const minWinRate = normalizeNonNegativeNumber(
    readAiPocketSearchCliOption({
      argv: process.argv,
      longName: 'minWinRate',
      shortName: 'W',
    }) ?? flags.minWinRate,
    0,
  );
  const minTotalProfitValue =
    readAiPocketSearchCliOption({
      argv: process.argv,
      longName: 'minTotalProfit',
      shortName: 'R',
    }) ?? flags.minTotalProfit;
  const minTotalProfit = Number.isFinite(Number(minTotalProfitValue))
    ? Number(minTotalProfitValue)
    : 0;
  const maxAtomicPredicates = normalizePositiveInt(
    flags.maxAtomicPredicates,
    180,
  );
  const maxCombinations = normalizePositiveInt(flags.maxCombinations, 60_000);
  const validationSplit = hasCliOption('validationSplit', 'V')
    ? normalizeRatio(
        readAiPocketSearchCliOption({
          argv: process.argv,
          longName: 'validationSplit',
          shortName: 'V',
        }) ?? flags.validationSplit,
        0.25,
      )
    : 0.25;
  const testSplit = hasCliOption('testSplit', 'T')
    ? normalizeRatio(
        readAiPocketSearchCliOption({
          argv: process.argv,
          longName: 'testSplit',
          shortName: 'T',
        }) ?? flags.testSplit,
        0,
      )
    : 0;
  const sealTest = Boolean(flags.sealTest);
  if (sealTest && testSplit <= 0) {
    throw new Error('--sealTest requires a positive --testSplit');
  }
  const explicitMinValidationSupport = normalizeInt(
    flags.minValidationSupport,
    0,
  );
  const explicitMinEvents = normalizeInt(flags.minEvents, 0);
  const explicitMinValidationEvents = normalizeInt(
    flags.minValidationEvents,
    0,
  );
  const maxBatch = normalizeInt(flags.maxBatch, 5);
  const maxEventCountShare = normalizeUnitRatio(
    readAiPocketSearchCliOption({
      argv: process.argv,
      longName: 'maxEventCountShare',
      shortName: 'U',
    }) ?? flags.maxEventCountShare,
    0.25,
  );
  const maxSymbolCountShare = normalizeUnitRatio(
    readAiPocketSearchCliOption({
      argv: process.argv,
      longName: 'maxSymbolCountShare',
      shortName: 'Z',
    }) ?? flags.maxSymbolCountShare,
    0.5,
  );
  const objective = normalizeObjective(flags.objective, scope);
  const allowRiskRegression = Boolean(flags.allowRiskRegression);
  const requireValidationEligibility = !Boolean(
    flags.allowValidationRegression,
  );
  const dedupeEquivalentSelections = Boolean(flags.dedupeEquivalentSelections);
  const top = normalizePositiveInt(flags.top, 30);
  const includeSymbol = Boolean(flags.includeSymbol);
  const includeGateContext = Boolean(flags.includeGateContext);
  const featureProfile = normalizeFeatureProfile(flags.featureProfile);
  const featurePolicy = normalizeFeaturePolicy(flags.featurePolicy);
  const coverageMode = normalizeCoverageMode(flags.coverageMode);
  const cadenceMode = normalizeCadenceMode(flags.cadenceMode);
  const jsonOutput = Boolean(flags.json);
  const outputPath = String(flags.output || '').trim();
  const reportDir = String(flags.reportDir || 'data/ai/output').trim();
  const explicitReportFile = String(flags.reportFile || '').trim();
  const generatedAt = Date.now();
  const excludedFeaturePaths = new Map<
    AiPocketExcludedFeatureClassification,
    Set<string>
  >();

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
  const reportPath = resolveMarkdownReportPath({
    explicitReportFile,
    reportDir,
    strategyName: resolvedStrategyName,
    filePath: filePaths[0] || '',
    scope,
    generatedAt,
  });
  await fs.mkdir(path.dirname(path.resolve(reportPath)), {
    recursive: true,
  });
  await fs.writeFile(
    reportPath,
    buildPendingMarkdownReport({
      generatedAt,
      strategy: resolvedStrategyName,
      filePaths,
      selectedRows,
      reportPath,
    }),
    'utf8',
  );
  console.error(
    chalk.gray(`report: ${reportPath} (pending; final report after search)`),
  );
  let scanned = 0;
  let dateSkipped = 0;
  let failed = 0;
  const errors: string[] = [];
  const rows: AiPocketSearchRow[] = [];
  const bar = new ProgressBar(
    'eval   :current/:total [:bar] :percent :symbol :status',
    {
      total: selectedRows,
      width: 20,
      stream: process.stderr,
    },
  );

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
        const featureSnapshot = collectAiPocketFeatureSnapshot({
          payload,
          gateContext,
          includeSymbol,
          includeGateContext,
          featureProfile,
          featurePolicy,
          onFeatureExcluded: ({ path: featurePath, classification }) => {
            const paths = excludedFeaturePaths.get(classification) ?? new Set();
            paths.add(featurePath);
            excludedFeaturePaths.set(classification, paths);
          },
        });
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
          features: featureSnapshot.features,
          featureCoverage: featureSnapshot.featureCoverage,
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
      explicitMaxEventCountShare: hasCliOption('maxEventCountShare', 'U'),
    });
    let searchBar: ProgressBar | null = null;
    let searchBarPhase: AiPocketSearchProgressPhase | null = null;
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
      onProgress: (progress) => {
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
      },
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
  const result = {
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
      sealedTest: sealedFullSplit.evidence,
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
        ['objective', chalk.yellow(objective)],
        ['direction', direction ? chalk.yellow(direction) : chalk.gray('all')],
        ['scope_rows', chalk.blue(String(scopeRows.length))],
        ['train_rows', chalk.blue(String(trainRows.length))],
        ['validation_rows', chalk.blue(String(validationRows.length))],
        ['test_rows', chalk.blue(String(testRows.length))],
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
          sealedFullSplit.evidence.sealed
            ? chalk.green(
                `sealed (${sealedFullSplit.evidence.rows} rows / ${sealedFullSplit.evidence.events} events)`,
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

  process.exit(failed === selectedRows ? 1 : 0);
};
