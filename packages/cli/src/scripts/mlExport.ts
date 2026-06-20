import args from 'args';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import {
  listMlChunkFiles,
  listMlChunkRunIds,
  listMlChunkStrategies,
  mergeJsonlFiles,
  toFileToken,
} from '@tradejs/infra/ml';
import {
  buildCompletedBacktestDatasetAttemptKeys,
  isBacktestDatasetRowForCompletedAttempt,
  loadBacktestCheckpointResults,
} from '../lib/backtest/checkpoint';
import { resolveExportStrategy } from './resolveExportStrategy';

args.example(
  'yarn ts-node ./src/scripts/mlExport --strategy trendline',
  'Merge per-worker ML chunks into one dataset JSONL',
);

args.option(['o', 'outDir'], 'Dataset directory', 'data/ml/export');
args.option(['s', 'strategy'], 'Strategy name', '');
args.option(
  ['k', 'keepChunks'],
  'Keep source chunk files after successful merge',
  false,
);
args.option(['R', 'runId'], 'Backtest run id to export');
args.option(
  ['u', 'user'],
  'Backtest user for checkpoint-filtered export',
  'root',
);

const flags = args.parse(process.argv);

const resolveRunScopedMlChunks = async ({
  outDir,
  strategyName,
}: {
  outDir: string;
  strategyName: string;
}) => {
  const requestedRunId =
    typeof flags.runId === 'string' && flags.runId.trim()
      ? flags.runId.trim()
      : '';
  const runIds = requestedRunId
    ? [requestedRunId]
    : await listMlChunkRunIds({ strategyName, outDir });
  const runId = runIds.at(-1) ?? '';
  if (!runId) {
    return null;
  }

  const chunkFiles = await listMlChunkFiles({ strategyName, outDir, runId });
  if (!chunkFiles.length) {
    return {
      runId,
      chunkFiles,
      completedAttemptKeys: new Set<string>(),
    };
  }

  const userName = String(flags.user || 'root');
  const completed = await loadBacktestCheckpointResults({ runId, userName });
  return {
    runId,
    chunkFiles,
    completedAttemptKeys: buildCompletedBacktestDatasetAttemptKeys(completed),
  };
};

export const main = async () => {
  const outDir = String(flags.outDir || 'data/ml/export');

  await fs.mkdir(outDir, { recursive: true });
  const strategyName = await resolveExportStrategy({
    explicitStrategy: String(flags.strategy || ''),
    outDir,
    datasetLabel: 'ML',
    promptLabel: 'Select ML export strategy',
    listStrategies: listMlChunkStrategies,
  });
  if (!strategyName) {
    console.log(chalk.yellow(`No ML chunk files found in ${outDir}`));
    process.exit(0);
  }

  const runScopedChunks = await resolveRunScopedMlChunks({
    strategyName,
    outDir,
  });
  const chunkFiles = runScopedChunks
    ? runScopedChunks.chunkFiles
    : await listMlChunkFiles({ outDir, strategyName });
  if (!chunkFiles.length) {
    console.log(
      chalk.yellow(
        `No chunk files found for strategy "${strategyName}" in ${outDir}`,
      ),
    );
    process.exit(0);
  }
  if (runScopedChunks && runScopedChunks.completedAttemptKeys.size === 0) {
    throw new Error(
      `No completed checkpoint attempts found for ML export run "${runScopedChunks.runId}"`,
    );
  }

  const mergedPath = path.join(
    outDir,
    `ml-dataset-${toFileToken(strategyName)}-merged-${Date.now()}.jsonl`,
  );
  await mergeJsonlFiles({
    filePaths: chunkFiles,
    outPath: mergedPath,
    shouldIncludeRow: runScopedChunks
      ? (row) =>
          isBacktestDatasetRowForCompletedAttempt(
            row,
            runScopedChunks.completedAttemptKeys,
          )
      : undefined,
  });

  const shouldDeleteChunks = !Boolean(flags.keepChunks);
  if (shouldDeleteChunks) {
    for (const filePath of chunkFiles) {
      await fs.rm(filePath, { force: true });
    }
  }

  console.log(chalk.green(`Merged dataset saved: ${mergedPath}`));
  console.log(
    chalk.gray(
      `strategy=${strategyName}, source_chunks=${chunkFiles.length}, deleteChunks=${Boolean(
        shouldDeleteChunks,
      )}${
        runScopedChunks
          ? `, runId=${runScopedChunks.runId}, completedAttempts=${runScopedChunks.completedAttemptKeys.size}`
          : ''
      }`,
    ),
  );
  process.exit(0);
};
