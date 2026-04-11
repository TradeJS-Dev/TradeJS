import args from 'args';
import chalk from 'chalk';
const ListIt = require('list-it');
import fs from 'fs/promises';
import path from 'path';
import ProgressBar from 'progress';
import { runWithConcurrency } from '@tradejs/core/async';
import { readAiDatasetRows, toFileToken } from '@tradejs/infra/ai';
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
    .filter((name) => name.includes('-merged-') && name.endsWith('.jsonl'))
    .sort()
    .map((name) => path.join(outDir, name));
};

const deriveStrategyNameFromFile = (filePath: string) => {
  const match = path
    .basename(filePath)
    .match(/^ai-dataset-(.+)-merged-\d+\.jsonl$/);
  return match?.[1] ? match[1] : 'unknown';
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

const resolveDatasetFile = async () => {
  const explicitFile = String(flags.file || '').trim();
  if (explicitFile) {
    return path.resolve(explicitFile);
  }

  const outDir = String(flags.outDir || 'data/ai/export');
  const strategyName = String(flags.strategy || '').trim() || undefined;
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
  return mergedFiles[mergedFiles.length - 1];
};

const main = async () => {
  const recent = normalizeInt(flags.recent, 50);
  const skip = normalizeInt(flags.skip, 0);
  const minQuality = normalizeInt(flags.minQuality, 4);
  const localOnly = Boolean(flags.localOnly);
  const model =
    String(flags.model || DEFAULT_AI_MODEL).trim() || DEFAULT_AI_MODEL;
  const parallel = normalizePositiveInt(flags.parallel, AI_CONCURRENCY_LIMIT);
  await ensureAiStrategyPluginsLoaded();
  const filePath = await resolveDatasetFile();
  const { rows, totalRows } = await readAiDatasetRows({
    filePath,
    limitFromEnd: recent,
    skipFromEnd: skip,
  });

  if (!rows.length) {
    console.log(
      chalk.yellow(
        `No AI prompt rows selected in ${filePath} (recent=${recent || 'all'}, skip=${skip})`,
      ),
    );
    process.exit(0);
  }

  const strategyName =
    rows[0]?.strategyName || deriveStrategyNameFromFile(filePath);
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
  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :symbol :status',
    {
      total: rows.length,
      width: 20,
    },
  );

  let failed = 0;
  const errorMessages: string[] = [];
  const evaluations: Array<{
    profit: number;
    profitableTrade: boolean;
    aiApproved: boolean;
    quality: number | null;
    direction: string | null;
    modelCandidate: boolean;
  }> = [];

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
        modelCandidate: deterministic.modelCandidate,
      });

      bar.tick(1, {
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
      bar.tick(1, {
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
  console.log('');
  console.log(chalk.green('AI train finished'));
  console.log(chalk.gray(filePath));
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

main().catch((error) => {
  console.error(chalk.red((error as Error)?.message || String(error)));
  process.exit(1);
});
