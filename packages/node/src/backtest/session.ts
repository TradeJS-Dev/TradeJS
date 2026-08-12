import {
  BACKTEST_WARNING_CODES,
  type AiDatasetRow,
  type BacktestDetectorOptimizedStrategy,
  type BacktestWarningCounts,
  type Candle,
  type Connector,
  type Interval,
  type KlineChartItem,
  type RuntimeSignalEvaluationRecord,
  type Signal,
  type StrategyCreator,
  type Test,
  type TestingBoxResult,
} from '@tradejs/types';
import { appendAiDatasetRow } from '@tradejs/infra/ai';
import { appendCoreResearchTraceEvent } from '@tradejs/infra/coreResearch';
import {
  appendMlDatasetRow,
  buildMlTrainingRow,
  trimMlTrainingRowWindows,
} from '@tradejs/infra/ml';
import { buildAiPayload } from '../ai';
import { resolveExecutionCosts } from '../executionCosts';
import { buildMlPayload } from '../mlPayload';
import { enrichSignalWithMarketContextStages } from '../strategyHelpers/marketContextStages';
import { createTestConnector } from '../testConnector';
import type { BacktestSessionMonitor, PreparedBacktestData } from './contracts';
import { resolveCoreResearchSetupIdentity } from './researchTrace';

type PendingAiDatasetRow = Omit<AiDatasetRow, 'payload' | 'profit'> & {
  signal: Signal;
};

type BacktestDelayedEntryStrategy = BacktestDetectorOptimizedStrategy & {
  __tradejsFlushBacktestDelayedEntry?: (
    candle: Candle,
    btcCandle: Candle,
    ethCandle?: Candle,
  ) => Promise<string | Signal | undefined>;
};

const createWarningCounts = (): BacktestWarningCounts => ({
  [BACKTEST_WARNING_CODES.TAKE_PROFIT_CROSSED_BEFORE_ENTRY]: 0,
});

const recordSignalWarning = (
  warningCounts: BacktestWarningCounts,
  signal: string | Signal | undefined,
) => {
  if (
    signal &&
    typeof signal !== 'string' &&
    signal.orderStatus === 'failed' &&
    signal.orderFailureReason ===
      BACKTEST_WARNING_CODES.TAKE_PROFIT_CROSSED_BEFORE_ENTRY
  ) {
    const code = BACKTEST_WARNING_CODES.TAKE_PROFIT_CROSSED_BEFORE_ENTRY;
    warningCounts[code] = (warningCounts[code] ?? 0) + 1;
  }
};

const buildDatasetMetadata = (test: Test): Record<string, string> =>
  test.backtestRunId && test.backtestTestKey && test.chunkId
    ? {
        backtestRunId: test.backtestRunId,
        backtestTestKey: test.backtestTestKey,
        backtestChunkId: test.chunkId,
      }
    : {};

const cloneSignal = (signal: Signal): Signal => {
  const cloneValue = <T>(value: T): T => {
    if (value == null) return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value)) as T;
  };

  return {
    ...signal,
    figures: cloneValue(signal.figures),
    indicators: cloneValue(signal.indicators),
    additionalIndicators: cloneValue(signal.additionalIndicators),
  };
};

const buildReplayEvaluation = ({
  signal,
  test,
  interval,
  candle,
}: {
  signal: Signal | string | null | undefined;
  test: Test;
  interval: Interval;
  candle: Candle;
}): RuntimeSignalEvaluationRecord => {
  if (!signal || typeof signal === 'string') {
    return {
      evaluationId: `${test.testId}:${test.strategyName}:${test.symbol}:${candle.timestamp}`,
      userName: test.userName,
      strategy: test.strategyName,
      symbol: test.symbol,
      interval,
      timestamp: candle.timestamp,
      evaluatedAt: candle.timestamp,
      status: 'skip',
      reason:
        typeof signal === 'string' && signal.trim() ? signal : 'NO_SIGNAL',
    };
  }

  const signalTimestamp =
    typeof signal.timestamp === 'number' && Number.isFinite(signal.timestamp)
      ? signal.timestamp
      : candle.timestamp;
  return {
    evaluationId: `${signal.signalId || test.testId}:${test.strategyName}:${test.symbol}:${signalTimestamp}`,
    userName: test.userName,
    strategy: signal.strategy || test.strategyName,
    symbol: signal.symbol || test.symbol,
    interval: signal.interval || interval,
    timestamp: signalTimestamp,
    evaluatedAt: candle.timestamp,
    status: 'signal',
    reason: signal.orderSkipReason || signal.orderStatus,
    signalId: signal.signalId,
    direction: signal.direction,
    orderStatus: signal.orderStatus,
    orderSkipReason: signal.orderSkipReason,
    aiAnalysis: signal.aiAnalysis ?? null,
    ml: signal.ml,
  };
};

export type BacktestSession = {
  detectorFanoutKey?: string;
  detectorNoSignalSkipReason?: string;
  next(
    candle: KlineChartItem,
    btcCandle: KlineChartItem,
    detectorSkipCode?: string,
  ): Promise<string | Signal | undefined>;
  flush(): Promise<void>;
  result(): Promise<TestingBoxResult>;
};

export const createBacktestSession = async ({
  test,
  connector,
  strategyCreator,
  preparedData,
  interval,
  sharedIndicatorsReplayKey,
  monitor,
}: {
  test: Test;
  connector: Connector;
  strategyCreator: StrategyCreator;
  preparedData: PreparedBacktestData;
  interval: Interval;
  sharedIndicatorsReplayKey?: string;
  monitor: BacktestSessionMonitor;
}): Promise<BacktestSession> => {
  const instrument = test.instrument;
  const start = test.options.start;
  if (!start) throw new Error('no start');
  const { model: executionCostModel, fundingRates } =
    await resolveExecutionCosts({
      connector,
      symbol: test.symbol,
      config: test.strategyConfig,
      startTime: start,
      endTime: test.options.end,
      instrument,
    });
  const testConnector = createTestConnector(connector, {
    userName: test.userName,
    mlEnabled: test.ml,
    aiEnabled: Boolean(test.ai || test.researchTrace),
    fastMode: test.fast,
    instrument,
    executionCostModel,
    fundingRates,
  });
  const strategy = (await monitor.run('strategy init', () =>
    strategyCreator({
      userName: test.userName,
      connectorName: test.connectorName,
      universe: test.universe ?? 'crypto',
      assetClass: test.assetClass ?? instrument?.assetClass,
      instrument,
      accountId: test.accountId,
      deploymentId: test.deploymentId,
      policyProfileId: test.policyProfileId,
      config: { ...test.strategyConfig, INTERVAL: test.interval ?? interval },
      symbol: test.symbol,
      data: preparedData.prevData.slice(),
      btcData: preparedData.btcPrevData.slice(),
      ethData: [...preparedData.ethPrevData, ...preparedData.ethTestData],
      btcBinanceData: preparedData.btcBinanceData,
      btcCoinbaseData: preparedData.btcCoinbaseData,
      backtestExecutionMarketData: {
        interval: preparedData.backtestExecutionInterval,
        data: preparedData.backtestExecutionData,
        btcData: preparedData.backtestExecutionBtcData,
        dataByTimestamp: preparedData.backtestExecutionDataByTimestamp,
        btcDataByTimestamp: preparedData.backtestExecutionBtcDataByTimestamp,
      },
      connector: testConnector,
      sharedIndicatorsReplayKey,
    }),
  )) as BacktestDetectorOptimizedStrategy;

  const pendingMlPayloadBySignalId = new Map<
    string,
    ReturnType<typeof buildMlPayload>
  >();
  const pendingAiRowBySignalId = new Map<string, PendingAiDatasetRow>();
  const pendingResearchSetupBySignalId = new Map<
    string,
    ReturnType<typeof resolveCoreResearchSetupIdentity>
  >();
  const researchSkipCounts = new Map<string, number>();
  const researchEventCounts = new Map<string, number>();
  const warningCounts = createWarningCounts();
  const replayEvaluations = test.collectReplaySignalEvaluations
    ? ([] as RuntimeSignalEvaluationRecord[])
    : null;
  const chunkId = test.chunkId ?? 'single';

  const processSignal = async (
    signal: string | Signal | undefined,
    candle: Candle,
  ) => {
    recordSignalWarning(warningCounts, signal);
    if (test.researchTrace && typeof signal === 'string') {
      const reason = signal.trim() || 'NO_SIGNAL';
      researchSkipCounts.set(reason, (researchSkipCounts.get(reason) ?? 0) + 1);
    }
    if (
      typeof signal === 'string' &&
      signal.startsWith('BACKTEST_ENTRY_DELAY_')
    ) {
      return;
    }
    if (replayEvaluations) {
      replayEvaluations.push(
        buildReplayEvaluation({ signal, test, interval, candle }),
      );
    }
    if (
      signal &&
      typeof signal !== 'string' &&
      signal.signalId &&
      (test.ml || test.ai)
    ) {
      await enrichSignalWithMarketContextStages({
        signal,
        env: 'BACKTEST',
        coinMarketCapEnabled: true,
        onStageStart: monitor.contextStage,
      });
    }
    if (
      test.researchTrace &&
      signal &&
      typeof signal !== 'string' &&
      signal.signalId
    ) {
      const identity = resolveCoreResearchSetupIdentity(signal);
      pendingResearchSetupBySignalId.set(signal.signalId, identity);
      await appendCoreResearchTraceEvent({
        strategyName: test.strategyName,
        chunkId,
        event: {
          schema: 'tradejs-core-research-trace/v1',
          event:
            signal.orderStatus === 'failed' || signal.orderStatus === 'skipped'
              ? 'entry_rejected'
              : 'signal_emitted',
          timestamp: signal.timestamp,
          strategy: signal.strategy || test.strategyName,
          symbol: signal.symbol || test.symbol,
          direction: signal.direction,
          signalId: signal.signalId,
          configId: test.configId,
          backtestRunId: test.backtestRunId,
          backtestTestKey: test.backtestTestKey,
          ...identity,
        },
      });
      const traceEvent =
        signal.orderStatus === 'failed' || signal.orderStatus === 'skipped'
          ? 'entry_rejected'
          : 'signal_emitted';
      researchEventCounts.set(
        traceEvent,
        (researchEventCounts.get(traceEvent) ?? 0) + 1,
      );
    }
    if (test.ml && signal && typeof signal !== 'string' && signal.signalId) {
      pendingMlPayloadBySignalId.set(
        signal.signalId,
        buildMlPayload({
          signal,
          context: {
            userName: test.userName,
            testId: test.testId,
            testSuiteId: test.testSuiteId,
            testName: test.name,
            configId: test.configId,
            symbol: test.symbol,
            strategyName: test.strategyName,
            strategyConfig: test.strategyConfig,
            connectorName: test.connectorName,
          },
        }),
      );
    }
    if (test.ai && signal && typeof signal !== 'string' && signal.signalId) {
      pendingAiRowBySignalId.set(signal.signalId, {
        signalId: signal.signalId,
        strategyName: signal.strategy || test.strategyName,
        symbol: signal.symbol || test.symbol,
        direction: signal.direction,
        timestamp: signal.timestamp,
        signal: cloneSignal(signal),
        testId: test.testId,
        testSuiteId: test.testSuiteId,
        testName: test.name,
        configId: test.configId,
        connectorName: test.connectorName,
        ...buildDatasetMetadata({ ...test, chunkId }),
      });
    }
  };

  const flush = async () => {
    if (!test.ml && !test.ai && !test.researchTrace) return;
    const batch = await testConnector.drainMlResultsBatch();
    for (const resultRecord of batch) {
      const payload = pendingMlPayloadBySignalId.get(resultRecord.signalId);
      if (payload) {
        pendingMlPayloadBySignalId.delete(resultRecord.signalId);
        const fullRow = buildMlTrainingRow(payload, {
          profit: resultRecord.profit,
        });
        await appendMlDatasetRow({
          strategyName: test.strategyName,
          chunkId,
          row: {
            ...trimMlTrainingRowWindows(fullRow, 5),
            ...buildDatasetMetadata({ ...test, chunkId }),
          },
        });
      }
      const aiRowBase = pendingAiRowBySignalId.get(resultRecord.signalId);
      if (aiRowBase) {
        pendingAiRowBySignalId.delete(resultRecord.signalId);
        const { signal: aiSignal, ...rowBase } = aiRowBase;
        await appendAiDatasetRow({
          strategyName: test.strategyName,
          chunkId,
          row: {
            ...rowBase,
            payload: buildAiPayload(aiSignal),
            profit: resultRecord.profit,
            tradeResult: resultRecord.tradeResult,
            research: {
              schema: 'tradejs-core-research-row/v1',
              ...resolveCoreResearchSetupIdentity(aiSignal),
            },
          },
        });
      }
      const researchSetup = pendingResearchSetupBySignalId.get(
        resultRecord.signalId,
      );
      if (test.researchTrace && researchSetup && resultRecord.tradeResult) {
        pendingResearchSetupBySignalId.delete(resultRecord.signalId);
        await appendCoreResearchTraceEvent({
          strategyName: test.strategyName,
          chunkId,
          event: {
            schema: 'tradejs-core-research-trace/v1',
            event: 'entry_executed',
            timestamp: resultRecord.tradeResult.entryTimestamp,
            strategy: test.strategyName,
            symbol: test.symbol,
            direction: resultRecord.tradeResult.direction,
            signalId: resultRecord.signalId,
            configId: test.configId,
            backtestRunId: test.backtestRunId,
            backtestTestKey: test.backtestTestKey,
            ...researchSetup,
          },
        });
        researchEventCounts.set(
          'entry_executed',
          (researchEventCounts.get('entry_executed') ?? 0) + 1,
        );
        await appendCoreResearchTraceEvent({
          strategyName: test.strategyName,
          chunkId,
          event: {
            schema: 'tradejs-core-research-trace/v1',
            event: 'position_exited',
            timestamp: resultRecord.tradeResult.exitTimestamp,
            strategy: test.strategyName,
            symbol: test.symbol,
            direction: resultRecord.tradeResult.direction,
            signalId: resultRecord.signalId,
            configId: test.configId,
            backtestRunId: test.backtestRunId,
            backtestTestKey: test.backtestTestKey,
            netProfit: resultRecord.tradeResult.netProfit,
            exitReason: resultRecord.tradeResult.exitReason,
            ...researchSetup,
          },
        });
        researchEventCounts.set(
          'position_exited',
          (researchEventCounts.get('position_exited') ?? 0) + 1,
        );
      }
    }
  };

  return {
    detectorFanoutKey: strategy.detectorFanoutKey,
    detectorNoSignalSkipReason: strategy.detectorNoSignalSkipReason,
    next: async (candle, btcCandle, detectorSkipCode) => {
      const delayedSignal = await monitor.runStrategy(
        'delayed entry',
        () =>
          (
            strategy as BacktestDelayedEntryStrategy
          ).__tradejsFlushBacktestDelayedEntry?.(candle, btcCandle) ??
          Promise.resolve(undefined),
      );
      if (delayedSignal && typeof delayedSignal !== 'string') {
        await processSignal(delayedSignal, candle);
      }
      await monitor.run('exit checks', () => testConnector.checkExits(candle));

      const signal = await monitor.runStrategy(
        detectorSkipCode ? 'strategy detector skip' : 'strategy signal',
        () =>
          detectorSkipCode &&
          strategy.canFastAdvanceDetectorNoSignal &&
          strategy.advanceDetectorNoSignal
            ? strategy.advanceDetectorNoSignal(
                candle,
                btcCandle,
                detectorSkipCode,
              )
            : detectorSkipCode && strategy.skipDetectorNoSignal
              ? strategy.skipDetectorNoSignal(
                  candle,
                  btcCandle,
                  detectorSkipCode,
                )
              : strategy(candle, btcCandle),
      );
      await processSignal(signal, candle);
      return signal;
    },
    flush: () => monitor.run('flush closed results', flush),
    result: async () => {
      await monitor.run('flush closed results', flush);
      if (test.researchTrace) {
        await appendCoreResearchTraceEvent({
          strategyName: test.strategyName,
          chunkId,
          event: {
            schema: 'tradejs-core-research-trace/v1',
            event: 'skip_summary',
            timestamp: test.options.end ?? test.options.start ?? 0,
            strategy: test.strategyName,
            symbol: test.symbol,
            configId: test.configId,
            backtestRunId: test.backtestRunId,
            backtestTestKey: test.backtestTestKey,
            skipCounts: Object.fromEntries(
              [...researchSkipCounts.entries()].sort(([left], [right]) =>
                left < right ? -1 : left > right ? 1 : 0,
              ),
            ),
          },
        });
      }
      const result = await monitor.run('collect result', () =>
        testConnector.getResult(),
      );
      const researchTraceSummary = test.researchTrace
        ? {
            events: Object.fromEntries(researchEventCounts),
            skipCounts: Object.fromEntries(researchSkipCounts),
          }
        : undefined;
      return replayEvaluations
        ? {
            ...result,
            warningCounts,
            inlineReplaySignalEvaluations: replayEvaluations,
            researchTraceSummary,
          }
        : { ...result, warningCounts, researchTraceSummary };
    },
  };
};
