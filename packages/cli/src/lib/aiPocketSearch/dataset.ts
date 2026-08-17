import fs from 'fs/promises';
import path from 'path';
import {
  countAiDatasetRows,
  streamAiDatasetRows,
  toFileToken,
} from '@tradejs/infra/ai';
import {
  buildAiPayload,
  getDeterministicAiGateContext,
  runAiPromptLocal,
} from '@tradejs/node/ai';
import { ensureStrategyPluginsLoaded } from '@tradejs/node/registry';
import type { AiDatasetRow, Signal, SignalAnalysis } from '@tradejs/types';
import {
  collectAiPocketFeatureSnapshot,
  type AiPocketExcludedFeatureClassification,
  type AiPocketSearchRow,
} from '../aiPocketSearch';
import { extractSignalFromAiDatasetRow } from '../aiTrainDataset';
import type { AiPocketSearchCommandOptions } from './commandOptions';

export type PreparedAiPocketSearchDataset = {
  filePaths: string[];
  totalRows: number;
  selectedRows: number;
  sinceTimestamp: number | null;
  resolvedStrategyName: string;
};

export type AiPocketSearchDatasetProgress = {
  symbol: string;
  status: 'date-skip' | 'ok' | 'error';
};

export type EvaluatedAiPocketSearchDataset = {
  rows: AiPocketSearchRow[];
  resolvedStrategyName: string;
  scanned: number;
  dateSkipped: number;
  failed: number;
  errors: string[];
  excludedFeaturePaths: Map<AiPocketExcludedFeatureClassification, Set<string>>;
};

const normalizeQuality = (analysis: Partial<SignalAnalysis>) => {
  const quality = Number(analysis?.quality);
  return Number.isFinite(quality) ? Math.round(quality) : null;
};

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

const getDeterministicModelCandidate = (signal: Signal | null) => {
  if (!signal) {
    return false;
  }

  const payload = buildAiPayload(signal);
  const gateContext = getDeterministicAiGateContext(payload);
  const structuralHardBlockReasons = Array.isArray(
    gateContext?.structuralHardBlockReasons,
  )
    ? gateContext.structuralHardBlockReasons.filter(
        (reason): reason is string =>
          typeof reason === 'string' && reason.trim().length > 0,
      )
    : [];
  if (structuralHardBlockReasons.length) {
    return false;
  }

  if (typeof gateContext?.approvalAllowedNow === 'boolean') {
    return gateContext.approvalAllowedNow;
  }

  return true;
};

export const prepareAiPocketSearchDataset = async (
  options: AiPocketSearchCommandOptions,
): Promise<PreparedAiPocketSearchDataset> => {
  await ensureStrategyPluginsLoaded();
  const filePaths = await resolveMergedDatasetFiles({
    outDir: options.outDir,
    strategyName: options.strategyName,
    explicitFile: options.explicitFile,
  });
  const { totalRows, selectedRows } = await countAiDatasetRows({
    filePaths,
    limitFromEnd: options.recent,
    skipFromEnd: options.skip,
  });
  const maxSelectedTimestamp =
    options.trailingPeriodMs == null
      ? null
      : await findMaxSelectedTimestamp({
          filePaths,
          recent: options.recent,
          skip: options.skip,
        });
  const sinceTimestamp =
    options.trailingPeriodMs != null && maxSelectedTimestamp != null
      ? maxSelectedTimestamp - options.trailingPeriodMs
      : options.sinceInput;

  return {
    filePaths,
    totalRows,
    selectedRows,
    sinceTimestamp,
    resolvedStrategyName: deriveStrategyNameFromFile(filePaths[0] || ''),
  };
};

export const evaluateAiPocketSearchDataset = async ({
  prepared,
  options,
  onProgress,
}: {
  prepared: PreparedAiPocketSearchDataset;
  options: AiPocketSearchCommandOptions;
  onProgress?: (progress: AiPocketSearchDatasetProgress) => void;
}): Promise<EvaluatedAiPocketSearchDataset> => {
  let resolvedStrategyName = prepared.resolvedStrategyName;
  let scanned = 0;
  let dateSkipped = 0;
  let failed = 0;
  const errors: string[] = [];
  const rows: AiPocketSearchRow[] = [];
  const excludedFeaturePaths = new Map<
    AiPocketExcludedFeatureClassification,
    Set<string>
  >();

  await streamAiDatasetRows({
    filePaths: prepared.filePaths,
    limitFromEnd: options.recent,
    skipFromEnd: options.skip,
    onRow: async (row) => {
      scanned += 1;
      if (
        resolvedStrategyName === 'unknown' &&
        typeof row.strategyName === 'string' &&
        row.strategyName.trim()
      ) {
        resolvedStrategyName = row.strategyName.trim();
      }

      const timestamp = getDatasetRowTimestamp(row);
      if (
        (prepared.sinceTimestamp != null &&
          (timestamp == null || timestamp < prepared.sinceTimestamp)) ||
        (options.untilTimestamp != null &&
          (timestamp == null || timestamp > options.untilTimestamp))
      ) {
        dateSkipped += 1;
        onProgress?.({ symbol: row.symbol, status: 'date-skip' });
        return;
      }

      try {
        const signal = extractSignalFromAiDatasetRow(row);
        const payload = buildAiPayload(signal);
        const gateContext = getDeterministicAiGateContext(payload);
        const analysis = await runAiPromptLocal(signal, { payload });
        const quality = normalizeQuality(analysis);
        const modelDirection =
          typeof analysis.direction === 'string' && analysis.direction.trim()
            ? analysis.direction
            : null;
        const modelDirectionMatches = modelDirection === row.direction;
        const profit = Number(row.profit);
        const featureSnapshot = collectAiPocketFeatureSnapshot({
          payload,
          gateContext,
          includeSymbol: options.includeSymbol,
          includeGateContext: options.includeGateContext,
          featureProfile: options.featureProfile,
          featurePolicy: options.featurePolicy,
          onFeatureExcluded: ({ path: featurePath, classification }) => {
            const paths = excludedFeaturePaths.get(classification) ?? new Set();
            paths.add(featurePath);
            excludedFeaturePaths.set(classification, paths);
          },
        });
        rows.push({
          signalId: row.signalId,
          strategy: row.strategyName,
          symbol: row.symbol,
          direction: row.direction,
          timestamp,
          profit,
          profitableTrade: profit > 0,
          aiApproved: isAiApproval(row, analysis, options.minQuality),
          quality,
          modelDirectionMatches,
          modelCandidate: getDeterministicModelCandidate(signal),
          features: featureSnapshot.features,
          featureCoverage: featureSnapshot.featureCoverage,
        });
        onProgress?.({ symbol: row.symbol, status: 'ok' });
      } catch (error) {
        failed += 1;
        if (errors.length < 5) {
          errors.push(
            `[${row.symbol}/${row.signalId}] ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        onProgress?.({ symbol: row.symbol, status: 'error' });
      }
    },
  });

  return {
    rows,
    resolvedStrategyName,
    scanned,
    dateSkipped,
    failed,
    errors,
    excludedFeaturePaths,
  };
};
