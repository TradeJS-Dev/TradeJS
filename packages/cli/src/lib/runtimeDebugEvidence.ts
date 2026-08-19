import { getData, getHashJsonField, redisKeys } from '@tradejs/infra/redis';
import type {
  RuntimeSignalEvaluationRecord,
  RuntimeTradeRecord,
  Signal,
  StrategyConfig,
} from '@tradejs/types';
import {
  loadRuntimeClosedTrades,
  loadRuntimeStrategyConfigs,
  loadRuntimeTrades,
} from './runtimeRedis';
import {
  loadRuntimeSignalEvaluationStatsBuckets,
  loadRuntimeSignalEvaluations,
  loadRuntimeLineageScopes,
  loadRuntimeSignals,
  type RuntimeSignalStatsBucketEntry,
} from './runtimeSignalsLoader';
import {
  getRuntimeStorageDayKey,
  getRuntimeStorageDayKeys,
  type RuntimeLineageScopeRecord,
} from './runtimeSignalsStorage';

export const RUNTIME_DEBUG_TIMEZONE = 'Europe/Moscow';
export const RUNTIME_DEBUG_TIMEZONE_LABEL = 'MSK';

export type RuntimeDebugStrategyConfig = {
  key: string;
  strategyName: string;
  strategyConfig: StrategyConfig;
};

export type RuntimeDebugEvidence = {
  dayKeys: string[];
  trades: RuntimeTradeRecord[];
  signals: Signal[];
  evaluations: RuntimeSignalEvaluationRecord[];
  evaluationStatsBuckets: RuntimeSignalStatsBucketEntry[];
  lineageScopes: RuntimeLineageScopeRecord[];
  strategyConfigs: RuntimeDebugStrategyConfig[];
};

export type RuntimeDebugReportAttachment = {
  filename: string;
  content: string;
  caption: string;
  summary: {
    trades: number;
    signals: number;
    evaluations: number;
  };
};

const formatRuntimeDebugDateTime = (timestamp: number) =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: RUNTIME_DEBUG_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));

const getRuntimeDebugDateParts = (timestamp: number) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: RUNTIME_DEBUG_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date(timestamp))
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

const formatRuntimeDebugIsoDayKey = (timestamp: number) => {
  const parts = getRuntimeDebugDateParts(timestamp);

  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const buildRuntimeDebugEvaluationId = ({
  strategy,
  symbol,
  timestamp,
}: {
  strategy: string;
  symbol: string;
  timestamp: number;
}) => `${strategy}:${symbol}:${timestamp}`;

const filterByStrategies = <T extends { strategy: string }>(
  values: T[],
  strategies?: string[],
) => {
  if (!strategies?.length) {
    return values;
  }

  const strategySet = new Set(strategies);
  return values.filter((value) => strategySet.has(value.strategy));
};

export const collectRuntimeDebugEvidence = async ({
  userName,
  startTime,
  endTime,
  strategies,
  deploymentId,
}: {
  userName: string;
  startTime: number;
  endTime: number;
  strategies?: string[];
  deploymentId?: string;
}): Promise<RuntimeDebugEvidence> => {
  const dayKeys = getRuntimeStorageDayKeys(startTime, endTime);
  const dayKeySet = new Set(dayKeys);
  const [
    entryTrades,
    closedTrades,
    signals,
    evaluations,
    evaluationStatsBuckets,
    lineageScopes,
    configs,
  ] = await Promise.all([
    loadRuntimeTrades(userName, { startTime, endTime }),
    loadRuntimeClosedTrades(userName, { startTime, endTime }),
    loadRuntimeSignals(userName, { startTime, endTime }),
    loadRuntimeSignalEvaluations(userName, { startTime, endTime }),
    loadRuntimeSignalEvaluationStatsBuckets(userName),
    loadRuntimeLineageScopes(userName, { startTime, endTime }),
    loadRuntimeStrategyConfigs(userName),
  ]);
  const tradesByOrderId = new Map(
    entryTrades.map((trade) => [trade.orderId, trade]),
  );
  for (const trade of closedTrades) {
    tradesByOrderId.set(trade.orderId, trade);
  }
  const trades = [...tradesByOrderId.values()].sort(
    (left, right) => left.entryTimestamp - right.entryTimestamp,
  );
  const filteredStats = evaluationStatsBuckets.filter(
    (entry) =>
      dayKeySet.has(entry.dayKey) &&
      (!deploymentId || entry.deploymentId === deploymentId) &&
      (!strategies?.length || strategies.includes(entry.strategy)),
  );
  const matchesDeployment = (value: { deploymentId?: string }) =>
    !deploymentId || value.deploymentId === deploymentId;

  return {
    dayKeys,
    trades: filterByStrategies(trades, strategies).filter(matchesDeployment),
    signals: filterByStrategies(signals, strategies).filter(matchesDeployment),
    evaluations: filterByStrategies(evaluations, strategies).filter(
      matchesDeployment,
    ),
    evaluationStatsBuckets: filteredStats,
    lineageScopes: lineageScopes
      .filter(matchesDeployment)
      .filter(
        (scope) => !strategies?.length || strategies.includes(scope.strategy),
      ),
    strategyConfigs: deploymentId
      ? []
      : configs.filter(
          (config) =>
            !strategies?.length || strategies.includes(config.strategyName),
        ),
  };
};

export const buildRuntimeDebugReportPayload = async ({
  userName,
  startTime,
  endTime,
  signals,
  evaluations,
  trades,
  strategyConfigs,
  evaluationStatsBuckets,
  lineageScopes,
}: {
  userName: string;
  startTime: number;
  endTime: number;
  signals: Signal[];
  evaluations: RuntimeSignalEvaluationRecord[];
  trades: RuntimeTradeRecord[];
  strategyConfigs?: RuntimeDebugStrategyConfig[];
  evaluationStatsBuckets?: RuntimeSignalStatsBucketEntry[];
  lineageScopes?: RuntimeLineageScopeRecord[];
}) => {
  const signalById = new Map(
    signals.map((signal) => [signal.signalId, signal]),
  );
  const evaluationById = new Map(
    evaluations.map((evaluation) => [evaluation.evaluationId, evaluation]),
  );
  const evaluationBySignalShape = new Map(
    evaluations.map((evaluation) => [
      buildRuntimeDebugEvaluationId(evaluation),
      evaluation,
    ]),
  );
  const dayKeys = getRuntimeStorageDayKeys(startTime, endTime);

  const debugTrades = await Promise.all(
    trades.map(async (trade) => {
      const signal =
        trade.signalId != null ? signalById.get(trade.signalId) : undefined;
      const evaluationId = buildRuntimeDebugEvaluationId({
        strategy: trade.strategy,
        symbol: trade.symbol,
        timestamp: signal?.timestamp ?? trade.entryTimestamp,
      });
      const knownEvaluation =
        evaluationById.get(evaluationId) ??
        evaluationBySignalShape.get(evaluationId);
      const tradeDayKey = getRuntimeStorageDayKey(trade.entryTimestamp);
      const signalDayKey =
        signal != null
          ? getRuntimeStorageDayKey(signal.timestamp)
          : tradeDayKey;
      const evaluationDayKey =
        knownEvaluation != null
          ? getRuntimeStorageDayKey(knownEvaluation.timestamp)
          : signalDayKey;
      const tradeKey = redisKeys.runtimeTrade(userName, trade.orderId);
      const tradeBucketKey = redisKeys.runtimeTradeBucket(
        userName,
        tradeDayKey,
      );
      const activeTradeKey = redisKeys.runtimeActiveTrade(
        userName,
        trade.symbol,
        trade.deploymentId ?? trade.accountId,
      );
      const signalKey =
        trade.signalId != null
          ? redisKeys.storeSignal(trade.symbol, trade.signalId)
          : null;
      const evaluationBucketKey = redisKeys.runtimeSignalEvaluationBucket(
        userName,
        evaluationDayKey,
        knownEvaluation?.strategy ?? trade.strategy,
      );
      const evaluationField = knownEvaluation?.evaluationId ?? evaluationId;
      const evaluationKey = redisKeys.runtimeSignalEvaluation(
        userName,
        evaluationField,
      );

      const [
        tradeValue,
        activeTradeValue,
        signalValue,
        directEvaluationValue,
        bucketEvaluationValue,
      ] = await Promise.all([
        getData(tradeKey, null),
        getData(activeTradeKey, null),
        signalKey ? getData(signalKey, null) : Promise.resolve(null),
        getData(evaluationKey, null),
        knownEvaluation
          ? Promise.resolve(knownEvaluation)
          : getHashJsonField<RuntimeSignalEvaluationRecord>(
              evaluationBucketKey,
              evaluationField,
              null,
            ),
      ]);
      const evaluationValue =
        directEvaluationValue ??
        bucketEvaluationValue ??
        knownEvaluation ??
        null;

      return {
        redisDebug: {
          trade: tradeKey,
          tradeBucket: {
            key: tradeBucketKey,
            field: trade.orderId,
          },
          activeTrade: activeTradeKey,
          signal: signalKey,
          evaluation: {
            key: evaluationBucketKey,
            field: evaluationField,
            directKey: evaluationKey,
          },
        },
        trade,
        redisValues: {
          trade: tradeValue,
          tradeBucket: trade,
          activeTrade: activeTradeValue,
          signal: signalValue ?? signal ?? null,
          evaluation: evaluationValue ?? knownEvaluation ?? null,
        },
      };
    }),
  );
  const linkedEvaluations = new Map<string, RuntimeSignalEvaluationRecord>();
  for (const trade of debugTrades) {
    const evaluation = trade.redisValues.evaluation;
    if (
      evaluation &&
      typeof evaluation === 'object' &&
      'evaluationId' in evaluation &&
      typeof evaluation.evaluationId === 'string'
    ) {
      linkedEvaluations.set(
        evaluation.evaluationId,
        evaluation as RuntimeSignalEvaluationRecord,
      );
    }
  }
  const reportEvaluations =
    evaluations.length > 0 ? evaluations : [...linkedEvaluations.values()];

  return {
    reportType: 'runtime-daily-debug',
    generatedAt: Date.now(),
    generatedAtMsk: formatRuntimeDebugDateTime(Date.now()),
    userName,
    window: {
      startTime,
      endTime,
      startMsk: formatRuntimeDebugDateTime(startTime),
      endMsk: formatRuntimeDebugDateTime(endTime),
      dayKeys,
    },
    redisPrefixes: {
      runtimeTrades: redisKeys.runtimeTrades(userName),
      runtimeTradeBuckets: redisKeys.runtimeTradeBuckets(userName),
      runtimeActiveTrades: redisKeys.runtimeActiveTrades(userName),
      runtimeSignals: redisKeys.runtimeSignalBuckets(userName),
      runtimeSignalEvaluations:
        redisKeys.runtimeSignalEvaluationBuckets(userName),
      runtimeSignalEvaluationStats:
        redisKeys.runtimeSignalEvaluationStatsBuckets(userName),
    },
    counts: {
      trades: trades.length,
      signals: signals.length,
      evaluations: reportEvaluations.length,
      evaluationStatsBuckets: evaluationStatsBuckets?.length ?? 0,
      lineageScopes: lineageScopes?.length ?? 0,
      strategyConfigs: strategyConfigs?.length ?? 0,
    },
    trades: debugTrades,
    signals: signals.map((signal) => ({
      redisKey: redisKeys.storeSignal(signal.symbol, signal.signalId),
      signal,
    })),
    evaluations: reportEvaluations.map((evaluation) => ({
      redisDebug: {
        key: redisKeys.runtimeSignalEvaluationBucket(
          userName,
          getRuntimeStorageDayKey(evaluation.timestamp),
          evaluation.strategy,
        ),
        field: evaluation.evaluationId,
        directKey: redisKeys.runtimeSignalEvaluation(
          userName,
          evaluation.evaluationId,
        ),
      },
      evaluation,
    })),
    evaluationStatsBuckets: evaluationStatsBuckets ?? [],
    lineageScopes: lineageScopes ?? [],
    strategyConfigs: strategyConfigs ?? [],
  };
};

export const buildRuntimeEvidenceReportPayload = ({
  userName,
  startTime,
  endTime,
  signals,
  evaluations,
  trades,
  strategyConfigs,
  evaluationStatsBuckets,
  lineageScopes,
}: {
  userName: string;
  startTime: number;
  endTime: number;
  signals: Signal[];
  evaluations: RuntimeSignalEvaluationRecord[];
  trades: RuntimeTradeRecord[];
  strategyConfigs?: RuntimeDebugStrategyConfig[];
  evaluationStatsBuckets?: RuntimeSignalStatsBucketEntry[];
  lineageScopes?: RuntimeLineageScopeRecord[];
}) => ({
  reportType: 'runtime-daily-evidence' as const,
  generatedAt: Date.now(),
  userName,
  window: {
    startTime,
    endTime,
    startMsk: formatRuntimeDebugDateTime(startTime),
    endMsk: formatRuntimeDebugDateTime(endTime),
    dayKeys: getRuntimeStorageDayKeys(startTime, endTime),
  },
  counts: {
    trades: trades.length,
    signals: signals.length,
    evaluations: evaluations.length,
    evaluationStatsBuckets: evaluationStatsBuckets?.length ?? 0,
    lineageScopes: lineageScopes?.length ?? 0,
    strategyConfigs: strategyConfigs?.length ?? 0,
  },
  trades: trades.map((trade) => ({ trade })),
  signals: signals.map((signal) => ({ signal })),
  evaluations: evaluations.map((evaluation) => ({ evaluation })),
  evaluationStatsBuckets: evaluationStatsBuckets ?? [],
  lineageScopes: lineageScopes ?? [],
  strategyConfigs: strategyConfigs ?? [],
});

export const buildRuntimeDebugReportAttachment = async (
  params: Parameters<typeof buildRuntimeDebugReportPayload>[0],
): Promise<RuntimeDebugReportAttachment> => {
  const payload = await buildRuntimeDebugReportPayload(params);
  const dayKey = formatRuntimeDebugIsoDayKey(params.endTime);

  return {
    filename: `tradejs-runtime-debug-${params.userName}-${dayKey}.json`,
    content: JSON.stringify(payload, null, 2),
    caption: `Runtime debug ${dayKey} ${RUNTIME_DEBUG_TIMEZONE_LABEL}`,
    summary: {
      trades: payload.counts.trades,
      signals: payload.counts.signals,
      evaluations: payload.counts.evaluations,
    },
  };
};
