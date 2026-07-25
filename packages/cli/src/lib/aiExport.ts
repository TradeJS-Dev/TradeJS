import fs from 'fs/promises';
import path from 'path';
import {
  listAiChunkFiles,
  listAiChunkRunIds,
  mergeAiJsonlFiles,
  splitAiMergedDatasetFile,
  toFileToken,
} from '@tradejs/infra/ai';
import {
  buildCompletedBacktestDatasetAttemptKeys,
  isBacktestDatasetRowForCompletedAttempt,
  loadBacktestCheckpointResults,
} from './backtest/checkpoint';

export type AiExportStrategyParams = {
  outDir: string;
  strategyName: string;
  keepChunks: boolean;
  partMonths: number;
  requestedRunId?: string;
  userName: string;
  now?: () => number;
};

export type AiExportStrategyResult = {
  strategyName: string;
  sourceChunkCount: number;
  deleteChunks: boolean;
  partMonths: number;
  partPaths: string[];
  partCount: number;
  splitApplied: boolean;
  runId?: string;
  completedAttemptCount?: number;
};

export type AiExportProgress = {
  strategyName: string;
  current: number;
  total: number;
  status: 'started' | 'completed' | 'skipped' | 'failed';
};

type RunScopedAiChunks = {
  runId: string;
  chunkFiles: string[];
  completedAttemptKeys: Set<string>;
};

const resolveRunScopedAiChunks = async ({
  outDir,
  requestedRunId,
  strategyName,
  userName,
}: Pick<
  AiExportStrategyParams,
  'outDir' | 'requestedRunId' | 'strategyName' | 'userName'
>): Promise<RunScopedAiChunks | null> => {
  const resolvedRunId = String(requestedRunId || '').trim();
  const runIds = resolvedRunId
    ? [resolvedRunId]
    : await listAiChunkRunIds({ strategyName, outDir });
  const runId = runIds.at(-1) ?? '';
  if (!runId) {
    return null;
  }

  const chunkFiles = await listAiChunkFiles({ strategyName, outDir, runId });
  if (!chunkFiles.length) {
    return {
      runId,
      chunkFiles,
      completedAttemptKeys: new Set<string>(),
    };
  }

  const completed = await loadBacktestCheckpointResults({ runId, userName });
  return {
    runId,
    chunkFiles,
    completedAttemptKeys: buildCompletedBacktestDatasetAttemptKeys(completed),
  };
};

export const exportAiStrategy = async (
  params: AiExportStrategyParams,
): Promise<AiExportStrategyResult | null> => {
  const {
    outDir,
    strategyName,
    keepChunks,
    requestedRunId,
    userName,
    now = Date.now,
  } = params;
  const partMonths = Math.max(0, Math.trunc(Number(params.partMonths) || 0));
  const runScopedChunks = await resolveRunScopedAiChunks({
    outDir,
    requestedRunId,
    strategyName,
    userName,
  });
  const chunkFiles = runScopedChunks
    ? runScopedChunks.chunkFiles
    : await listAiChunkFiles({ strategyName, outDir });
  if (!chunkFiles.length) {
    return null;
  }
  if (runScopedChunks && runScopedChunks.completedAttemptKeys.size === 0) {
    throw new Error(
      `No completed checkpoint attempts found for AI export run "${runScopedChunks.runId}"`,
    );
  }

  const completedAttemptCount =
    runScopedChunks?.completedAttemptKeys.size ?? undefined;
  const mergedPath = path.join(
    outDir,
    `ai-dataset-${toFileToken(strategyName)}-merged-${now()}.jsonl`,
  );
  await mergeAiJsonlFiles({
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

  // The checkpoint set can be large and is no longer needed during the
  // streaming split. Release its entries before moving to the next stage.
  runScopedChunks?.completedAttemptKeys.clear();

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

  const shouldDeleteChunks = !keepChunks;
  if (shouldDeleteChunks) {
    for (const filePath of chunkFiles) {
      await fs.rm(filePath, { force: true });
    }
  }

  return {
    strategyName,
    sourceChunkCount: chunkFiles.length,
    deleteChunks: shouldDeleteChunks,
    partMonths,
    partPaths: splitResult.partPaths,
    partCount: splitResult.partCount,
    splitApplied: splitResult.splitApplied,
    runId: runScopedChunks?.runId,
    completedAttemptCount,
  };
};

type ExportAiStrategiesSequentiallyParams = Omit<
  AiExportStrategyParams,
  'strategyName'
> & {
  strategyNames: string[];
  onProgress?: (progress: AiExportProgress) => void;
};

type ExportAiStrategiesSequentiallyDependencies = {
  exportStrategy?: (
    params: AiExportStrategyParams,
  ) => Promise<AiExportStrategyResult | null>;
};

export const exportAiStrategiesSequentially = async (
  params: ExportAiStrategiesSequentiallyParams,
  dependencies: ExportAiStrategiesSequentiallyDependencies = {},
) => {
  const { strategyNames, onProgress, ...strategyParams } = params;
  const runExport = dependencies.exportStrategy ?? exportAiStrategy;
  const results: AiExportStrategyResult[] = [];
  const total = strategyNames.length;

  for (let index = 0; index < strategyNames.length; index += 1) {
    const strategyName = strategyNames[index];
    onProgress?.({
      strategyName,
      current: index,
      total,
      status: 'started',
    });

    try {
      const result = await runExport({
        ...strategyParams,
        strategyName,
      });
      if (result) {
        results.push(result);
      }
      onProgress?.({
        strategyName,
        current: index + 1,
        total,
        status: result ? 'completed' : 'skipped',
      });
    } catch (error) {
      onProgress?.({
        strategyName,
        current: index,
        total,
        status: 'failed',
      });
      throw error;
    }
  }

  return results;
};
