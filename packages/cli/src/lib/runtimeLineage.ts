import { createHash } from 'node:crypto';
import type { RuntimeLineage } from '@tradejs/types';

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

type BuildRuntimeLineageParams = {
  strategyRevision: string;
  deploymentCompositionId: string;
  strategyPackageVersion: string;
  strategyDependencyVersions: Record<string, string>;
  runtimePackageVersion: string;
  config: unknown;
};

export const buildRuntimeLineage = async ({
  strategyRevision,
  deploymentCompositionId,
  strategyPackageVersion,
  strategyDependencyVersions,
  runtimePackageVersion,
  config,
}: BuildRuntimeLineageParams): Promise<RuntimeLineage> => {
  if (!/^sr1:[a-f0-9]{16}$/.test(strategyRevision)) {
    throw new Error(`Invalid strategy revision: ${strategyRevision}`);
  }
  if (!/^dc1:[a-f0-9]{16}$/.test(deploymentCompositionId)) {
    throw new Error(
      `Invalid deployment composition id: ${deploymentCompositionId}`,
    );
  }
  if (!strategyPackageVersion.trim() || !runtimePackageVersion.trim()) {
    throw new Error('Invalid revision package versions');
  }
  if (
    Object.keys(strategyDependencyVersions).length === 0 ||
    Object.entries(strategyDependencyVersions).some(
      ([name, version]) =>
        !name.startsWith('@tradejs/') ||
        typeof version !== 'string' ||
        !version.trim(),
    )
  ) {
    throw new Error('Invalid strategy dependency versions');
  }
  return {
    schemaVersion: 3,
    strategyRevision,
    deploymentCompositionId,
    strategyPackageVersion,
    strategyDependencyVersions,
    runtimePackageVersion,
    maxLossValue: resolveRuntimeMaxLossValue(config),
  };
};

export const runtimeLineageKey = (lineage: RuntimeLineage) =>
  [
    'v3',
    lineage.deploymentCompositionId,
    lineage.strategyRevision,
    lineage.strategyPackageVersion,
    `deps:${fingerprintRuntimeValue(lineage.strategyDependencyVersions).slice(0, 16)}`,
    lineage.runtimePackageVersion,
  ].join(':');

export const runtimeLineagesMatch = (
  left: RuntimeLineage | null | undefined,
  right: RuntimeLineage | null | undefined,
) =>
  left != null &&
  right != null &&
  runtimeLineageKey(left) === runtimeLineageKey(right);

export const runtimeLineagesComparable = (
  left: RuntimeLineage | null | undefined,
  right: RuntimeLineage | null | undefined,
) =>
  runtimeLineagesMatch(left, right) &&
  typeof left?.maxLossValue === 'number' &&
  Number.isFinite(left.maxLossValue) &&
  typeof right?.maxLossValue === 'number' &&
  Number.isFinite(right.maxLossValue) &&
  left.maxLossValue === right.maxLossValue;
