import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeLineage } from '@tradejs/types';
import {
  getHyperliquidPerpUniverseSnapshot,
  getHyperliquidWhaleRegistrySnapshot,
} from '@tradejs/node/strategies';

const RUNTIME_CONTEXT_ENV_KEYS = [
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
] as const;

const RUNTIME_CONTEXT_DATA_MODEL = {
  derivativesSourceIntervals: '15m',
  derivativesDerivedIntervals: '1h',
  derivativesHourlyFallback: 'stored-1h',
  derivativesDataModelVersion: 2,
  coinMarketCapAvailabilityModel: 'closed-interval-all-daily',
  coinMarketCapDataModelVersion: 3,
  binanceBreadthUniverseModel: 'fixed-versioned-top5-top10-top30-top50-top100',
  binanceBreadthDataModelVersion: 2,
  hyperliquidWhaleCanonicalInterval: '1m',
  hyperliquidWhaleGateMinNotionalUsd: 50_000,
  hyperliquidWhaleDataModelVersion: 1,
} as const;

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

const resolveRuntimeMaxLossValue = (config: unknown) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return null;
  }

  const strategyConfig = (config as Record<string, unknown>).strategyConfig;
  if (
    !strategyConfig ||
    typeof strategyConfig !== 'object' ||
    Array.isArray(strategyConfig)
  ) {
    return null;
  }

  const maxLossValue = Number(
    (strategyConfig as Record<string, unknown>).MAX_LOSS_VALUE,
  );
  return Number.isFinite(maxLossValue) ? maxLossValue : null;
};

export const fingerprintRuntimeValue = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(normalizeForStableJson(value)))
    .digest('hex')
    .slice(0, 16);

const gitLineageCache = new Map<
  string,
  Pick<RuntimeLineage, 'gitSha' | 'gitDirty'>
>();
const gateFingerprintCache = new Map<string, string>();
const binanceBreadthFingerprintCache = new Map<string, string | null>();
const snapshotFingerprintCache = new Map<string, string | null>();

const resolveGitLineage = (
  projectRoot: string,
): Pick<RuntimeLineage, 'gitSha' | 'gitDirty'> => {
  const cached = gitLineageCache.get(projectRoot);
  if (cached) {
    return cached;
  }

  const envSha = String(process.env.TRADEJS_GIT_SHA ?? '').trim();
  if (envSha && envSha !== 'unknown') {
    const result = {
      gitSha: envSha,
      gitDirty: false,
    } satisfies Pick<RuntimeLineage, 'gitSha' | 'gitDirty'>;
    gitLineageCache.set(projectRoot, result);
    return result;
  }

  try {
    const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const status = execFileSync(
      'git',
      ['status', '--porcelain', '--untracked-files=normal'],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    const result = {
      gitSha: gitSha || null,
      gitDirty: status.length > 0,
    } satisfies Pick<RuntimeLineage, 'gitSha' | 'gitDirty'>;
    gitLineageCache.set(projectRoot, result);
    return result;
  } catch {
    const result = {
      gitSha: null,
      gitDirty: null,
    } satisfies Pick<RuntimeLineage, 'gitSha' | 'gitDirty'>;
    gitLineageCache.set(projectRoot, result);
    return result;
  }
};

const readOptionalFile = async (filePath: string) => {
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
};

const resolveBinanceBreadthFingerprint = async (projectRoot: string) => {
  if (binanceBreadthFingerprintCache.has(projectRoot)) {
    return binanceBreadthFingerprintCache.get(projectRoot) ?? null;
  }
  const content = await readOptionalFile(
    path.join(
      projectRoot,
      'packages/node/src/config/binanceBreadthUniverses.json',
    ),
  );
  let result: string | null = null;
  if (content) {
    try {
      const parsed = JSON.parse(content.toString('utf8')) as {
        fingerprint?: unknown;
      };
      result =
        typeof parsed.fingerprint === 'string' && parsed.fingerprint.trim()
          ? parsed.fingerprint.trim()
          : null;
    } catch {
      result = null;
    }
  }
  binanceBreadthFingerprintCache.set(projectRoot, result);
  return result;
};

const resolveSnapshotFingerprint = async (
  projectRoot: string,
  relativePath: string,
) => {
  const cacheKey = `${projectRoot}:${relativePath}`;
  if (snapshotFingerprintCache.has(cacheKey)) {
    return snapshotFingerprintCache.get(cacheKey) ?? null;
  }
  const content = await readOptionalFile(path.join(projectRoot, relativePath));
  let result: string | null = null;
  if (content) {
    try {
      const parsed = JSON.parse(content.toString('utf8')) as {
        fingerprint?: unknown;
      };
      result =
        typeof parsed.fingerprint === 'string' && parsed.fingerprint.trim()
          ? parsed.fingerprint.trim()
          : null;
    } catch {
      result = null;
    }
  }
  snapshotFingerprintCache.set(cacheKey, result);
  return result;
};

const resolveGateFingerprint = async ({
  projectRoot,
  strategyName,
  gitSha,
}: {
  projectRoot: string;
  strategyName: string;
  gitSha: string | null;
}) => {
  const cacheKey = `${projectRoot}:${strategyName}:${gitSha ?? 'unknown'}`;
  const cached = gateFingerprintCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const relativeCandidates = [
    `packages/strategies/src/${strategyName}/adapters/ai.ts`,
    `packages/strategies/src/${strategyName}/guardrails.ts`,
    `packages/strategies/src/${strategyName}/pockets.ts`,
    `packages/strategies/src/${strategyName}/config.ts`,
    'packages/node/src/ai.ts',
    'packages/core/src/utils/strategyHelpers/signalBuilders.ts',
  ];
  const optionalEntries = await Promise.all(
    relativeCandidates.map(async (relativePath) => {
      const content = await readOptionalFile(
        path.join(projectRoot, relativePath),
      );
      return content == null ? null : { relativePath, content };
    }),
  );
  const sourceEntries: Array<NonNullable<(typeof optionalEntries)[number]>> =
    [];
  for (const entry of optionalEntries) {
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
  const fingerprint = hash.digest('hex').slice(0, 16);
  gateFingerprintCache.set(cacheKey, fingerprint);
  return fingerprint;
};

export const buildRuntimeLineage = async ({
  projectRoot,
  strategyName,
  config,
  runContext,
  env = process.env,
}: {
  projectRoot: string;
  strategyName: string;
  config: unknown;
  runContext?: Record<string, string | number | boolean | null>;
  env?: NodeJS.ProcessEnv;
}): Promise<RuntimeLineage> => {
  const git = resolveGitLineage(projectRoot);
  const hyperliquidPerpUniverseFingerprint =
    typeof getHyperliquidPerpUniverseSnapshot === 'function'
      ? getHyperliquidPerpUniverseSnapshot().fingerprint
      : await resolveSnapshotFingerprint(
          projectRoot,
          'packages/node/src/config/hyperliquidPerpUniverse.json',
        );
  const hyperliquidWhaleRegistryFingerprint =
    typeof getHyperliquidWhaleRegistrySnapshot === 'function'
      ? getHyperliquidWhaleRegistrySnapshot().fingerprint
      : await resolveSnapshotFingerprint(
          projectRoot,
          'packages/node/src/config/hyperliquidWhales.json',
        );
  const context = {
    ...Object.fromEntries(
      RUNTIME_CONTEXT_ENV_KEYS.map((key) => [key, env[key] ?? null]),
    ),
    ...RUNTIME_CONTEXT_DATA_MODEL,
    binanceBreadthUniverseFingerprint:
      await resolveBinanceBreadthFingerprint(projectRoot),
    hyperliquidPerpUniverseFingerprint,
    hyperliquidWhaleRegistryFingerprint,
    ...runContext,
  };

  return {
    schemaVersion: 1,
    ...git,
    gateFingerprint: await resolveGateFingerprint({
      projectRoot,
      strategyName,
      gitSha: git.gitSha,
    }),
    configFingerprint: fingerprintRuntimeValue(config),
    contextFingerprint: fingerprintRuntimeValue(context),
    maxLossValue: resolveRuntimeMaxLossValue(config),
  };
};

export const runtimeLineageKey = (lineage: RuntimeLineage) =>
  [
    lineage.schemaVersion,
    lineage.gitSha ?? 'unknown',
    lineage.gitDirty == null ? 'unknown' : lineage.gitDirty ? 'dirty' : 'clean',
    lineage.gateFingerprint,
    lineage.configFingerprint,
    lineage.contextFingerprint,
  ].join(':');

export const runtimeLineagesMatch = (
  left: RuntimeLineage | null | undefined,
  right: RuntimeLineage | null | undefined,
) =>
  left != null &&
  right != null &&
  runtimeLineageKey(left) === runtimeLineageKey(right);

export const resetRuntimeLineageCachesForTests = () => {
  gitLineageCache.clear();
  gateFingerprintCache.clear();
  binanceBreadthFingerprintCache.clear();
  snapshotFingerprintCache.clear();
};
