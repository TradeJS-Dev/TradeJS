import { intervalToMs } from '@tradejs/core/data';
import type {
  Interval,
  RuntimeLineage,
  Signal,
  StrategyConfig,
} from '@tradejs/types';
import type {
  RuntimeLineageScopeRecord,
  RuntimeSignalEvaluationRun,
} from '../runtimeSignalsStorage';
import type { ReplayRuntimeLineageRecord } from './historicalSignalsReplayPreparation';

const replayScopeKey = (strategy: string, symbol: string) =>
  `${strategy}::${symbol}`;

const appendReplaySignalEvaluationRun = ({
  runs = [],
  reason,
  timestamp,
  interval,
}: {
  runs?: readonly RuntimeSignalEvaluationRun[];
  reason: string;
  timestamp: number;
  interval: Interval;
}): RuntimeSignalEvaluationRun[] => {
  const stepMs = intervalToMs(interval);
  const last = runs.at(-1);
  if (
    last?.reason === reason &&
    last.stepMs === stepMs &&
    timestamp === last.lastTimestamp + stepMs
  ) {
    return [...runs.slice(0, -1), { ...last, lastTimestamp: timestamp }];
  }

  return [
    ...runs,
    {
      status: 'skip',
      reason,
      firstTimestamp: timestamp,
      lastTimestamp: timestamp,
      stepMs,
    },
  ];
};

export const createHistoricalReplaySkipEvidence = (
  runtimeLineages: ReplayRuntimeLineageRecord[],
  enabled = true,
) => {
  if (!enabled) {
    return {
      record: () => undefined,
      values: (): RuntimeLineageScopeRecord[] => [],
    };
  }
  const lineageByStrategySymbol = new Map(
    runtimeLineages.map((record) => [
      replayScopeKey(record.strategy, record.symbol),
      record,
    ]),
  );
  const scopes = new Map<string, RuntimeLineageScopeRecord>();

  const record = ({
    strategyName,
    symbol,
    strategyConfig,
    runtimeLineage,
    timestamp,
    result,
  }: {
    strategyName: string;
    symbol: string;
    strategyConfig: StrategyConfig;
    runtimeLineage: RuntimeLineage;
    timestamp: number;
    result: Signal | string | undefined;
  }) => {
    const scopeKey = replayScopeKey(strategyName, symbol);
    const lineageRecord = lineageByStrategySymbol.get(scopeKey);
    if (!lineageRecord) return;

    const existing = scopes.get(scopeKey);
    const skipReason =
      typeof result === 'string'
        ? result.trim() || 'NO_SIGNAL'
        : result
          ? null
          : 'NO_SIGNAL';
    scopes.set(scopeKey, {
      strategy: strategyName,
      symbol,
      ...(lineageRecord.deploymentId
        ? { deploymentId: lineageRecord.deploymentId }
        : {}),
      ...(lineageRecord.accountId
        ? { accountId: lineageRecord.accountId }
        : {}),
      strategyRevision: runtimeLineage.strategyRevision,
      lineage: runtimeLineage,
      firstTimestamp: Math.min(
        existing?.firstTimestamp ?? timestamp,
        timestamp,
      ),
      lastTimestamp: Math.max(existing?.lastTimestamp ?? timestamp, timestamp),
      evaluationRuns: skipReason
        ? appendReplaySignalEvaluationRun({
            runs: existing?.evaluationRuns,
            reason: skipReason,
            timestamp,
            interval: (strategyConfig.INTERVAL ?? '15') as Interval,
          })
        : existing?.evaluationRuns,
    });
  };

  const values = () =>
    [...scopes.values()].sort(
      (left, right) =>
        left.strategy.localeCompare(right.strategy) ||
        left.symbol.localeCompare(right.symbol),
    );

  return { record, values };
};
