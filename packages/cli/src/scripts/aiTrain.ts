import args from 'args';
import chalk from 'chalk';
const ListIt = require('list-it');
import fs from 'fs/promises';
import path from 'path';
import ProgressBar from 'progress';
import { TTL_1M } from '@tradejs/core/constants';
import {
  countAiDatasetRows,
  streamAiDatasetRows,
  toFileToken,
} from '@tradejs/infra/ai';
import { redisKeys, setData } from '@tradejs/infra/redis';
import {
  DEFAULT_AI_MODEL,
  buildAiPayload,
  buildAiPrompts,
  ensureAiStrategyPluginsLoaded,
  getDeterministicAiGateContext,
  runAiPrompt,
  runAiPromptLocal,
} from '@tradejs/node/ai';
import { AI_CONCURRENCY_LIMIT } from '@tradejs/node/constants';
import { AiDatasetRow, Signal, SignalAnalysis } from '@tradejs/types';
import {
  buildAiChartSnapshot,
  type AiTrainEvaluatedRowForChart,
} from '../lib/aiTrainCharts';
import {
  summarizeAiTrainEvaluations,
  summarizeAiTrainEvaluationsByDirection,
  summarizeAiTrainEvaluationsByMonth,
  summarizeAiTrainEvaluationsByQualityThreshold,
} from '../lib/aiTrainMetrics';
import {
  buildAiTrainEvaluationFeatureSnapshot,
  type AiTrainEvaluationFeatureSnapshot,
} from '../lib/aiTrainEvaluationDump';
import {
  parseDumpFeatureMode,
  parseQualityThresholds,
  parseTerminalWindowDays,
  parseTimestampFilter,
  parseTrailingPeriodMs,
  resolveAiTrainRecentLimit,
} from '../lib/aiTrainOptions';
import {
  buildAiTrainLineage,
  summarizeAiTrainCoverage,
  summarizeAiTrainRejectReasons,
  summarizeAiTrainTerminalWindows,
} from '../lib/aiTrainResearch';
import {
  applyAiTrainSymbolQuarantine,
  summarizeAiTrainDuplicateSignals,
  type AiTrainDuplicateSignalRow,
  type AiTrainSymbolQuarantineSummary,
} from '../lib/aiTrainQuarantine';
import { extractSignalFromAiDatasetRow } from '../lib/aiTrainDataset';

args.example(
  'yarn ai-train -n 50 --minQuality 4',
  'Replay latest AI prompt dataset and measure approval accuracy',
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
  ['p', 'parallel'],
  'Concurrent AI requests during replay',
  AI_CONCURRENCY_LIMIT,
);
args.option(
  ['m', 'model'],
  'OpenRouter model id override for this replay run',
  DEFAULT_AI_MODEL,
);
args.option(
  ['M', 'minQuality'],
  'Minimum AI quality required to approve entry',
  4,
);
args.option(
  ['l', 'localOnly'],
  'Replay deterministic adapter gate without AI provider calls',
  false,
);
args.option(['U', 'user'], 'Use user config', 'root');
args.option(
  ['c', 'chart'],
  'Save compact AI approval chart data for the strategies UI',
  false,
);
args.option(['j', 'json'], 'Print structured JSON summary', false);
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
  'Comma-separated qN+ thresholds to summarize',
  '3,4,5',
);
args.option(
  ['W', 'terminalWindows'],
  'Comma-separated terminal dataset windows in days; use --terminalWindows=90,30,7',
  '90,30,7',
);
args.option(
  ['d', 'dumpEvaluations'],
  'Write evaluated rows as JSONL for offline pocket research',
  '',
);
args.option(
  ['G', 'dumpFeatures'],
  'Feature snapshot to include in --dumpEvaluations rows: none, gateFeatures, or baseContext',
  'none',
);
args.option(
  ['Q', 'symbolQuarantine'],
  'Apply ordered per-strategy/per-symbol quarantine overlay to approved rows',
  false,
);
args.option(
  ['L', 'symbolQuarantineMinLosses'],
  'Approved losses required before symbol quarantine can trigger',
  5,
);
args.option(
  ['F', 'symbolQuarantineMinProfitFactor'],
  'Minimum symbol profit factor required to avoid quarantine',
  1,
);
args.option(
  ['D', 'symbolQuarantineDays'],
  'How many days to keep a symbol quarantined after trigger',
  14,
);

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

const formatMetricNumber = (value: number | null) =>
  value == null ? 'n/a' : value.toFixed(2);

const colorizeRatio = (value: number | null) => {
  const text = formatRatio(value);
  if (value == null) {
    return chalk.gray(text);
  }
  if (value >= 0.6) {
    return chalk.green(text);
  }
  if (value >= 0.3) {
    return chalk.yellow(text);
  }
  return chalk.red(text);
};

const colorizePercent = (value: number, total: number) => {
  const ratio = total > 0 ? value / total : null;
  return colorizeRatio(ratio);
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

const colorizeMetricNumber = (value: number | null) => {
  const text = formatMetricNumber(value);
  return value == null ? chalk.gray(text) : chalk.cyan(text);
};

const colorizeQuality = (quality: number | null) => {
  const text = quality == null ? 'n/a' : String(quality);
  if (quality == null) {
    return chalk.gray(text);
  }
  if (quality >= 4) {
    return chalk.green(text);
  }
  if (quality === 3) {
    return chalk.yellow(text);
  }
  return chalk.red(text);
};

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

const isProfitableTrade = (row: AiDatasetRow) => Number(row.profit) > 0;

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

const resolvePromptRunContext = (row: AiDatasetRow) => {
  const signal = extractSignalFromAiDatasetRow(row);

  return {
    signal,
    promptPair: buildAiPrompts(signal),
  };
};

const getDeterministicGateContext = (signal: Signal) => {
  const payload = buildAiPayload(signal);
  return getDeterministicAiGateContext(payload);
};

type DeterministicGateEvaluation = {
  direction: string;
  signalAvailable: boolean;
  coreBlocked: boolean;
  adapterBlocked: boolean;
  modelCandidate: boolean;
};

type DeterministicGateSummary = {
  selected: number;
  signalAvailable: number;
  signalMissing: number;
  coreBlocked: number;
  adapterBlocked: number;
  modelCandidate: number;
  modelApproved: number;
  modelRejected: number;
  modelFailed: number;
};

type AiTrainResult = {
  run: {
    strategy: string;
    datasetId: string | null;
    shardCount: number;
    filePath: string;
    selected: number;
    sourceRows: number;
    scanned: number;
    dateSkipped: number;
    recent: number;
    skip: number;
    since: number | null;
    until: number | null;
    period: string | null;
    minQuality: number;
    mode: 'local-deterministic' | 'llm';
    model: string;
    parallel: number;
    dumpFeatures: ReturnType<typeof parseDumpFeatureMode>;
    terminalWindows: number[];
  };
  outcome: ReturnType<typeof summarizeAiTrainEvaluations>;
  byDirection: ReturnType<typeof summarizeAiTrainEvaluationsByDirection>;
  monthly: ReturnType<typeof summarizeAiTrainEvaluationsByMonth>;
  qualityThresholds: ReturnType<
    typeof summarizeAiTrainEvaluationsByQualityThreshold
  >;
  deterministicFlow: DeterministicGateSummary;
  qualityBreakdown: ReturnType<
    typeof summarizeAiTrainEvaluations
  >['qualityBuckets'];
  symbolQuarantine: AiTrainSymbolQuarantineSummary;
  duplicates: ReturnType<typeof summarizeAiTrainDuplicateSignals>;
  research: {
    coverage: ReturnType<typeof summarizeAiTrainCoverage>;
    terminalWindows: ReturnType<typeof summarizeAiTrainTerminalWindows>;
    topRejectReasons: ReturnType<typeof summarizeAiTrainRejectReasons>;
    lineage: Awaited<ReturnType<typeof buildAiTrainLineage>>;
  };
  errors: {
    failed: number;
    providerErrors: string[];
  };
};

type AiTrainEvaluatedRow = AiTrainEvaluatedRowForChart;

const resolveDeterministicGateEvaluation = (
  signal: Signal | null,
  fallbackDirection: string,
): DeterministicGateEvaluation => {
  if (!signal) {
    return {
      direction: fallbackDirection || 'UNKNOWN',
      signalAvailable: false,
      coreBlocked: false,
      adapterBlocked: false,
      modelCandidate: false,
    };
  }

  const gateContext = getDeterministicGateContext(signal);
  const structuralHardBlockReasons = Array.isArray(
    gateContext?.structuralHardBlockReasons,
  )
    ? gateContext.structuralHardBlockReasons.filter(
        (reason): reason is string =>
          typeof reason === 'string' && reason.trim().length > 0,
      )
    : [];
  const coreBlocked = structuralHardBlockReasons.length > 0;
  const approvalAllowedNow =
    typeof gateContext?.approvalAllowedNow === 'boolean'
      ? gateContext.approvalAllowedNow
      : null;
  const adapterBlocked = !coreBlocked && approvalAllowedNow === false;

  return {
    direction:
      typeof signal.direction === 'string' && signal.direction.trim()
        ? signal.direction
        : fallbackDirection || 'UNKNOWN',
    signalAvailable: true,
    coreBlocked,
    adapterBlocked,
    modelCandidate: !coreBlocked && !adapterBlocked,
  };
};

const summarizeDeterministicGateEvaluations = (
  deterministicEvaluations: DeterministicGateEvaluation[],
  evaluations: Array<{ aiApproved: boolean; modelCandidate: boolean }>,
): DeterministicGateSummary => {
  const summary: DeterministicGateSummary = {
    selected: deterministicEvaluations.length,
    signalAvailable: 0,
    signalMissing: 0,
    coreBlocked: 0,
    adapterBlocked: 0,
    modelCandidate: 0,
    modelApproved: 0,
    modelRejected: 0,
    modelFailed: 0,
  };

  for (const evaluation of deterministicEvaluations) {
    if (evaluation.signalAvailable) {
      summary.signalAvailable += 1;
    } else {
      summary.signalMissing += 1;
    }

    if (evaluation.coreBlocked) {
      summary.coreBlocked += 1;
    } else if (evaluation.adapterBlocked) {
      summary.adapterBlocked += 1;
    } else if (evaluation.modelCandidate) {
      summary.modelCandidate += 1;
    }
  }

  for (const evaluation of evaluations) {
    if (!evaluation.modelCandidate) {
      continue;
    }

    if (evaluation.aiApproved) {
      summary.modelApproved += 1;
    } else {
      summary.modelRejected += 1;
    }
  }

  summary.modelFailed =
    summary.modelCandidate - summary.modelApproved - summary.modelRejected;

  return summary;
};

const printSection = (title: string, table: string) => {
  console.log(chalk.gray(`${title}:`));
  console.log(table);
  console.log('');
};

const persistAiChartSnapshot = async (params: {
  strategyName: string;
  evaluatedRows: AiTrainEvaluatedRow[];
  model: string;
  mode: 'local-deterministic' | 'llm';
  userName: string;
  minQuality: number;
  datasetId?: string;
}) => {
  const {
    strategyName,
    evaluatedRows,
    model,
    mode,
    userName,
    minQuality,
    datasetId,
  } = params;
  const generatedAt = Date.now();
  const runLabel = mode === model ? '' : `${mode}:${model}`;
  const snapshot = buildAiChartSnapshot({
    evaluatedRows,
    strategyName,
    generatedAt,
    runLabel,
    minQuality,
    datasetId,
  });

  await Promise.all(
    snapshot.strategies.map((card) =>
      setData(redisKeys.strategyChartCard(userName, 'ai', card.cardId), card, {
        expire: TTL_1M,
      }),
    ),
  );

  return snapshot;
};

const resolveDatasetFiles = async () => {
  const explicitFile = String(flags.file || '').trim();
  const outDir = String(flags.outDir || 'data/ai/export');
  const strategyName = String(flags.strategy || '').trim() || undefined;

  return resolveMergedDatasetFiles({
    outDir,
    strategyName,
    explicitFile,
  });
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

export const main = async () => {
  const skip = normalizeInt(flags.skip, 0);
  const minQuality = normalizeInt(flags.minQuality, 4);
  const localOnly = Boolean(flags.localOnly);
  const saveChart = Boolean(flags.chart);
  const jsonOutput = Boolean(flags.json);
  const sinceInput = parseTimestampFilter(flags.since);
  const untilInput = parseTimestampFilter(flags.until);
  const trailingPeriodMs = parseTrailingPeriodMs(flags.period);
  const periodLabel = String(flags.period || '').trim() || null;
  const hasDateFilter =
    trailingPeriodMs != null || sinceInput != null || untilInput != null;
  const recent = resolveAiTrainRecentLimit({
    argv: process.argv,
    recentValue: flags.recent,
    hasDateFilter,
  });
  const qualityThresholds = parseQualityThresholds(flags.qualityThresholds);
  const terminalWindowDays = parseTerminalWindowDays(flags.terminalWindows);
  const dumpEvaluationsPath = String(flags.dumpEvaluations || '').trim();
  const dumpFeatureMode = parseDumpFeatureMode(flags.dumpFeatures);
  if (dumpFeatureMode !== 'none' && !dumpEvaluationsPath) {
    throw new Error('--dumpFeatures requires --dumpEvaluations.');
  }
  const symbolQuarantineEnabled = Boolean(flags.symbolQuarantine);
  const symbolQuarantineMinLosses = normalizePositiveInt(
    flags.symbolQuarantineMinLosses,
    5,
  );
  const symbolQuarantineMinProfitFactor = normalizeNonNegativeNumber(
    flags.symbolQuarantineMinProfitFactor,
    1,
  );
  const symbolQuarantineDays = normalizeNonNegativeNumber(
    flags.symbolQuarantineDays,
    14,
  );
  const userName = String(flags.user || 'root').trim() || 'root';
  const model =
    String(flags.model || DEFAULT_AI_MODEL).trim() || DEFAULT_AI_MODEL;
  const parallel = normalizePositiveInt(flags.parallel, AI_CONCURRENCY_LIMIT);
  await ensureAiStrategyPluginsLoaded();
  const filePaths = await resolveDatasetFiles();
  const datasetId = getMergedGroupId(filePaths[0] || '')?.mergeId;
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
  const untilTimestamp = untilInput;

  if (!selectedRows) {
    console.log(
      chalk.yellow(
        `No AI prompt rows selected in ${filePaths.join(', ')} (recent=${recent || 'all'}, skip=${skip})`,
      ),
    );
    process.exit(0);
  }

  let strategyName = deriveStrategyNameFromFile(filePaths[0] || '');
  let strategyNameResolvedFromRow = false;
  const concurrency = Math.max(1, Math.min(parallel, selectedRows));
  const bar = jsonOutput
    ? null
    : new ProgressBar(':current/:total [:bar][:percent] :symbol :status', {
        total: selectedRows,
        width: 20,
      });

  let failed = 0;
  let scanned = 0;
  let dateSkipped = 0;
  const errorMessages: string[] = [];
  const evaluations: Array<{
    signalId: string;
    profit: number;
    profitableTrade: boolean;
    aiApproved: boolean;
    rawAiApproved: boolean;
    quality: number | null;
    direction: string | null;
    modelDirection: string | null;
    modelDirectionMatches: boolean;
    timestamp: number | null;
    modelCandidate: boolean;
    strategy: string;
    symbol: string;
    testName: string;
    configId: string;
    rejectReason: string | null;
    sequence: number;
    features?: AiTrainEvaluationFeatureSnapshot;
  }> = [];
  const evaluatedRows: AiTrainEvaluatedRow[] = [];
  const duplicateSignalRows: AiTrainDuplicateSignalRow[] = [];
  const deterministicEvaluations: DeterministicGateEvaluation[] = [];
  const activeTasks = new Set<Promise<void>>();

  const processRow = async (row: AiDatasetRow, sequence: number) => {
    const { promptPair, signal } = resolvePromptRunContext(row);
    const payload = buildAiPayload(signal);
    const deterministic = resolveDeterministicGateEvaluation(
      signal,
      row.direction,
    );
    const profit = Number(row.profit);
    const profitableTrade = isProfitableTrade(row);

    deterministicEvaluations.push(deterministic);

    try {
      const analysis = localOnly
        ? await runAiPromptLocal(signal, { payload })
        : await runAiPrompt(
            promptPair,
            signal
              ? {
                  model,
                  signal,
                  payload,
                }
              : { model },
          );
      const aiApproved = isAiApproval(row, analysis, minQuality);
      const quality = normalizeQuality(analysis);
      const timestamp = Number.isFinite(Number(row.timestamp))
        ? Number(row.timestamp)
        : null;
      const modelDirection =
        typeof analysis.direction === 'string' && analysis.direction.trim()
          ? analysis.direction
          : null;
      const rejectReason =
        typeof (analysis as Record<string, unknown>).rejectReason ===
          'string' && (analysis as Record<string, unknown>).rejectReason
          ? String((analysis as Record<string, unknown>).rejectReason)
          : null;
      const modelDirectionMatches = modelDirection === row.direction;
      const isCorrect = aiApproved === profitableTrade;
      const features = buildAiTrainEvaluationFeatureSnapshot({
        additionalIndicators: payload.additionalIndicators,
        mode: dumpFeatureMode,
      });

      evaluations.push({
        signalId: row.signalId,
        profit,
        profitableTrade,
        aiApproved,
        rawAiApproved: aiApproved,
        quality,
        direction: row.direction,
        modelDirection,
        modelDirectionMatches,
        timestamp,
        modelCandidate: deterministic.modelCandidate,
        strategy: row.strategyName,
        symbol: row.symbol,
        testName: row.testName?.trim() || '',
        configId: row.configId?.trim() || '',
        rejectReason,
        sequence,
        ...(features ? { features } : {}),
      });

      if (saveChart) {
        evaluatedRows.push({
          signalId: row.signalId,
          symbol: row.symbol,
          testName: row.testName?.trim() || '',
          configId: row.configId?.trim() || '',
          modelDirection,
          profit,
          profitableTrade,
          aiApproved,
          quality,
          direction: row.direction,
          timestamp,
          strategy: row.strategyName,
          rawAiApproved: aiApproved,
          sequence,
          tradeResult: row.tradeResult,
        });
      }

      bar?.tick(1, {
        symbol: chalk.gray(row.symbol),
        status: isCorrect ? chalk.green('ok') : chalk.red('miss'),
      });
    } catch (error) {
      failed += 1;
      if (errorMessages.length < 5) {
        errorMessages.push(
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
  };

  await streamAiDatasetRows({
    filePaths,
    limitFromEnd: recent,
    skipFromEnd: skip,
    onRow: async (row) => {
      scanned += 1;
      if (
        !strategyNameResolvedFromRow &&
        typeof row.strategyName === 'string' &&
        row.strategyName.trim()
      ) {
        strategyName = row.strategyName.trim();
        strategyNameResolvedFromRow = true;
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

      duplicateSignalRows.push(row);
      const task = processRow(row, duplicateSignalRows.length - 1).finally(
        () => {
          activeTasks.delete(task);
        },
      );
      activeTasks.add(task);

      if (activeTasks.size >= concurrency) {
        await Promise.race(activeTasks);
      }
    },
  });

  await Promise.all(activeTasks);

  const quarantine = applyAiTrainSymbolQuarantine(evaluations, {
    enabled: symbolQuarantineEnabled,
    minApprovedLosses: symbolQuarantineMinLosses,
    minProfitFactor: symbolQuarantineMinProfitFactor,
    cooldownDays: symbolQuarantineDays,
  });
  const finalEvaluations = quarantine.evaluations;
  const duplicateSummary =
    summarizeAiTrainDuplicateSignals(duplicateSignalRows);
  if (saveChart && symbolQuarantineEnabled) {
    const approvalByKey = new Map(
      finalEvaluations.map((evaluation) => [
        evaluation.sequence,
        evaluation.aiApproved,
      ]),
    );
    for (const row of evaluatedRows) {
      if (row.sequence != null) {
        row.aiApproved = approvalByKey.get(row.sequence) ?? row.aiApproved;
      }
    }
  }

  const summary = summarizeAiTrainEvaluations(finalEvaluations);
  const directionSummaries =
    summarizeAiTrainEvaluationsByDirection(finalEvaluations);
  const monthlySummaries = summarizeAiTrainEvaluationsByMonth(finalEvaluations);
  const qualityThresholdSummaries =
    summarizeAiTrainEvaluationsByQualityThreshold(
      finalEvaluations,
      qualityThresholds,
    );
  const deterministicSummary = summarizeDeterministicGateEvaluations(
    deterministicEvaluations,
    finalEvaluations.map((evaluation) => ({
      aiApproved: evaluation.rawAiApproved ?? evaluation.aiApproved,
      modelCandidate: evaluation.modelCandidate,
    })),
  );
  const coverage = summarizeAiTrainCoverage(finalEvaluations);
  const terminalWindows = summarizeAiTrainTerminalWindows(
    finalEvaluations,
    terminalWindowDays,
  );
  const topRejectReasons = summarizeAiTrainRejectReasons(finalEvaluations);
  const lineage = await buildAiTrainLineage({
    projectRoot:
      String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd(),
    strategyName,
    configIds: finalEvaluations.map((evaluation) => evaluation.configId),
    runContext: {
      mode: localOnly ? 'local-deterministic' : 'llm',
      model: localOnly ? 'local-deterministic' : model,
      minQuality,
    },
  });
  const evaluated = summary.correct + summary.incorrect;
  const result: AiTrainResult = {
    run: {
      strategy: strategyName,
      datasetId: datasetId ?? null,
      shardCount: filePaths.length,
      filePath: filePaths.join(','),
      selected: finalEvaluations.length,
      sourceRows: totalRows,
      scanned,
      dateSkipped,
      recent,
      skip,
      since: sinceTimestamp,
      until: untilTimestamp,
      period: periodLabel,
      minQuality,
      mode: localOnly ? 'local-deterministic' : 'llm',
      model: localOnly ? 'local-deterministic' : model,
      parallel: concurrency,
      dumpFeatures: dumpFeatureMode,
      terminalWindows: terminalWindowDays,
    },
    outcome: summary,
    byDirection: directionSummaries,
    monthly: monthlySummaries,
    qualityThresholds: qualityThresholdSummaries,
    deterministicFlow: deterministicSummary,
    qualityBreakdown: summary.qualityBuckets,
    symbolQuarantine: quarantine.summary,
    duplicates: duplicateSummary,
    research: {
      coverage,
      terminalWindows,
      topRejectReasons,
      lineage,
    },
    errors: {
      failed,
      providerErrors: errorMessages,
    },
  };

  if (dumpEvaluationsPath) {
    await fs.mkdir(path.dirname(path.resolve(dumpEvaluationsPath)), {
      recursive: true,
    });
    await fs.writeFile(
      dumpEvaluationsPath,
      finalEvaluations
        .map((evaluation) =>
          JSON.stringify({
            signalId: evaluation.signalId,
            strategy: evaluation.strategy,
            symbol: evaluation.symbol,
            direction: evaluation.direction,
            modelDirection: evaluation.modelDirection,
            modelDirectionMatches: evaluation.modelDirectionMatches,
            timestamp: evaluation.timestamp,
            testName: evaluation.testName,
            configId: evaluation.configId,
            profit: evaluation.profit,
            profitableTrade: evaluation.profitableTrade,
            aiApproved: evaluation.aiApproved,
            rawAiApproved: evaluation.rawAiApproved,
            quality: evaluation.quality,
            modelCandidate: evaluation.modelCandidate,
            rejectReason: evaluation.rejectReason,
            sequence: evaluation.sequence,
            ...(evaluation.features ? { features: evaluation.features } : {}),
          }),
        )
        .join('\n') + (finalEvaluations.length ? '\n' : ''),
      'utf8',
    );
  }

  if (saveChart) {
    await persistAiChartSnapshot({
      strategyName,
      evaluatedRows,
      minQuality,
      model: localOnly ? 'local-deterministic' : model,
      mode: localOnly ? 'local-deterministic' : 'llm',
      userName,
      datasetId,
    });
  }

  if (jsonOutput) {
    console.log(JSON.stringify(result));
    process.exit(failed === selectedRows ? 1 : 0);
  }

  console.log('');
  console.log(chalk.green('AI train finished'));
  filePaths.forEach((filePath) => {
    console.log(chalk.gray(filePath));
  });
  console.log('');

  printSection(
    'RUN',
    createTable(
      [chalk.gray('FIELD'), chalk.gray('VALUE')],
      [
        ['strategy', chalk.yellow(strategyName)],
        ['dataset_id', chalk.gray(datasetId ?? 'n/a')],
        ['dataset_shards', chalk.blue(String(filePaths.length))],
        ['selected', chalk.blue(String(finalEvaluations.length))],
        ['source_rows', chalk.blue(String(totalRows))],
        ['scanned', chalk.blue(String(scanned))],
        ['date_skipped', chalk.blue(String(dateSkipped))],
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
        [
          'mode',
          localOnly ? chalk.green('local-deterministic') : chalk.yellow('llm'),
        ],
        ['model', chalk.yellow(localOnly ? 'local-deterministic' : model)],
        ['parallel', chalk.magenta(String(concurrency))],
        [
          'terminal_windows',
          terminalWindowDays.length
            ? chalk.gray(terminalWindowDays.map((days) => `${days}d`).join(','))
            : chalk.gray('off'),
        ],
        [
          'dataset_min_timestamp',
          coverage.minTimestamp == null
            ? chalk.gray('n/a')
            : chalk.gray(new Date(coverage.minTimestamp).toISOString()),
        ],
        [
          'dataset_max_timestamp',
          coverage.maxTimestamp == null
            ? chalk.gray('n/a')
            : chalk.gray(new Date(coverage.maxTimestamp).toISOString()),
        ],
        [
          'dataset_lag_days',
          coverage.dataLagDays == null
            ? chalk.gray('n/a')
            : chalk.yellow(coverage.dataLagDays.toFixed(2)),
        ],
        ['git_sha', chalk.gray(lineage.gitSha ?? 'n/a')],
        [
          'git_dirty',
          lineage.gitDirty == null
            ? chalk.gray('n/a')
            : lineage.gitDirty
              ? chalk.yellow('true')
              : chalk.green('false'),
        ],
        ['gate_fingerprint', chalk.gray(lineage.gateFingerprint)],
        ['config_ids_fingerprint', chalk.gray(lineage.configIdsFingerprint)],
        ['context_fingerprint', chalk.gray(lineage.contextFingerprint)],
        [
          'symbol_quarantine',
          symbolQuarantineEnabled ? chalk.green('enabled') : chalk.gray('off'),
        ],
        [
          'dump_evaluations',
          dumpEvaluationsPath
            ? chalk.gray(dumpEvaluationsPath)
            : chalk.gray('off'),
        ],
        [
          'dump_features',
          dumpFeatureMode === 'none'
            ? chalk.gray('off')
            : chalk.gray(dumpFeatureMode),
        ],
      ],
    ),
  );

  printSection(
    'OUTCOME',
    createTable(
      [chalk.gray('METRIC'), chalk.gray('VALUE')],
      [
        ['accuracy', colorizePercent(summary.correct, evaluated)],
        ['evaluated', chalk.blue(String(evaluated))],
        ['correct', chalk.green(String(summary.correct))],
        ['incorrect', chalk.red(String(summary.incorrect))],
        [
          'failed',
          failed > 0 ? chalk.yellow(String(failed)) : chalk.green('0'),
        ],
        ['approved', chalk.cyan(String(summary.approved))],
        ['rejected', chalk.cyan(String(summary.rejected))],
        ['profitable', chalk.green(String(summary.profitable))],
        ['unprofitable', chalk.red(String(summary.unprofitable))],
        ['flat', chalk.yellow(String(summary.flat))],
        ['precision_approved', colorizeRatio(summary.precisionApproved)],
        ['recall_winners', colorizeRatio(summary.recallWinners)],
        ['avg_profit_all', colorizeProfit(summary.avgProfitAll)],
        ['avg_profit_approved', colorizeProfit(summary.avgProfitApproved)],
        [
          'avg_profit_approved_per_day',
          colorizeProfit(summary.avgProfitApprovedPerDay),
        ],
        [
          'avg_profit_approved_per_month',
          colorizeProfit(summary.avgProfitApprovedPerMonth),
        ],
        [
          'avg_approved_trades_per_day',
          colorizeMetricNumber(summary.avgApprovedTradesPerDay),
        ],
        [
          'avg_approved_trades_per_week',
          colorizeMetricNumber(summary.avgApprovedTradesPerWeek),
        ],
        ['expectancy_delta', colorizeProfit(summary.expectancyDelta)],
      ],
    ),
  );

  if (terminalWindows.length) {
    printSection(
      'TERMINAL WINDOWS (ANCHORED TO DATASET MAX)',
      createTable(
        [
          chalk.gray('WINDOW'),
          chalk.gray('COVERAGE'),
          chalk.gray('FROM'),
          chalk.gray('TO'),
          chalk.gray('EVAL'),
          chalk.gray('APPROVED'),
          chalk.gray('CALENDAR/D'),
          chalk.gray('WR'),
          chalk.gray('PF'),
          chalk.gray('PNL'),
          chalk.gray('MAX_DD'),
          chalk.gray('TOP REJECT'),
        ],
        terminalWindows.map((window) => [
          chalk.yellow(window.label),
          window.complete ? chalk.green('full') : chalk.yellow('partial'),
          chalk.gray(new Date(window.since).toISOString()),
          chalk.gray(new Date(window.until).toISOString()),
          chalk.blue(String(window.selected)),
          chalk.cyan(String(window.outcome.approved)),
          colorizeMetricNumber(window.approvedPerCalendarDay),
          colorizeRatio(window.outcome.approvedRisk.winRate),
          colorizeMetricNumber(window.outcome.approvedRisk.profitFactor),
          colorizeProfit(window.outcome.approvedRisk.totalProfit),
          colorizeProfit(-window.outcome.approvedRisk.maxDrawdown),
          chalk.gray(
            window.topRejectReasons[0]
              ? `${window.topRejectReasons[0].reason} (${window.topRejectReasons[0].count})`
              : 'n/a',
          ),
        ]),
      ),
    );
  }

  if (topRejectReasons.length) {
    printSection(
      'TOP REJECT REASONS',
      createTable(
        [chalk.gray('REASON'), chalk.gray('COUNT')],
        topRejectReasons.map(({ reason, count }) => [
          chalk.yellow(reason),
          chalk.blue(String(count)),
        ]),
      ),
    );
  }

  printSection(
    'CONFUSION',
    createTable(
      [chalk.green('TP'), chalk.red('FP'), chalk.green('TN'), chalk.red('FN')],
      [
        [
          chalk.green(String(summary.truePositive)),
          chalk.red(String(summary.falsePositive)),
          chalk.green(String(summary.trueNegative)),
          chalk.red(String(summary.falseNegative)),
        ],
      ],
    ),
  );

  printSection(
    'APPROVED RISK',
    createTable(
      [chalk.gray('METRIC'), chalk.gray('VALUE')],
      [
        ['trades', chalk.cyan(String(summary.approvedRisk.trades))],
        ['total_profit', colorizeProfit(summary.approvedRisk.totalProfit)],
        ['gross_profit', colorizeProfit(summary.approvedRisk.grossProfit)],
        ['gross_loss', colorizeProfit(-summary.approvedRisk.grossLoss)],
        [
          'profit_factor',
          colorizeMetricNumber(summary.approvedRisk.profitFactor),
        ],
        [
          'payoff_ratio',
          colorizeMetricNumber(summary.approvedRisk.payoffRatio),
        ],
        ['avg_win', colorizeProfit(summary.approvedRisk.avgWin)],
        [
          'avg_loss',
          summary.approvedRisk.avgLoss == null
            ? chalk.gray('n/a')
            : colorizeProfit(-summary.approvedRisk.avgLoss),
        ],
        ['largest_win', colorizeProfit(summary.approvedRisk.largestWin)],
        ['largest_loss', colorizeProfit(summary.approvedRisk.largestLoss)],
        ['win_rate', colorizeRatio(summary.approvedRisk.winRate)],
        ['max_drawdown', colorizeProfit(-summary.approvedRisk.maxDrawdown)],
        [
          'max_drawdown_pct_of_gross_profit',
          colorizeRatio(summary.approvedRisk.maxDrawdownPctOfGrossProfit),
        ],
        [
          'max_drawdown_pct_of_total_profit',
          colorizeRatio(summary.approvedRisk.maxDrawdownPctOfTotalProfit),
        ],
        [
          'recovery_factor',
          colorizeMetricNumber(summary.approvedRisk.recoveryFactor),
        ],
        ['ulcer_index', colorizeMetricNumber(summary.approvedRisk.ulcerIndex)],
        [
          'max_consecutive_wins',
          chalk.green(String(summary.approvedRisk.maxConsecutiveWins)),
        ],
        [
          'max_consecutive_losses',
          chalk.red(String(summary.approvedRisk.maxConsecutiveLosses)),
        ],
      ],
    ),
  );

  if (directionSummaries.length) {
    printSection(
      'BY DIRECTION',
      createTable(
        [
          chalk.gray('DIR'),
          chalk.gray('EVAL'),
          chalk.gray('ACCURACY'),
          chalk.gray('APPROVED'),
          chalk.gray('CADENCE/D'),
          chalk.gray('WR'),
          chalk.gray('PF'),
          chalk.gray('PNL'),
          chalk.gray('MAX_DD'),
          chalk.green('TP'),
          chalk.red('FP'),
          chalk.green('TN'),
          chalk.red('FN'),
          chalk.gray('PRECISION'),
          chalk.gray('RECALL'),
        ],
        directionSummaries.map(({ direction, summary: directionSummary }) => {
          const directionEvaluated =
            directionSummary.correct + directionSummary.incorrect;
          return [
            chalk.yellow(direction),
            chalk.blue(String(directionEvaluated)),
            colorizePercent(directionSummary.correct, directionEvaluated),
            chalk.cyan(String(directionSummary.approved)),
            colorizeMetricNumber(directionSummary.avgApprovedTradesPerDay),
            colorizeRatio(directionSummary.approvedRisk.winRate),
            colorizeMetricNumber(directionSummary.approvedRisk.profitFactor),
            colorizeProfit(directionSummary.approvedRisk.totalProfit),
            colorizeProfit(-directionSummary.approvedRisk.maxDrawdown),
            chalk.green(String(directionSummary.truePositive)),
            chalk.red(String(directionSummary.falsePositive)),
            chalk.green(String(directionSummary.trueNegative)),
            chalk.red(String(directionSummary.falseNegative)),
            colorizeRatio(directionSummary.precisionApproved),
            colorizeRatio(directionSummary.recallWinners),
          ];
        }),
      ),
    );
  }

  if (qualityThresholdSummaries.length) {
    printSection(
      'QUALITY THRESHOLDS',
      createTable(
        [
          chalk.gray('BUCKET'),
          chalk.gray('APPROVED'),
          chalk.gray('CADENCE/D'),
          chalk.gray('WR'),
          chalk.gray('PF'),
          chalk.gray('PNL'),
          chalk.gray('MAX_DD'),
        ],
        qualityThresholdSummaries.map(
          ({ label, summary: thresholdSummary }) => [
            chalk.yellow(label),
            chalk.cyan(String(thresholdSummary.approved)),
            colorizeMetricNumber(thresholdSummary.avgApprovedTradesPerDay),
            colorizeRatio(thresholdSummary.approvedRisk.winRate),
            colorizeMetricNumber(thresholdSummary.approvedRisk.profitFactor),
            colorizeProfit(thresholdSummary.approvedRisk.totalProfit),
            colorizeProfit(-thresholdSummary.approvedRisk.maxDrawdown),
          ],
        ),
      ),
    );
  }

  if (monthlySummaries.length) {
    const losingMonths = monthlySummaries.filter(
      ({ summary: monthSummary }) => monthSummary.approvedRisk.totalProfit < 0,
    ).length;
    printSection(
      'MONTHLY STABILITY',
      createTable(
        [
          chalk.gray('MONTH'),
          chalk.gray('APPROVED'),
          chalk.gray('WR'),
          chalk.gray('PF'),
          chalk.gray('PNL'),
          chalk.gray('MAX_DD'),
        ],
        [
          [
            chalk.yellow('losing_months'),
            chalk.cyan(`${losingMonths}/${monthlySummaries.length}`),
            chalk.gray(''),
            chalk.gray(''),
            chalk.gray(''),
            chalk.gray(''),
          ],
          ...monthlySummaries.map(({ month, summary: monthSummary }) => [
            chalk.yellow(month),
            chalk.cyan(String(monthSummary.approved)),
            colorizeRatio(monthSummary.approvedRisk.winRate),
            colorizeMetricNumber(monthSummary.approvedRisk.profitFactor),
            colorizeProfit(monthSummary.approvedRisk.totalProfit),
            colorizeProfit(-monthSummary.approvedRisk.maxDrawdown),
          ]),
        ],
      ),
    );
  }

  printSection(
    'DETERMINISTIC FLOW',
    createTable(
      [chalk.gray('METRIC'), chalk.gray('VALUE')],
      [
        ['selected', chalk.blue(String(deterministicSummary.selected))],
        [
          'signal_available',
          chalk.blue(String(deterministicSummary.signalAvailable)),
        ],
        [
          'signal_missing',
          deterministicSummary.signalMissing > 0
            ? chalk.yellow(String(deterministicSummary.signalMissing))
            : chalk.green('0'),
        ],
        [
          'core_blocked_now',
          deterministicSummary.coreBlocked > 0
            ? chalk.yellow(String(deterministicSummary.coreBlocked))
            : chalk.green('0'),
        ],
        [
          'adapter_blocked_now',
          deterministicSummary.adapterBlocked > 0
            ? chalk.yellow(String(deterministicSummary.adapterBlocked))
            : chalk.green('0'),
        ],
        [
          'left_to_model_now',
          chalk.cyan(String(deterministicSummary.modelCandidate)),
        ],
        [
          'model_approved',
          chalk.green(String(deterministicSummary.modelApproved)),
        ],
        [
          'model_rejected',
          chalk.red(String(deterministicSummary.modelRejected)),
        ],
        [
          'model_failed',
          deterministicSummary.modelFailed > 0
            ? chalk.yellow(String(deterministicSummary.modelFailed))
            : chalk.green('0'),
        ],
      ],
    ),
  );

  printSection(
    'SYMBOL QUARANTINE',
    createTable(
      [chalk.gray('FIELD'), chalk.gray('VALUE')],
      [
        [
          'enabled',
          quarantine.summary.enabled
            ? chalk.green('true')
            : chalk.gray('false'),
        ],
        [
          'min_approved_losses',
          chalk.cyan(String(quarantine.summary.minApprovedLosses)),
        ],
        [
          'min_profit_factor',
          chalk.cyan(String(quarantine.summary.minProfitFactor)),
        ],
        ['cooldown_days', chalk.cyan(String(quarantine.summary.cooldownDays))],
        ['blocked', chalk.yellow(String(quarantine.summary.blocked))],
        ['events', chalk.yellow(String(quarantine.summary.events.length))],
      ],
    ),
  );

  if (quarantine.summary.events.length) {
    printSection(
      'SYMBOL QUARANTINE EVENTS',
      createTable(
        [
          chalk.gray('SYMBOL'),
          chalk.gray('STARTED'),
          chalk.gray('UNTIL'),
          chalk.gray('LOSSES'),
          chalk.gray('PF'),
        ],
        quarantine.summary.events
          .slice(0, 20)
          .map((event) => [
            chalk.yellow(event.symbol),
            chalk.gray(new Date(event.startedAt).toISOString()),
            chalk.gray(new Date(event.until).toISOString()),
            chalk.red(String(event.approvedLosses)),
            colorizeMetricNumber(event.profitFactor),
          ]),
      ),
    );
  }

  printSection(
    'DUPLICATE SIGNALS',
    createTable(
      [chalk.gray('FIELD'), chalk.gray('VALUE')],
      [
        ['groups', chalk.yellow(String(duplicateSummary.groups))],
        ['rows', chalk.yellow(String(duplicateSummary.rows))],
        ['max_group_size', chalk.yellow(String(duplicateSummary.maxGroupSize))],
      ],
    ),
  );

  if (duplicateSummary.worstGroups.length) {
    printSection(
      'WORST DUPLICATE GROUPS',
      createTable(
        [
          chalk.gray('SYMBOL'),
          chalk.gray('DIR'),
          chalk.gray('TIME'),
          chalk.gray('COUNT'),
          chalk.gray('TOTAL_PROFIT'),
        ],
        duplicateSummary.worstGroups.map((group) => [
          chalk.yellow(group.symbol),
          chalk.gray(group.direction),
          chalk.gray(new Date(group.timestamp).toISOString()),
          chalk.cyan(String(group.count)),
          colorizeProfit(group.totalProfit),
        ]),
      ),
    );
  }

  if (summary.qualityBuckets.length) {
    printSection(
      'QUALITY BREAKDOWN',
      createTable(
        [
          chalk.gray('QUALITY'),
          chalk.gray('COUNT'),
          chalk.gray('WINRATE'),
          chalk.gray('AVG_PROFIT'),
          chalk.gray('TOTAL_PROFIT'),
        ],
        summary.qualityBuckets.map((bucket) => [
          colorizeQuality(bucket.quality),
          chalk.blue(String(bucket.count)),
          colorizeRatio(bucket.profitable / bucket.count),
          colorizeProfit(bucket.totalProfit / bucket.count),
          colorizeProfit(bucket.totalProfit),
        ]),
      ),
    );
  }

  if (errorMessages.length) {
    console.log(chalk.yellow('AI provider errors:'));
    errorMessages.forEach((message) => {
      console.log(chalk.yellow(`- ${message}`));
    });
  }

  process.exit(failed === selectedRows ? 1 : 0);
};
