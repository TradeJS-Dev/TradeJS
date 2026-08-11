import type { BacktestSessionMonitor } from './contracts';

type TestingProgressMessage = {
  progress: true;
  testName: string;
  symbol: string;
  strategyName: string;
  stage: string;
  candleIndex?: number;
  candleTotal?: number;
  elapsedMs: number;
  stageElapsedMs: number;
};

const DEFAULT_STRATEGY_CANDLE_TIMEOUT_MS = 60_000;

const resolvePositiveInt = (value: unknown, fallback: number) => {
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getEffectiveTimeoutMs = (
  baseTimeoutMs: number | undefined,
  stageTimeoutMs: number | null,
) => {
  const base =
    baseTimeoutMs && baseTimeoutMs > 0 ? Math.trunc(baseTimeoutMs) : null;
  const stage =
    stageTimeoutMs && stageTimeoutMs > 0 ? Math.trunc(stageTimeoutMs) : null;
  if (base == null) return stage;
  if (stage == null) return base;
  return Math.min(base, stage);
};

export const createBacktestProgress = ({
  testName,
  symbol,
  strategyName,
  timeoutMs,
  timeoutSubject,
}: {
  testName: string;
  symbol: string;
  strategyName: string;
  timeoutMs?: number;
  timeoutSubject: string;
}): BacktestSessionMonitor & {
  checkpoint(stage: string): void;
  setCandle(index: number, total: number): void;
} => {
  const startedAt = Date.now();
  let activeStageStartedAt = startedAt;
  let lastProgressSentAt = 0;
  let lastProgressSignature = '';
  let currentCandleIndex = 0;
  let totalCandles = 0;
  const strategyCandleTimeoutMs = resolvePositiveInt(
    process.env.BACKTEST_STRATEGY_CANDLE_TIMEOUT_MS,
    DEFAULT_STRATEGY_CANDLE_TIMEOUT_MS,
  );

  const emit = (stage: string, force = false) => {
    const now = Date.now();
    const signature = [
      stage,
      currentCandleIndex,
      totalCandles,
      Math.floor((now - activeStageStartedAt) / 5000),
    ].join(':');
    if (!force) {
      if (
        signature === lastProgressSignature ||
        now - lastProgressSentAt < 4000
      ) {
        return;
      }
    }

    lastProgressSentAt = now;
    lastProgressSignature = signature;
    process.send?.({
      progress: true,
      testName,
      symbol,
      strategyName,
      stage,
      candleIndex: currentCandleIndex,
      candleTotal: totalCandles,
      elapsedMs: now - startedAt,
      stageElapsedMs: now - activeStageStartedAt,
    } satisfies TestingProgressMessage);
  };

  const runWithTimeout = async <T>(
    stage: string,
    action: () => Promise<T>,
    stageTimeoutOverrideMs: number | null,
  ): Promise<T> => {
    const stageTimeoutMs = getEffectiveTimeoutMs(
      timeoutMs,
      stageTimeoutOverrideMs,
    );
    if (stageTimeoutMs == null) return action();

    activeStageStartedAt = Date.now();
    emit(stage, true);
    const promise = action();
    return await new Promise<T>((resolve, reject) => {
      const heartbeat = setInterval(() => emit(stage), 5000);
      const timer = setTimeout(() => {
        clearInterval(heartbeat);
        reject(
          new Error(
            `${timeoutSubject} timed out after ${stageTimeoutMs}ms during ${stage}`,
          ),
        );
      }, stageTimeoutMs);

      promise.then(
        (value) => {
          clearInterval(heartbeat);
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearInterval(heartbeat);
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  };

  return {
    run: (stage, action) => runWithTimeout(stage, action, null),
    runStrategy: (stage, action) =>
      runWithTimeout(stage, action, strategyCandleTimeoutMs),
    contextStage: (stage) => {
      activeStageStartedAt = Date.now();
      emit(`${stage} context`, true);
    },
    checkpoint: (stage) => {
      if (timeoutMs && timeoutMs > 0) emit(stage);
    },
    setCandle: (index, total) => {
      currentCandleIndex = index;
      totalCandles = total;
      emit('candle loop', index === 1 || index === total);
    },
  };
};
