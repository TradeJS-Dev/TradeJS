import args from 'args';
import chalk from 'chalk';
const ListIt = require('list-it');
import fs from 'fs/promises';
import path from 'path';
import ProgressBar from 'progress';
import { runWithConcurrency } from '@tradejs/core/async';
import { readAiDatasetRows, toFileToken } from '@tradejs/infra/ai';
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
import {
  AiDatasetRow,
  Signal,
  SignalAnalysis,
  StrategyChartMetric,
  StrategyChartSnapshot,
  StrategyChartsSnapshotResponse,
} from '@tradejs/types';
import {
  AiTrainEvaluation,
  summarizeAiTrainEvaluations,
  summarizeAiTrainEvaluationsByDirection,
} from '../lib/aiTrainMetrics';

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
  'skip',
  'How many recent trades to skip from the end before selecting replay rows',
  0,
);
args.option(
  ['p', 'parallel'],
  'Concurrent AI requests during replay',
  AI_CONCURRENCY_LIMIT,
);
args.option(
  'model',
  'OpenRouter model id override for this replay run',
  DEFAULT_AI_MODEL,
);
args.option('minQuality', 'Minimum AI quality required to approve entry', 4);
args.option(
  'localOnly',
  'Replay deterministic adapter gate without AI provider calls',
  false,
);
args.option(['U', 'user'], 'Use user config', 'root');
args.option(
  'chart',
  'Save compact AI approval chart data for the strategies UI',
  false,
);
args.option('json', 'Print structured JSON summary', false);

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

const extractSignalFromDatasetRow = (row: AiDatasetRow) => {
  const { payload } = row;

  return {
    ...payload.signal,
    strategy: payload.signal.strategy,
    figures: payload.figures ?? {},
    indicators: payload.indicators ?? {},
    additionalIndicators: payload.additionalIndicators ?? {},
    prices: payload.signal.prices,
  } as Signal;
};

const resolvePromptRunContext = (row: AiDatasetRow) => {
  const signal = extractSignalFromDatasetRow(row);

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
    filePath: string;
    selected: number;
    sourceRows: number;
    recent: number;
    skip: number;
    minQuality: number;
    mode: 'local-deterministic' | 'llm';
    model: string;
    parallel: number;
  };
  outcome: ReturnType<typeof summarizeAiTrainEvaluations>;
  byDirection: ReturnType<typeof summarizeAiTrainEvaluationsByDirection>;
  deterministicFlow: DeterministicGateSummary;
  qualityBreakdown: ReturnType<
    typeof summarizeAiTrainEvaluations
  >['qualityBuckets'];
  errors: {
    failed: number;
    providerErrors: string[];
  };
};

type AiTrainEvaluatedRow = AiTrainEvaluation & {
  row: AiDatasetRow;
  signalId: string;
};

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

const formatPercent = (value: number | null) =>
  value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;

const formatSigned = (value: number | null) =>
  value == null ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;

const formatNumber = (value: number | null) =>
  value == null ? 'n/a' : value.toFixed(2);

const resolveMetricTone = (
  value: number | null,
): StrategyChartMetric['tone'] => {
  if (value == null) {
    return 'default';
  }
  if (value > 0) {
    return 'success';
  }
  if (value < 0) {
    return 'error';
  }
  return 'warning';
};

const buildAiChartMetrics = (params: {
  summary: ReturnType<typeof summarizeAiTrainEvaluations>;
  threshold: number;
}) => {
  const { summary, threshold } = params;
  const metrics: StrategyChartMetric[] = [
    {
      id: 'quality',
      label: 'Quality',
      value: `q${threshold}+`,
    },
    {
      id: 'approved',
      label: 'Approved',
      value: String(summary.approved),
    },
    {
      id: 'accuracy',
      label: 'Accuracy',
      value: formatPercent(
        summary.correct + summary.incorrect > 0
          ? summary.correct / (summary.correct + summary.incorrect)
          : null,
      ),
    },
    {
      id: 'precision',
      label: 'Precision',
      value: formatPercent(summary.precisionApproved),
    },
    {
      id: 'recall',
      label: 'Recall',
      value: formatPercent(summary.recallWinners),
    },
    {
      id: 'pnl',
      label: 'P&L',
      value: formatSigned(summary.avgProfitApprovedPerMonth),
      tone: resolveMetricTone(summary.avgProfitApprovedPerMonth),
    },
    {
      id: 'approvedPerDay',
      label: 'Approved/Day',
      value: formatNumber(summary.avgApprovedTradesPerDay),
    },
    {
      id: 'avgProfit',
      label: 'Avg Profit',
      value: formatSigned(summary.avgProfitApproved),
      tone: resolveMetricTone(summary.avgProfitApproved),
    },
  ];

  return metrics;
};

const buildSimpleEquityCurve = (evaluations: AiTrainEvaluatedRow[]) => {
  if (!evaluations.length) {
    return [] as Array<[number, number]>;
  }

  const sorted = [...evaluations].sort(
    (left, right) =>
      (left.timestamp ?? 0) - (right.timestamp ?? 0) ||
      left.row.symbol.localeCompare(right.row.symbol) ||
      left.signalId.localeCompare(right.signalId),
  );
  let amount = 100;
  const firstTimestamp = sorted[0]?.timestamp ?? Date.now();
  const orderLog: Array<[number, number]> = [[firstTimestamp, amount]];

  for (const evaluation of sorted) {
    amount += evaluation.profit;
    orderLog.push([
      evaluation.timestamp ?? firstTimestamp,
      Number(amount.toFixed(4)),
    ]);
  }

  if (orderLog.length === 1) {
    orderLog.push([firstTimestamp, amount]);
  }

  return orderLog;
};

const buildAiChartSnapshot = (params: {
  evaluatedRows: AiTrainEvaluatedRow[];
  strategyName: string;
  generatedAt: number;
  runLabel: string;
}) => {
  const { evaluatedRows, strategyName, generatedAt, runLabel } = params;
  const variantNames = [
    ...new Set(
      evaluatedRows
        .map((evaluation) => evaluation.row.testName?.trim() || '')
        .filter(Boolean),
    ),
  ].sort();
  const groupByVariant = variantNames.length > 1;
  const groups = groupByVariant
    ? variantNames.map((variantName) => ({
        key: variantName,
        label: variantName,
        rows: evaluatedRows.filter(
          (evaluation) =>
            (evaluation.row.testName?.trim() || '') === variantName,
        ),
      }))
    : [
        {
          key: strategyName,
          label: '',
          rows: evaluatedRows,
        },
      ];

  const cards: StrategyChartSnapshot[] = [];
  for (const threshold of [4, 5]) {
    for (const group of groups) {
      const thresholdEvaluations = group.rows.map((evaluation) => ({
        ...evaluation,
        aiApproved:
          evaluation.direction === evaluation.row.direction &&
          evaluation.quality != null &&
          evaluation.quality >= threshold,
      }));
      const summary = summarizeAiTrainEvaluations(thresholdEvaluations);
      const approvedRows = thresholdEvaluations.filter(
        (evaluation) => evaluation.aiApproved,
      );

      cards.push({
        cardId: `${toFileToken(strategyName)}-${toFileToken(group.key)}-q${threshold}`,
        strategyName,
        title: groupByVariant
          ? `${strategyName} · ${group.label}`
          : `${strategyName} · q${threshold}+`,
        subtitle: groupByVariant ? `q${threshold}+` : runLabel,
        symbols: [
          ...new Set(
            group.rows
              .map((evaluation) => evaluation.row.symbol)
              .filter(Boolean),
          ),
        ].sort(),
        orderLog: buildSimpleEquityCurve(approvedRows),
        stat: null,
        metrics: buildAiChartMetrics({
          summary,
          threshold,
        }),
        tags: groupByVariant
          ? [`q${threshold}+`, group.label]
          : [`q${threshold}+`],
      });
    }
  }

  return {
    mode: 'ai',
    generatedAt,
    runLabel,
    strategies: cards,
  } satisfies StrategyChartsSnapshotResponse;
};

const persistAiChartSnapshot = async (params: {
  strategyName: string;
  evaluatedRows: AiTrainEvaluatedRow[];
  model: string;
  mode: 'local-deterministic' | 'llm';
  userName: string;
}) => {
  const { strategyName, evaluatedRows, model, mode, userName } = params;
  const generatedAt = Date.now();
  const runLabel = `${mode}:${model}`;
  const snapshot = buildAiChartSnapshot({
    evaluatedRows,
    strategyName,
    generatedAt,
    runLabel,
  });

  await setData(redisKeys.strategyCharts(userName, 'ai'), snapshot, {
    expire: 0,
  });

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

export const main = async () => {
  const recent = normalizeInt(flags.recent, 50);
  const skip = normalizeInt(flags.skip, 0);
  const minQuality = normalizeInt(flags.minQuality, 4);
  const localOnly = Boolean(flags.localOnly);
  const saveChart = Boolean(flags.chart);
  const jsonOutput = Boolean(flags.json);
  const userName = String(flags.user || 'root').trim() || 'root';
  const model =
    String(flags.model || DEFAULT_AI_MODEL).trim() || DEFAULT_AI_MODEL;
  const parallel = normalizePositiveInt(flags.parallel, AI_CONCURRENCY_LIMIT);
  await ensureAiStrategyPluginsLoaded();
  const filePaths = await resolveDatasetFiles();
  const { rows, totalRows } = await readAiDatasetRows({
    filePaths,
    limitFromEnd: recent,
    skipFromEnd: skip,
  });

  if (!rows.length) {
    console.log(
      chalk.yellow(
        `No AI prompt rows selected in ${filePaths.join(', ')} (recent=${recent || 'all'}, skip=${skip})`,
      ),
    );
    process.exit(0);
  }

  const strategyName =
    rows[0]?.strategyName || deriveStrategyNameFromFile(filePaths[0] || '');
  const preparedRows = rows.map((row) => {
    const { promptPair, signal } = resolvePromptRunContext(row);
    const payload = buildAiPayload(signal);
    return {
      row,
      promptPair,
      payload,
      signal,
      deterministic: resolveDeterministicGateEvaluation(signal, row.direction),
    };
  });
  const concurrency = Math.max(1, Math.min(parallel, rows.length));
  const bar = jsonOutput
    ? null
    : new ProgressBar(':current/:total [:bar][:percent] :symbol :status', {
        total: rows.length,
        width: 20,
      });

  let failed = 0;
  const errorMessages: string[] = [];
  const evaluations: Array<{
    profit: number;
    profitableTrade: boolean;
    aiApproved: boolean;
    quality: number | null;
    direction: string | null;
    timestamp: number | null;
    modelCandidate: boolean;
  }> = [];
  const evaluatedRows: AiTrainEvaluatedRow[] = [];

  await runWithConcurrency(preparedRows, concurrency, async (preparedRow) => {
    const { row, promptPair, payload, signal, deterministic } = preparedRow;
    const profit = Number(row.profit);
    const profitableTrade = isProfitableTrade(row);

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

      const isCorrect = aiApproved === profitableTrade;
      evaluations.push({
        profit,
        profitableTrade,
        aiApproved,
        quality,
        direction: row.direction,
        timestamp: Number.isFinite(Number(row.timestamp))
          ? Number(row.timestamp)
          : null,
        modelCandidate: deterministic.modelCandidate,
      });
      evaluatedRows.push({
        row,
        signalId: row.signalId,
        profit,
        profitableTrade,
        aiApproved,
        quality,
        direction: row.direction,
        timestamp: Number.isFinite(Number(row.timestamp))
          ? Number(row.timestamp)
          : null,
      });

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
  });

  const summary = summarizeAiTrainEvaluations(evaluations);
  const directionSummaries =
    summarizeAiTrainEvaluationsByDirection(evaluations);
  const deterministicSummary = summarizeDeterministicGateEvaluations(
    preparedRows.map((preparedRow) => preparedRow.deterministic),
    evaluations,
  );
  const evaluated = summary.correct + summary.incorrect;
  const result: AiTrainResult = {
    run: {
      strategy: strategyName,
      filePath: filePaths.join(','),
      selected: rows.length,
      sourceRows: totalRows,
      recent,
      skip,
      minQuality,
      mode: localOnly ? 'local-deterministic' : 'llm',
      model: localOnly ? 'local-deterministic' : model,
      parallel: concurrency,
    },
    outcome: summary,
    byDirection: directionSummaries,
    deterministicFlow: deterministicSummary,
    qualityBreakdown: summary.qualityBuckets,
    errors: {
      failed,
      providerErrors: errorMessages,
    },
  };

  if (saveChart) {
    await persistAiChartSnapshot({
      strategyName,
      evaluatedRows,
      model: localOnly ? 'local-deterministic' : model,
      mode: localOnly ? 'local-deterministic' : 'llm',
      userName,
    });
  }

  if (jsonOutput) {
    console.log(JSON.stringify(result));
    process.exit(failed === rows.length ? 1 : 0);
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
        ['selected', chalk.blue(String(rows.length))],
        ['source_rows', chalk.blue(String(totalRows))],
        ['recent', chalk.blue(recent === 0 ? 'all' : String(recent))],
        ['skip', chalk.blue(String(skip))],
        ['min_quality', chalk.magenta(String(minQuality))],
        [
          'mode',
          localOnly ? chalk.green('local-deterministic') : chalk.yellow('llm'),
        ],
        ['model', chalk.yellow(localOnly ? 'local-deterministic' : model)],
        ['parallel', chalk.magenta(String(concurrency))],
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

  if (directionSummaries.length) {
    printSection(
      'BY DIRECTION',
      createTable(
        [
          chalk.gray('DIR'),
          chalk.gray('EVAL'),
          chalk.gray('ACCURACY'),
          chalk.gray('APPROVED'),
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

  if (summary.qualityBuckets.length) {
    printSection(
      'QUALITY BREAKDOWN',
      createTable(
        [
          chalk.gray('QUALITY'),
          chalk.gray('COUNT'),
          chalk.gray('APPROVED'),
          chalk.gray('APPROVAL_RATE'),
          chalk.gray('WINRATE'),
          chalk.gray('AVG_PROFIT'),
        ],
        summary.qualityBuckets.map((bucket) => [
          colorizeQuality(bucket.quality),
          chalk.blue(String(bucket.count)),
          chalk.cyan(String(bucket.approved)),
          colorizeRatio(bucket.approved / bucket.count),
          colorizeRatio(bucket.profitable / bucket.count),
          colorizeProfit(bucket.totalProfit / bucket.count),
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

  process.exit(failed === rows.length ? 1 : 0);
};
