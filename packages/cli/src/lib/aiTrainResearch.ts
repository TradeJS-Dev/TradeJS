import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AiTrainEvaluation,
  AiTrainSummary,
  summarizeAiTrainEvaluations,
} from './aiTrainMetrics';
import {
  getHyperliquidPerpUniverseSnapshot,
  getHyperliquidWhaleRegistrySnapshot,
} from '@tradejs/node/strategies';
import { HYPERLIQUID_WHALE_DATA_MODEL_VERSION } from '@tradejs/types';

const DAY_MS = 24 * 60 * 60 * 1000;

const RESEARCH_CONTEXT_ENV_KEYS = [
  'AI_MODE',
  'MIN_AI_QUALITY',
  'INTERVAL',
  'DERIVATIVES_CONTEXT_ENABLED',
  'DERIVATIVES_CONTEXT_TARGET_ENABLED',
  'DERIVATIVES_CONTEXT_LOOKBACK_HOURS',
  'DERIVATIVES_CONTEXT_EXTRA_REFERENCE_SYMBOLS',
  'DERIVATIVES_CONTEXT_EXCHANGE_PRIORITY',
  'COINMARKETCAP_CONTEXT_ENABLED',
  'COINMARKETCAP_CONTEXT_MAX_AGE_MS',
  'COINMARKETCAP_CONTEXT_EXCHANGE_LIQUIDITY_ENABLED',
  'COINMARKETCAP_CONTEXT_EXCHANGE_SLUGS',
  'COINMARKETCAP_CONTEXT_FEAR_GREED_ENABLED',
  'COINMARKETCAP_CONTEXT_HISTORICAL_ACCESS_MONTHS',
  'COINMARKETCAP_CONTEXT_BACKFILL_ENABLED',
  'COINMARKETCAP_CONTEXT_BACKFILL_MAX_DAYS',
  'COINMARKETCAP_CONTEXT_BACKFILL_WARMUP_DAYS',
  'HYPERLIQUID_WHALE_CONTEXT_ENABLED',
  'HYPERLIQUID_WHALE_BACKFILL_ENABLED',
  'HYPERLIQUID_WHALE_MIN_COVERAGE_PCT',
  'HYPERLIQUID_WHALE_CONCURRENCY',
  'HYPERLIQUID_WHALE_RATE_LIMIT_WEIGHT',
] as const;

const DERIVATIVES_CONTEXT_DATA_MODEL = {
  derivativesSourceIntervals: '15m',
  derivativesDerivedIntervals: '1h',
  derivativesHourlyFallback: 'stored-1h',
  derivativesDataModelVersion: 2,
  hyperliquidWhaleCanonicalInterval: '1m',
  hyperliquidWhaleGateMinNotionalUsd: 50_000,
  hyperliquidWhaleMinCoveragePct: 0.8,
  hyperliquidWhaleDataModelVersion: HYPERLIQUID_WHALE_DATA_MODEL_VERSION,
} as const;

type ResearchEvaluation = AiTrainEvaluation & {
  rejectReason?: string | null;
};

export type AiTrainCoverageSummary = {
  timestamped: number;
  missingTimestamps: number;
  minTimestamp: number | null;
  maxTimestamp: number | null;
  spanDays: number | null;
  dataLagDays: number | null;
};

export type AiTrainTerminalWindowSummary = {
  label: string;
  days: number;
  complete: boolean;
  since: number;
  until: number;
  coverageDays: number;
  selected: number;
  approvedPerCalendarDay: number;
  outcome: AiTrainSummary;
  topRejectReasons: Array<{ reason: string; count: number }>;
};

export type AiTrainLineage = {
  gitSha: string | null;
  gitDirty: boolean | null;
  gateFingerprint: string;
  gateFingerprintFiles: string[];
  configIdsFingerprint: string;
  configIds: string[];
  contextFingerprint: string;
  context: Record<string, string | number | boolean | null>;
};

export const writeAiTrainResearchSnapshot = async ({
  outputPath,
  result,
}: {
  outputPath: string;
  result: unknown;
}) => {
  const resolvedPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(
    resolvedPath,
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
  return resolvedPath;
};

const normalizeForStableJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeForStableJson);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeForStableJson(entry)]),
    );
  }
  return value;
};

export const fingerprintResearchValue = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(normalizeForStableJson(value)))
    .digest('hex')
    .slice(0, 16);

const getTimestampRange = (evaluations: AiTrainEvaluation[]) => {
  let minTimestamp: number | null = null;
  let maxTimestamp: number | null = null;

  for (const evaluation of evaluations) {
    const timestamp = evaluation.timestamp;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
      continue;
    }
    minTimestamp =
      minTimestamp == null ? timestamp : Math.min(minTimestamp, timestamp);
    maxTimestamp =
      maxTimestamp == null ? timestamp : Math.max(maxTimestamp, timestamp);
  }

  return { minTimestamp, maxTimestamp };
};

export const summarizeAiTrainCoverage = (
  evaluations: AiTrainEvaluation[],
  now = Date.now(),
): AiTrainCoverageSummary => {
  const { minTimestamp, maxTimestamp } = getTimestampRange(evaluations);
  const timestamped = evaluations.filter(
    (evaluation) =>
      typeof evaluation.timestamp === 'number' &&
      Number.isFinite(evaluation.timestamp),
  ).length;

  return {
    timestamped,
    missingTimestamps: evaluations.length - timestamped,
    minTimestamp,
    maxTimestamp,
    spanDays:
      minTimestamp == null || maxTimestamp == null
        ? null
        : (maxTimestamp - minTimestamp) / DAY_MS,
    dataLagDays:
      maxTimestamp == null ? null : Math.max(0, (now - maxTimestamp) / DAY_MS),
  };
};

export const summarizeAiTrainRejectReasons = (
  evaluations: ResearchEvaluation[],
  limit = 5,
) => {
  const counts = new Map<string, number>();

  for (const evaluation of evaluations) {
    if (evaluation.aiApproved || !evaluation.rejectReason) {
      continue;
    }
    for (const reason of evaluation.rejectReason
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .slice(0, limit)
    .map(([reason, count]) => ({ reason, count }));
};

export const summarizeAiTrainTerminalWindows = (
  evaluations: ResearchEvaluation[],
  windowDays: number[],
): AiTrainTerminalWindowSummary[] => {
  const { minTimestamp, maxTimestamp } = getTimestampRange(evaluations);
  if (minTimestamp == null || maxTimestamp == null) {
    return [];
  }

  return windowDays.map((days) => {
    const requestedSince = maxTimestamp - days * DAY_MS;
    const since = Math.max(minTimestamp, requestedSince);
    const selected = evaluations.filter(
      (evaluation) =>
        typeof evaluation.timestamp === 'number' &&
        Number.isFinite(evaluation.timestamp) &&
        evaluation.timestamp >= requestedSince &&
        evaluation.timestamp <= maxTimestamp,
    );
    const coverageDays = Math.max(1, (maxTimestamp - since) / DAY_MS);
    const outcome = summarizeAiTrainEvaluations(selected);

    return {
      label: `last${days}d`,
      days,
      complete: minTimestamp <= requestedSince,
      since,
      until: maxTimestamp,
      coverageDays,
      selected: selected.length,
      approvedPerCalendarDay: outcome.approved / coverageDays,
      outcome,
      topRejectReasons: summarizeAiTrainRejectReasons(selected),
    };
  });
};

const readOptionalFile = async (filePath: string) => {
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
};

const getGitLineage = (projectRoot: string) => {
  try {
    const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const status = execFileSync(
      'git',
      ['status', '--porcelain', '--untracked-files=no'],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    return { gitSha: gitSha || null, gitDirty: status.length > 0 };
  } catch {
    return { gitSha: null, gitDirty: null };
  }
};

const resolveGateFingerprint = async (
  projectRoot: string,
  strategyName: string,
  gitSha: string | null,
) => {
  const relativeCandidates = [
    `packages/strategies/src/${strategyName}/adapters/ai.ts`,
    `packages/strategies/src/${strategyName}/guardrails.ts`,
    `packages/strategies/src/${strategyName}/pockets.ts`,
    `packages/strategies/src/${strategyName}/config.ts`,
    'packages/strategies/src/shared/aiGateObservation.ts',
    'packages/strategies/src/shared/aiGateRebuild.ts',
    'packages/strategies/src/index.ts',
    'packages/node/src/ai.ts',
  ];
  const optionalSourceEntries = await Promise.all(
    relativeCandidates.map(async (relativePath) => {
      const content = await readOptionalFile(
        path.join(projectRoot, relativePath),
      );
      return content == null ? null : { relativePath, content };
    }),
  );
  const sourceEntries: Array<{
    relativePath: string;
    content: Uint8Array;
  }> = [];
  for (const entry of optionalSourceEntries) {
    if (entry != null) {
      sourceEntries.push(entry);
    }
  }

  const hash = createHash('sha256');
  hash.update(strategyName);
  if (sourceEntries.length) {
    for (const entry of sourceEntries) {
      hash.update(entry.relativePath);
      hash.update(entry.content);
    }
  } else {
    hash.update(gitSha ?? 'unknown-git-sha');
  }

  return {
    gateFingerprint: hash.digest('hex').slice(0, 16),
    gateFingerprintFiles: sourceEntries.map((entry) => entry.relativePath),
  };
};

export const buildAiTrainLineage = async ({
  projectRoot,
  strategyName,
  configIds,
  runContext,
  env = process.env,
}: {
  projectRoot: string;
  strategyName: string;
  configIds: string[];
  runContext: Record<string, string | number | boolean | null>;
  env?: NodeJS.ProcessEnv;
}): Promise<AiTrainLineage> => {
  const { gitSha, gitDirty } = getGitLineage(projectRoot);
  const gate = await resolveGateFingerprint(projectRoot, strategyName, gitSha);
  const normalizedConfigIds = [...new Set(configIds.filter(Boolean))].sort();
  const hyperliquidPerpUniverseFingerprint =
    typeof getHyperliquidPerpUniverseSnapshot === 'function'
      ? getHyperliquidPerpUniverseSnapshot().fingerprint
      : null;
  const hyperliquidWhaleRegistryFingerprint =
    typeof getHyperliquidWhaleRegistrySnapshot === 'function'
      ? getHyperliquidWhaleRegistrySnapshot().fingerprint
      : null;
  const context = {
    ...Object.fromEntries(
      RESEARCH_CONTEXT_ENV_KEYS.map((key) => [key, env[key] ?? null]),
    ),
    ...runContext,
    ...DERIVATIVES_CONTEXT_DATA_MODEL,
    hyperliquidPerpUniverseFingerprint,
    hyperliquidWhaleRegistryFingerprint,
  };

  return {
    gitSha,
    gitDirty,
    ...gate,
    configIdsFingerprint: fingerprintResearchValue(normalizedConfigIds),
    configIds: normalizedConfigIds,
    contextFingerprint: fingerprintResearchValue(context),
    context,
  };
};
