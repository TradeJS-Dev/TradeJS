import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  RuntimeLineage,
  RuntimeSignalEvaluationRecord,
  RuntimeTradeRecord,
  Signal,
} from '@tradejs/types';
import { runtimeLineageKey } from '../runtimeLineage';
import type { RuntimeLineageScopeRecord } from '../runtimeSignalsStorage';
import {
  activeRuntimeEvidenceStrategies,
  parseRuntimeEvidenceDeploymentSnapshot,
  type RuntimeEvidenceDeploymentSnapshot,
} from '../runtimeEvidenceDeployment';

type JsonRecord = Record<string, unknown>;

export type ReplayRuntimeEvidenceSource = {
  path: string;
  userName: string;
  startTime: number;
  endTime: number;
  trades: RuntimeTradeRecord[];
  signals: Signal[];
  evaluations: RuntimeSignalEvaluationRecord[];
  lineageScopes: RuntimeLineageScopeRecord[];
  deployment: RuntimeEvidenceDeploymentSnapshot;
};

const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const unwrapRows = <T>(value: unknown, field: string): T[] =>
  (Array.isArray(value) ? value : [])
    .map((item) => {
      const row = asRecord(item);
      return (asRecord(row?.[field]) ?? row) as T | null;
    })
    .filter((item): item is T => item != null);

const assertRuntimeRowsMatchDeployment = ({
  label,
  rows,
  deployment,
}: {
  label: string;
  rows: Array<{
    strategy?: string;
    deploymentId?: string;
    accountId?: string;
  }>;
  deployment: RuntimeEvidenceDeploymentSnapshot;
}) => {
  const activeStrategies = new Set(
    activeRuntimeEvidenceStrategies(deployment).map(
      ({ strategyName }) => strategyName,
    ),
  );
  for (const row of rows) {
    if (
      row.deploymentId !== deployment.id ||
      row.accountId !== deployment.accountId ||
      !row.strategy ||
      !activeStrategies.has(row.strategy)
    ) {
      throw new Error(
        `Runtime evidence ${label} row is outside embedded deployment composition`,
      );
    }
  }
};

const readRuntimeEvidenceArtifact = async ({
  filePath,
  projectRoot,
}: {
  filePath: string;
  projectRoot: string;
}) => {
  const resolvedPath = path.resolve(projectRoot, filePath);
  const root = asRecord(
    JSON.parse(await fs.readFile(resolvedPath, 'utf8')) as unknown,
  );
  const runtime = asRecord(root?.runtime) ?? root;
  if (!root || !runtime) {
    throw new Error(`Invalid runtime evidence JSON: ${resolvedPath}`);
  }
  const rootWindow = asRecord(root.window);
  const runtimeWindow = asRecord(runtime.window);
  return {
    resolvedPath,
    root,
    runtime,
    userName: String(root.userName ?? runtime.userName ?? '').trim(),
    startTime:
      asFiniteNumber(rootWindow?.startTime) ??
      asFiniteNumber(runtimeWindow?.startTime),
    endTime:
      asFiniteNumber(rootWindow?.endTime) ??
      asFiniteNumber(runtimeWindow?.endTime),
    deployment: parseRuntimeEvidenceDeploymentSnapshot(root.deployment),
  };
};

export const loadReplayRuntimeEvidenceMetadata = async (params: {
  filePath: string;
  projectRoot: string;
}) => {
  const artifact = await readRuntimeEvidenceArtifact(params);
  return {
    path: artifact.resolvedPath,
    userName: artifact.userName,
    startTime: artifact.startTime,
    endTime: artifact.endTime,
    deployment: artifact.deployment,
  };
};

export const buildRuntimeEvidenceLineageScopes = ({
  signals,
  evaluations,
}: {
  signals: Signal[];
  evaluations: RuntimeSignalEvaluationRecord[];
}): RuntimeLineageScopeRecord[] => {
  const scopes = new Map<string, RuntimeLineageScopeRecord>();
  const add = ({
    strategy,
    symbol,
    deploymentId,
    accountId,
    runtimeConfigId,
    runtimeVersion,
    timestamp,
    lineage,
  }: {
    strategy: string;
    symbol: string;
    deploymentId?: string;
    accountId?: string;
    runtimeConfigId?: string;
    runtimeVersion?: number;
    timestamp: number;
    lineage?: RuntimeLineage;
  }) => {
    if (!lineage || !Number.isFinite(timestamp)) {
      return;
    }

    const key = `${deploymentId ?? 'default'}::${accountId ?? 'default'}::${strategy}::${symbol}::${runtimeLineageKey(lineage)}`;
    const existing = scopes.get(key);
    scopes.set(key, {
      strategy,
      symbol,
      ...(deploymentId ? { deploymentId } : {}),
      ...(accountId ? { accountId } : {}),
      ...(runtimeConfigId ? { runtimeConfigId } : {}),
      ...(runtimeVersion ? { runtimeVersion } : {}),
      lineage,
      firstTimestamp: existing
        ? Math.min(existing.firstTimestamp, timestamp)
        : timestamp,
      lastTimestamp: existing
        ? Math.max(existing.lastTimestamp, timestamp)
        : timestamp,
    });
  };

  for (const signal of signals) {
    add({
      strategy: signal.strategy,
      symbol: signal.symbol,
      deploymentId: signal.deploymentId,
      accountId: signal.accountId,
      runtimeConfigId: signal.runtimeConfigId,
      runtimeVersion: signal.runtimeVersion,
      timestamp: signal.timestamp,
      lineage: signal.runtimeLineage,
    });
  }
  for (const evaluation of evaluations) {
    add({
      strategy: evaluation.strategy,
      symbol: evaluation.symbol,
      deploymentId: evaluation.deploymentId,
      accountId: evaluation.accountId,
      runtimeConfigId: evaluation.runtimeConfigId,
      runtimeVersion: evaluation.runtimeVersion,
      timestamp: evaluation.timestamp,
      lineage: evaluation.runtimeLineage,
    });
  }

  return [...scopes.values()].sort(
    (left, right) =>
      left.strategy.localeCompare(right.strategy) ||
      left.symbol.localeCompare(right.symbol) ||
      left.firstTimestamp - right.firstTimestamp,
  );
};

export const loadReplayRuntimeEvidenceSource = async ({
  filePath,
  projectRoot,
  expectedUserName,
  expectedWindow,
}: {
  filePath: string;
  projectRoot: string;
  expectedUserName: string;
  expectedWindow: { start: number; end: number };
}): Promise<ReplayRuntimeEvidenceSource> => {
  const { resolvedPath, runtime, userName, startTime, endTime, deployment } =
    await readRuntimeEvidenceArtifact({ filePath, projectRoot });

  if (!userName || userName !== expectedUserName) {
    throw new Error(
      `Runtime evidence user mismatch: expected=${expectedUserName}, actual=${userName || 'missing'}`,
    );
  }
  const endTimeMatches =
    endTime === expectedWindow.end || endTime === expectedWindow.end + 1;
  if (startTime !== expectedWindow.start || !endTimeMatches) {
    throw new Error(
      `Runtime evidence window mismatch: expected=${expectedWindow.start}..${expectedWindow.end}, actual=${startTime ?? 'missing'}..${endTime ?? 'missing'}`,
    );
  }

  const trades = unwrapRows<RuntimeTradeRecord>(runtime.trades, 'trade');
  const signals = unwrapRows<Signal>(runtime.signals, 'signal');
  const evaluations = unwrapRows<RuntimeSignalEvaluationRecord>(
    runtime.evaluations,
    'evaluation',
  );
  const storedLineageScopes = unwrapRows<RuntimeLineageScopeRecord>(
    runtime.lineageScopes,
    'lineageScope',
  );
  assertRuntimeRowsMatchDeployment({
    label: 'trade',
    rows: trades,
    deployment,
  });
  assertRuntimeRowsMatchDeployment({
    label: 'signal',
    rows: signals,
    deployment,
  });
  assertRuntimeRowsMatchDeployment({
    label: 'evaluation',
    rows: evaluations,
    deployment,
  });
  assertRuntimeRowsMatchDeployment({
    label: 'lineage scope',
    rows: storedLineageScopes,
    deployment,
  });

  return {
    path: resolvedPath,
    userName,
    startTime,
    endTime,
    trades,
    signals,
    evaluations,
    lineageScopes: storedLineageScopes.length
      ? storedLineageScopes
      : buildRuntimeEvidenceLineageScopes({ signals, evaluations }),
    deployment,
  };
};
