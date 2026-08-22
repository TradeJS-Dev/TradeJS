import type {
  TradejsConfigHooks,
  TradejsConfigSignalsHookContext,
} from '@tradejs/core/config';
import type { Signal } from '@tradejs/types';
import type { PortfolioReplayConnector } from './portfolioReplayConnector';
import type { HistoricalReplayPlan } from './historicalSignalsReplayPreparation';

export type HistoricalReplayExecutionContext = {
  plan: HistoricalReplayPlan;
  connector: PortfolioReplayConnector;
  hooks?: TradejsConfigHooks;
  hookContext: TradejsConfigSignalsHookContext;
};

export type HistoricalReplayExecutionAdapters = {
  clock: {
    now(): number;
  };
  progress: {
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

export type HistoricalReplayExecutionResult = {
  signals: Signal[];
  abortedCycles: number;
};

const advanceCycleMarket = async (
  plan: HistoricalReplayPlan,
  connector: PortfolioReplayConnector,
  timestamp: number,
) => {
  const cycleSymbols = plan.cycleSymbolsByTimestamp.get(timestamp) ?? [];
  for (const symbolRuntime of cycleSymbols) {
    const candle = symbolRuntime.replayData[symbolRuntime.currentIndex];
    if (candle?.timestamp === timestamp) {
      await connector.advanceMarket({
        symbol: symbolRuntime.symbol,
        candle,
      });
    }
  }
  return cycleSymbols;
};

const advanceAbortedCycle = (
  cycleSymbols: ReturnType<
    HistoricalReplayPlan['cycleSymbolsByTimestamp']['get']
  >,
  timestamp: number,
) => {
  for (const symbolRuntime of cycleSymbols ?? []) {
    const candle = symbolRuntime.replayData[symbolRuntime.currentIndex];
    if (candle?.timestamp === timestamp) {
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
        advanceAbortedCycle(cycleSymbols, timestamp);
        adapters.progress.tick({
          signals: adapters.display.signals(signals.length),
          aborted: adapters.display.aborted(abortedCycles),
          ts: adapters.display.timestamp(timestamp),
        });
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
          candle.timestamp !== timestamp ||
          btcCandle.timestamp !== timestamp
        ) {
          continue;
        }

        for (const strategyRuntime of symbolRuntime.strategies) {
          const result = await strategyRuntime.run(
            candle,
            btcCandle,
            ethCandle?.timestamp === timestamp ? ethCandle : undefined,
          );
          if (result && typeof result !== 'string') {
            result.runtimeLineage = strategyRuntime.runtimeLineage;
            await adapters.enrichSignal(result);
            cycleSignals.push(result);
            signals.push(result);
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
      adapters.progress.tick({
        signals: adapters.display.signals(signals.length),
        aborted: adapters.display.aborted(abortedCycles),
        ts: adapters.display.timestamp(timestamp),
      });
    }
  } finally {
    for (const keyPrefix of context.plan.sharedReplayKeyPrefixes) {
      adapters.releaseIndicatorsCache(keyPrefix);
      adapters.releaseReplayCache(keyPrefix);
    }
  }

  return { signals, abortedCycles };
};
