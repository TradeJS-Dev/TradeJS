import args from 'args';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import {
  listAiChunkFiles,
  listAiChunkStrategies,
  mergeAiJsonlFiles,
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

  const shouldDeleteChunks = !Boolean(flags.keepChunks);
  if (shouldDeleteChunks) {
    for (const filePath of chunkFiles) {
      await fs.rm(filePath, { force: true });
    }
  }

  console.log(chalk.green(`Merged AI dataset saved: ${mergedPath}`));
  console.log(
    chalk.gray(
      `strategy=${strategyName}, source_chunks=${chunkFiles.length}, deleteChunks=${Boolean(
        shouldDeleteChunks,
      )}`,
    ),
  );
  process.exit(0);
};
