import args from 'args';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import ProgressBar from 'progress';
import { readAiDatasetRows, toFileToken } from '@tradejs/infra/ai';
import { runAiPrompt } from '@tradejs/node/ai';
import { AiDatasetRow, SignalAnalysis } from '@tradejs/types';
import { summarizeAiTrainEvaluations } from '../lib/aiTrainMetrics';

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
args.option('minQuality', 'Minimum AI quality required to approve entry', 4);

const flags = args.parse(process.argv);

const percent = (value: number, total: number) =>
  total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0.0%';

const formatRatio = (value: number | null) =>
  value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;

const formatProfit = (value: number | null) =>
  value == null ? 'n/a' : value.toFixed(2);

const normalizeInt = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
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
  const minQuality = normalizeInt(flags.minQuality, 4);
  const filePath = await resolveDatasetFile();
  const { rows, totalRows } = await readAiDatasetRows({
    filePath,
    limitFromEnd: recent,
  });

  if (!rows.length) {
    console.log(chalk.yellow(`No AI prompt rows found in ${filePath}`));
    process.exit(0);
  }

  const strategyName =
    rows[0]?.strategyName || deriveStrategyNameFromFile(filePath);
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
  }> = [];

  for (const row of rows) {
    const profit = Number(row.profit);
    const profitableTrade = isProfitableTrade(row);

    try {
      const analysis = await runAiPrompt({
        systemPrompt: row.systemPrompt,
        humanPrompt: row.humanPrompt,
      });
      const aiApproved = isAiApproval(row, analysis, minQuality);
      const quality = normalizeQuality(analysis);

      const isCorrect = aiApproved === profitableTrade;
      evaluations.push({
        profit,
        profitableTrade,
        aiApproved,
        quality,
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
  }

  const summary = summarizeAiTrainEvaluations(evaluations);
  const evaluated = summary.correct + summary.incorrect;
  console.log('');
  console.log(chalk.green(`AI train finished: ${filePath}`));
  console.log(
    chalk.gray(
      `strategy=${strategyName}, selected=${rows.length}, source_rows=${totalRows}, recent=${recent === 0 ? 'all' : recent}, minQuality=${minQuality}`,
    ),
  );
  console.log(
    chalk.cyan(
      `correct=${summary.correct}, incorrect=${summary.incorrect}, failed=${failed}, accuracy=${percent(
        summary.correct,
        evaluated,
      )}`,
    ),
  );
  console.log(
    chalk.cyan(
      `approved=${summary.approved}, rejected=${summary.rejected}, evaluated=${evaluated}`,
    ),
  );
  console.log(
    chalk.cyan(
      `tp=${summary.truePositive}, fp=${summary.falsePositive}, tn=${summary.trueNegative}, fn=${summary.falseNegative}`,
    ),
  );
  console.log(
    chalk.cyan(
      `profitable=${summary.profitable}, unprofitable=${summary.unprofitable}, flat=${summary.flat}`,
    ),
  );
  console.log(
    chalk.cyan(
      `precision_approved=${formatRatio(summary.precisionApproved)}, recall_winners=${formatRatio(summary.recallWinners)}`,
    ),
  );
  console.log(
    chalk.cyan(
      `avg_profit_approved=${formatProfit(summary.avgProfitApproved)}, expectancy_delta=${formatProfit(summary.expectancyDelta)}`,
    ),
  );
  console.log(
    chalk.cyan(`avg_profit_all=${formatProfit(summary.avgProfitAll)}`),
  );

  if (summary.qualityBuckets.length) {
    console.log(chalk.cyan('quality_breakdown:'));
    summary.qualityBuckets.forEach((bucket) => {
      console.log(
        chalk.cyan(
          `  quality=${bucket.quality == null ? 'n/a' : bucket.quality} count=${bucket.count} approved=${bucket.approved} approval_rate=${formatRatio(
            bucket.approved / bucket.count,
          )} winrate=${formatRatio(
            bucket.profitable / bucket.count,
          )} avg_profit=${formatProfit(bucket.totalProfit / bucket.count)}`,
        ),
      );
    });
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
