import args from 'args';
import chalk from 'chalk';
import fs from 'fs/promises';
import ProgressBar from 'progress';
import { listAiChunkStrategies } from '@tradejs/infra/ai';
import {
  exportAiStrategiesSequentially,
  type AiExportStrategyResult,
} from '../lib/aiExport';
import {
  ALL_EXPORT_STRATEGIES,
  resolveExportStrategy,
} from './resolveExportStrategy';

args.example(
  'yarn ts-node ./src/scripts/aiExport --strategy trendline',
  'Merge per-worker AI prompt chunks into one dataset JSONL',
);

args.option(['o', 'outDir'], 'Dataset directory', 'data/ai/export');
args.option(['s', 'strategy'], 'Strategy name', '');
args.option(
  ['k', 'keepChunks'],
  'Keep source chunk files after successful merge',
  false,
);
args.option(
  'partMonths',
  'Split merged AI dataset into time windows of N months (0 = disable split)',
  2,
);
args.option(['R', 'runId'], 'Backtest run id to export');
args.option(
  ['u', 'user'],
  'Backtest user for checkpoint-filtered export',
  'root',
);

const flags = args.parse(process.argv);

const printExportResult = (result: AiExportStrategyResult) => {
  console.log(
    chalk.green(
      result.splitApplied
        ? `Merged AI dataset for ${result.strategyName} saved as ${result.partCount} part files`
        : `Merged AI dataset saved: ${result.partPaths[0]}`,
    ),
  );
  result.partPaths.forEach((filePath, index) => {
    console.log(chalk.gray(`part${index + 1}: ${filePath}`));
  });
  console.log(
    chalk.gray(
      `strategy=${result.strategyName}, source_chunks=${result.sourceChunkCount}, deleteChunks=${Boolean(
        result.deleteChunks,
      )}, partMonths=${result.partMonths}, partCount=${result.partCount}${
        result.runId
          ? `, runId=${result.runId}, completedAttempts=${result.completedAttemptCount}`
          : ''
      }`,
    ),
  );
};

export const main = async () => {
  const outDir = String(flags.outDir || 'data/ai/export');

  await fs.mkdir(outDir, { recursive: true });
  const strategyName = await resolveExportStrategy({
    explicitStrategy: String(flags.strategy || ''),
    outDir,
    datasetLabel: 'AI',
    promptLabel: 'Select AI export strategy',
    listStrategies: listAiChunkStrategies,
    includeAllOption: true,
  });
  if (!strategyName) {
    console.log(chalk.yellow(`No AI chunk files found in ${outDir}`));
    return;
  }

  const strategyNames =
    strategyName === ALL_EXPORT_STRATEGIES
      ? await listAiChunkStrategies({ outDir })
      : [strategyName];
  if (!strategyNames.length) {
    console.log(chalk.yellow(`No AI chunk files found in ${outDir}`));
    return;
  }

  const progressBar =
    strategyNames.length > 1
      ? new ProgressBar(':current/:total [:bar] :percent :strategy :status', {
          total: strategyNames.length,
          width: 30,
        })
      : null;
  const results = await exportAiStrategiesSequentially({
    outDir,
    strategyNames,
    keepChunks: Boolean(flags.keepChunks),
    partMonths: Number(flags.partMonths),
    requestedRunId:
      typeof flags.runId === 'string' ? flags.runId.trim() : undefined,
    userName: String(flags.user || 'root'),
    onProgress: progressBar
      ? ({ strategyName: currentStrategy, status }) => {
          const progressStatus = status === 'started' ? 'exporting' : status;
          if (status === 'started' || status === 'failed') {
            progressBar.tick(0, {
              strategy: currentStrategy,
              status: progressStatus,
            });
            if (status === 'failed') {
              progressBar.terminate();
            }
            return;
          }
          progressBar.tick(1, {
            strategy: currentStrategy,
            status: progressStatus,
          });
        }
      : undefined,
  });

  if (!results.length) {
    console.log(
      chalk.yellow(
        strategyNames.length === 1
          ? `No chunk files found for strategy "${strategyNames[0]}" in ${outDir}`
          : `No AI chunk files were exported from ${outDir}`,
      ),
    );
    return;
  }

  results.forEach(printExportResult);
};
