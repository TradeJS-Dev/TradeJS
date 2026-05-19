import args from 'args';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import {
  listMlChunkStrategies,
  mergeJsonlFiles,
  toFileToken,
} from '@tradejs/infra/ml';
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

const flags = args.parse(process.argv);

const listChunkFiles = async (outDir: string, strategyName: string) => {
  const prefix = `ml-dataset-${toFileToken(strategyName)}-chunk-`;
  const entries = await fs.readdir(outDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.jsonl'))
    .map((name) => path.join(outDir, name))
    .sort();
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

  const chunkFiles = await listChunkFiles(outDir, strategyName);
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
    `ml-dataset-${toFileToken(strategyName)}-merged-${Date.now()}.jsonl`,
  );
  await mergeJsonlFiles({
    filePaths: chunkFiles,
    outPath: mergedPath,
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
      )}`,
    ),
  );
  process.exit(0);
};
