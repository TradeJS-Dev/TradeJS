import type {
  TradejsConfigHooks,
  TradejsConfigSignalsHookContext,
} from '@tradejs/core/config';
import type { Signal } from '@tradejs/types';
import type { RuntimeLineageScopeRecord } from '../runtimeSignalsStorage';
import type { PortfolioReplayConnector } from './portfolioReplayConnector';
import {
  releaseHistoricalReplayCaches,
  type HistoricalReplayPlan,
} from './historicalSignalsReplayPreparation';
import {
  createReplayDecisionTrace,
  type ReplayDecisionTrace,
  type ReplayDecisionTraceTarget,
} from './historicalSignalsReplayDecisionTrace';
import { createHistoricalReplaySkipEvidence } from './historicalSignalsReplaySkipEvidence';

export type HistoricalReplayExecutionContext = {
  plan: HistoricalReplayPlan;
  connector: PortfolioReplayConnector;
  collectSkipEvidence?: boolean;
  collectSignals?: boolean;
  collectPortfolioDiagnostics?: boolean;
  decisionTraceTargets?: ReplayDecisionTraceTarget[];
  hooks?: TradejsConfigHooks;
  hookContext: TradejsConfigSignalsHookContext;
};

export type HistoricalReplayExecutionAdapters = {
  clock: {
    now(): number;
  };
  progress: {
    enabled?: boolean;
    tick(tokens: { signals: string; aborted: string; ts: string }): void;
  };
  display: {
    signals(value: number): string;
    aborted(value: number): string;
    timestamp(value: number): string;
  };
  invokeBeforeSignals(
    hooks: TradejsConfigHooks | undefined,
    context: TradejsConfigSignalsHookContext,
  ): Promise<{ abort?: boolean; reason?: string } | undefined>;
  invokeAfterSignals(
    hooks: TradejsConfigHooks | undefined,
    context: TradejsConfigSignalsHookContext & {
      signals: Signal[];
      status: 'completed' | 'failed';
      durationMs: number;
    },
  ): Promise<void>;
  enrichSignal(signal: Signal): Promise<unknown>;
  releaseIndicatorsCache(keyPrefix: string): void;
  releaseReplayCache(keyPrefix: string): void;
};

export type PortfolioReplayDiagnostics = {
  markedMaxDrawdown: number | null;
  unpricedCycles: number;
  admissions: Array<{
    key: string;
    strategy: string;
    status: 'filled' | 'capacity-rejected';
  }>;
};

export type HistoricalReplayExecutionResult = {
  signals: Signal[];
  portfolioDiagnostics?: PortfolioReplayDiagnostics;
  abortedCycles: number;
  replayLineageScopes: RuntimeLineageScopeRecord[];
  replayDecisionTraces: ReplayDecisionTrace[];
};

const advanceCycleMarket = async (
  plan: HistoricalReplayPlan,
  connector: PortfolioReplayConnector,
  timestamp: number,
) => {
  const cycleSymbols = plan.symbolRuntimes.filter(
    (symbolRuntime) =>
      (symbolRuntime.replayData[symbolRuntime.currentIndex]?.timestamp ?? NaN) +
        (symbolRuntime.timestampOffsetMs ?? 0) ===
      timestamp,
  );
  for (const symbolRuntime of cycleSymbols) {
    const candle = symbolRuntime.replayData[symbolRuntime.currentIndex];
    if (
      candle &&
      candle.timestamp + (symbolRuntime.timestampOffsetMs ?? 0) === timestamp
    ) {
      if (symbolRuntime.advanceMarket === false) continue;
      await connector.advanceMarket({
        symbol: symbolRuntime.symbol,
        candle,
      });
    }
  }
  return cycleSymbols;
};

const advanceAbortedCycle = (
  cycleSymbols: HistoricalReplayPlan['symbolRuntimes'],
  timestamp: number,
) => {
  for (const symbolRuntime of cycleSymbols ?? []) {
    const candle = symbolRuntime.replayData[symbolRuntime.currentIndex];
    if (
      candle &&
      candle.timestamp + (symbolRuntime.timestampOffsetMs ?? 0) === timestamp
    ) {
      symbolRuntime.currentIndex += 1;
    }
  }
};

export const executeHistoricalReplay = async (
  context: HistoricalReplayExecutionContext,
  adapters: HistoricalReplayExecutionAdapters,
): Promise<HistoricalReplayExecutionResult> => {
  const signals: Signal[] = [];
  let abortedCycles = 0;
  const skipEvidence = createHistoricalReplaySkipEvidence(
    context.plan.runtimeLineages,
    context.collectSkipEvidence,
  );
  const decisionTrace = createReplayDecisionTrace(context.decisionTraceTargets);
  const portfolioDiagnostics: PortfolioReplayDiagnostics | undefined =
    context.collectPortfolioDiagnostics
      ? { markedMaxDrawdown: 0, unpricedCycles: 0, admissions: [] }
      : undefined;
  let equityPeak = 0;
  const observeEquity = () => {
    if (!portfolioDiagnostics) return;
    const equity = context.connector.getMarkedEquity();
    if (equity === null) {
      portfolioDiagnostics.unpricedCycles++;
      return;
    }
    equityPeak = Math.max(equityPeak, equity);
    portfolioDiagnostics.markedMaxDrawdown = Math.max(
      portfolioDiagnostics.markedMaxDrawdown ?? 0,
      equityPeak - equity,
    );
  };
  const reportProgress = (timestamp: number) => {
    if (adapters.progress.enabled === false) return;
    adapters.progress.tick({
      signals: adapters.display.signals(signals.length),
      aborted: adapters.display.aborted(abortedCycles),
      ts: adapters.display.timestamp(timestamp),
    });
  };

  try {
    for (const timestamp of context.plan.orderedTimestamps) {
      const cycleStartedAt = adapters.clock.now();
      const cycleSymbols = await advanceCycleMarket(
        context.plan,
        context.connector,
        timestamp,
      );
      const beforeSignalsResult = await adapters.invokeBeforeSignals(
        context.hooks,
        context.hookContext,
      );

      if (beforeSignalsResult?.abort === true) {
        abortedCycles += 1;
        await adapters.invokeAfterSignals(context.hooks, {
          ...context.hookContext,
          signals: [],
          status: 'completed',
          durationMs: adapters.clock.now() - cycleStartedAt,
        });
        if (context.decisionTraceTargets?.length) {
          for (const symbolRuntime of cycleSymbols) {
            const candle = symbolRuntime.replayData[symbolRuntime.currentIndex];
            for (const strategy of symbolRuntime.strategies) {
              decisionTrace.record(
                strategy.strategyName,
                symbolRuntime.symbol,
                candle,
                undefined,
                'REPLAY_CYCLE_ABORTED',
              );
            }
          }
        }
        advanceAbortedCycle(cycleSymbols, timestamp);
        observeEquity();
        reportProgress(timestamp);
        continue;
      }

      const cycleSignals: Signal[] = [];
      for (const symbolRuntime of cycleSymbols) {
        const candle = symbolRuntime.replayData[symbolRuntime.currentIndex];
        const btcCandle =
          symbolRuntime.btcReplayData[symbolRuntime.currentIndex];
        const ethCandle =
          symbolRuntime.ethReplayData[symbolRuntime.currentIndex];
        if (
          !candle ||
          !btcCandle ||
          candle.timestamp + (symbolRuntime.timestampOffsetMs ?? 0) !==
            timestamp ||
          btcCandle.timestamp !== candle.timestamp
        ) {
          if (candle && context.decisionTraceTargets?.length) {
            for (const strategy of symbolRuntime.strategies) {
              decisionTrace.record(
                strategy.strategyName,
                symbolRuntime.symbol,
                candle,
                undefined,
                'REPLAY_CANDLE_OR_REFERENCE_NOT_ALIGNED',
              );
            }
          }
          continue;
        }

        for (const strategyRuntime of symbolRuntime.strategies) {
          const result = await strategyRuntime.run(
            candle,
            btcCandle,
            ethCandle?.timestamp === candle.timestamp ? ethCandle : undefined,
          );
          decisionTrace.record(
            strategyRuntime.strategyName,
            symbolRuntime.symbol,
            candle,
            result,
          );
          skipEvidence.record({
            strategyName: strategyRuntime.strategyName,
            symbol: symbolRuntime.symbol,
            strategyConfig: strategyRuntime.strategyConfig,
            runtimeLineage: strategyRuntime.runtimeLineage,
            timestamp: candle.timestamp,
            result,
          });
          if (result && typeof result !== 'string') {
            if (portfolioDiagnostics) {
              const status =
                result.orderFailureReason === 'PORTFOLIO_POSITION_LIMIT'
                  ? 'capacity-rejected'
                  : result.orderStatus === 'completed'
                    ? 'filled'
                    : undefined;
              if (status)
                portfolioDiagnostics.admissions.push({
                  strategy: strategyRuntime.strategyName,
                  status,
                  key: JSON.stringify([
                    strategyRuntime.strategyName,
                    result.symbol,
                    result.direction,
                    result.timestamp,
                    result.signalId,
                  ]),
                });
            }
            result.runtimeLineage = strategyRuntime.runtimeLineage;
            await adapters.enrichSignal(result);
            cycleSignals.push(result);
            if (context.collectSignals !== false) signals.push(result);
          }
        }

        symbolRuntime.currentIndex += 1;
      }

      await adapters.invokeAfterSignals(context.hooks, {
        ...context.hookContext,
        signals: cycleSignals,
        status: 'completed',
        durationMs: adapters.clock.now() - cycleStartedAt,
      });
      observeEquity();
      reportProgress(timestamp);
    }
  } finally {
    releaseHistoricalReplayCaches(context.plan, adapters);
  }

  if (portfolioDiagnostics?.unpricedCycles)
    portfolioDiagnostics.markedMaxDrawdown = null;
  return {
    ...(portfolioDiagnostics ? { portfolioDiagnostics } : {}),
    signals,
    abortedCycles,
    replayLineageScopes: skipEvidence.values(),
    replayDecisionTraces: decisionTrace.values(),
  };
};
