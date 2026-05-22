import args from 'args';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import {
  listAiChunkFiles,
  listAiChunkStrategies,
  mergeAiJsonlFiles,
  splitAiMergedDatasetFile,
  toFileToken,
} from '@tradejs/infra/ai';
import { resolveExportStrategy } from './resolveExportStrategy';

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

const flags = args.parse(process.argv);

export const main = async () => {
  const outDir = String(flags.outDir || 'data/ai/export');

  await fs.mkdir(outDir, { recursive: true });
  const strategyName = await resolveExportStrategy({
    explicitStrategy: String(flags.strategy || ''),
    outDir,
    datasetLabel: 'AI',
    promptLabel: 'Select AI export strategy',
    listStrategies: listAiChunkStrategies,
  });
  if (!strategyName) {
    console.log(chalk.yellow(`No AI chunk files found in ${outDir}`));
    process.exit(0);
  }

  const chunkFiles = await listAiChunkFiles({
    strategyName,
    outDir,
  });
  if (!chunkFiles.length) {
    console.log(
      chalk.yellow(
        `No chunk files found for strategy "${strategyName}" in ${outDir}`,
      ),
    );
    process.exit(0);
  }

  const mergedPath = path.join(
    outDir,
    `ai-dataset-${toFileToken(strategyName)}-merged-${Date.now()}.jsonl`,
  );
  await mergeAiJsonlFiles({
    filePaths: chunkFiles,
    outPath: mergedPath,
  });
  const partMonths = Math.max(0, Math.trunc(Number(flags.partMonths) || 0));
  const splitResult =
    partMonths > 0
      ? await splitAiMergedDatasetFile({
          filePath: mergedPath,
          monthsPerPart: partMonths,
        })
      : {
          partPaths: [mergedPath],
          partCount: 1,
          splitApplied: false,
        };

  const shouldDeleteChunks = !Boolean(flags.keepChunks);
  if (shouldDeleteChunks) {
    for (const filePath of chunkFiles) {
      await fs.rm(filePath, { force: true });
    }
  }

  console.log(
    chalk.green(
      splitResult.splitApplied
        ? `Merged AI dataset saved as ${splitResult.partCount} part files`
        : `Merged AI dataset saved: ${splitResult.partPaths[0]}`,
    ),
  );
  splitResult.partPaths.forEach((filePath, index) => {
    console.log(chalk.gray(`part${index + 1}: ${filePath}`));
  });
  console.log(
    chalk.gray(
      `strategy=${strategyName}, source_chunks=${chunkFiles.length}, deleteChunks=${Boolean(
        shouldDeleteChunks,
      )}, partMonths=${partMonths}, partCount=${splitResult.partCount}`,
    ),
  );
  process.exit(0);
};
