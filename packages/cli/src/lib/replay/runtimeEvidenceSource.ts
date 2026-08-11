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
    runtimeConfigId,
    timestamp,
    lineage,
  }: {
    strategy: string;
    symbol: string;
    runtimeConfigId?: string;
    timestamp: number;
    lineage?: RuntimeLineage;
  }) => {
    if (!lineage || !Number.isFinite(timestamp)) {
      return;
    }

    const key = `${strategy}::${symbol}::${runtimeLineageKey(lineage)}`;
    const existing = scopes.get(key);
    scopes.set(key, {
      strategy,
      symbol,
      ...(runtimeConfigId ? { runtimeConfigId } : {}),
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
      runtimeConfigId: signal.runtimeConfigId,
      timestamp: signal.timestamp,
      lineage: signal.runtimeLineage,
    });
  }
  for (const evaluation of evaluations) {
    add({
      strategy: evaluation.strategy,
      symbol: evaluation.symbol,
      runtimeConfigId: evaluation.runtimeConfigId,
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
  const startTime =
    asFiniteNumber(rootWindow?.startTime) ??
    asFiniteNumber(runtimeWindow?.startTime);
  const endTime =
    asFiniteNumber(rootWindow?.endTime) ??
    asFiniteNumber(runtimeWindow?.endTime);
  const userName = String(root.userName ?? runtime.userName ?? '').trim();

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

  return {
    path: resolvedPath,
    userName,
    startTime,
    endTime,
    trades,
    signals,
    evaluations,
    lineageScopes: buildRuntimeEvidenceLineageScopes({
      signals,
      evaluations,
    }),
  };
};
