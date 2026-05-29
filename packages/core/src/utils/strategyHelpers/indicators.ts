import {
  createIndicators,
  IndicatorsControllerCheckpointState,
  IndicatorPeriods,
  IndicatorsControllerRuntimeState,
} from '../../indicators';
import { KlineChartData, StrategyIndicatorsState } from '@tradejs/types';

type IndicatorPeriodsConfig = Partial<
  Record<
    | 'MA_FAST'
    | 'MA_MEDIUM'
    | 'MA_SLOW'
    | 'OBV_SMA'
    | 'ATR'
    | 'ATR_PCT_SHORT'
    | 'ATR_PCT_LONG'
    | 'BB'
    | 'BB_STD'
    | 'MACD_FAST'
    | 'MACD_SLOW'
    | 'MACD_SIGNAL'
    | 'LEVEL_LOOKBACK'
    | 'LEVEL_DELAY',
    number
  >
>;

export const buildDefaultIndicatorPeriods = (
  config: IndicatorPeriodsConfig,
): Partial<IndicatorPeriods> => {
  const periods: Partial<IndicatorPeriods> = {};

  const assignIfFinite = (
    key: keyof IndicatorPeriods,
    value: unknown,
  ): void => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      periods[key] = value;
    }
  };

  assignIfFinite('maFast', config.MA_FAST);
  assignIfFinite('maMedium', config.MA_MEDIUM);
  assignIfFinite('maSlow', config.MA_SLOW);
  assignIfFinite('obvSma', config.OBV_SMA);
  assignIfFinite('atr', config.ATR);
  assignIfFinite('atrPctShort', config.ATR_PCT_SHORT);
  assignIfFinite('atrPctLong', config.ATR_PCT_LONG);
  assignIfFinite('bb', config.BB);
  assignIfFinite('bbStd', config.BB_STD);
  assignIfFinite('macdFast', config.MACD_FAST);
  assignIfFinite('macdSlow', config.MACD_SLOW);
  assignIfFinite('macdSignal', config.MACD_SIGNAL);
  assignIfFinite('levelLookback', config.LEVEL_LOOKBACK);
  assignIfFinite('levelDelay', config.LEVEL_DELAY);

  return periods;
};

type IndicatorsController = ReturnType<typeof createIndicators>;
type SnapshotController = IndicatorsController & {
  latestNumber: (key: string) => number | undefined;
  snapshot: (options?: {
    compact?: boolean;
    limit?: number;
  }) => ReturnType<IndicatorsController['result']>;
};

type SharedReplayControllerState = {
  controller: IndicatorsController | null;
  appliedDataEnd: number;
  lastTimestamp: number | null;
  lastResult: ReturnType<IndicatorsController['next']> | undefined;
};

const sharedReplayControllers = new Map<string, SharedReplayControllerState>();

const createSnapshotController = (
  value: IndicatorsController,
): SnapshotController => {
  const nextSnapshot =
    typeof (value as IndicatorsController & { snapshot?: unknown }).snapshot ===
    'function'
      ? (
          value as IndicatorsController & {
            snapshot: (options?: {
              compact?: boolean;
              limit?: number;
            }) => ReturnType<IndicatorsController['result']>;
          }
        ).snapshot.bind(value)
      : value.result.bind(value);

  return Object.assign(value, {
    snapshot: nextSnapshot,
  });
};

export const releaseStrategyIndicatorsReplayCache = (keyPrefix: string) => {
  for (const key of sharedReplayControllers.keys()) {
    if (key === keyPrefix || key.startsWith(`${keyPrefix}:`)) {
      sharedReplayControllers.delete(key);
    }
  }
};

export interface StrategyIndicatorsStateParams {
  env: string;
  data: KlineChartData;
  btcData: KlineChartData;
  btcBinanceData?: KlineChartData;
  btcCoinbaseData?: KlineChartData;
  periods?: Partial<IndicatorPeriods>;
  pluginRegistryScope?: string;
  initialRuntimeState?:
    | IndicatorsControllerRuntimeState
    | IndicatorsControllerCheckpointState
    | null;
  replayStartIndex?: number;
  sharedReplayKey?: string;
}

export const createStrategyIndicatorsState = ({
  env,
  data,
  btcData,
  btcBinanceData,
  btcCoinbaseData,
  periods,
  pluginRegistryScope,
  initialRuntimeState,
  replayStartIndex = 0,
  sharedReplayKey,
}: StrategyIndicatorsStateParams): StrategyIndicatorsState => {
  const createController = (initialDataEnd?: number) =>
    createIndicators(
      initialDataEnd == null
        ? data.slice(replayStartIndex)
        : data.slice(replayStartIndex, initialDataEnd),
      initialDataEnd == null
        ? btcData.slice(replayStartIndex)
        : btcData.slice(replayStartIndex, initialDataEnd),
      {
        periods,
        btcBinanceData,
        btcCoinbaseData,
        pluginRegistryScope,
        initialRuntimeState: initialRuntimeState ?? undefined,
      },
    );
  const sharedReplayState =
    env === 'BACKTEST' && sharedReplayKey
      ? (() => {
          let existing = sharedReplayControllers.get(sharedReplayKey);
          if (!existing) {
            existing = {
              controller: null,
              appliedDataEnd: replayStartIndex,
              lastTimestamp: null,
              lastResult: undefined,
            };
            sharedReplayControllers.set(sharedReplayKey, existing);
          }
          return existing;
        })()
      : null;
  let controller: IndicatorsController | null = null;
  let appliedDataEnd = replayStartIndex;
  let currentBarPair:
    | {
        candle: KlineChartData[number];
        btcCandle: KlineChartData[number];
      }
    | undefined;
  const applyBar = (
    candle: KlineChartData[number],
    btcCandle: KlineChartData[number],
  ) => {
    if (sharedReplayState) {
      if (sharedReplayState.lastTimestamp === candle.timestamp) {
        return sharedReplayState.lastResult;
      }
      if (
        sharedReplayState.lastTimestamp != null &&
        candle.timestamp < sharedReplayState.lastTimestamp
      ) {
        throw new Error(
          `Shared replay indicators received non-monotonic candle timestamp ${candle.timestamp} after ${sharedReplayState.lastTimestamp}`,
        );
      }
      if (!sharedReplayState.controller) {
        sharedReplayState.controller = createController(
          sharedReplayState.appliedDataEnd,
        );
      }

      sharedReplayState.lastTimestamp = candle.timestamp;
      sharedReplayState.lastResult = sharedReplayState.controller.next(
        candle,
        btcCandle,
      );
      return sharedReplayState.lastResult;
    }

    if (!controller) {
      controller = createController(appliedDataEnd);
    }

    const result = controller.next(candle, btcCandle);
    return result;
  };

  const syncDataRange = (targetDataEnd: number) => {
    const safeTargetDataEnd = Math.max(replayStartIndex, targetDataEnd);

    if (sharedReplayState) {
      if (!sharedReplayState.controller) {
        sharedReplayState.controller = createController(safeTargetDataEnd);
        sharedReplayState.appliedDataEnd = safeTargetDataEnd;
        const lastCandle = data[safeTargetDataEnd - 1];
        sharedReplayState.lastTimestamp = lastCandle?.timestamp ?? null;
        sharedReplayState.lastResult = undefined;
        return;
      }

      if (safeTargetDataEnd < sharedReplayState.appliedDataEnd) {
        throw new Error(
          `Shared replay indicators cannot rewind from index ${sharedReplayState.appliedDataEnd} to ${safeTargetDataEnd}`,
        );
      }

      for (
        let index = sharedReplayState.appliedDataEnd;
        index < safeTargetDataEnd;
        index += 1
      ) {
        const candle = data[index];
        const btcCandle = btcData[index];
        if (!candle || !btcCandle) continue;
        sharedReplayState.lastTimestamp = candle.timestamp;
        sharedReplayState.lastResult = sharedReplayState.controller.next(
          candle,
          btcCandle,
        );
      }
      sharedReplayState.appliedDataEnd = safeTargetDataEnd;
      return;
    }

    if (!controller) {
      controller = createController(safeTargetDataEnd);
      appliedDataEnd = safeTargetDataEnd;
      return;
    }

    if (safeTargetDataEnd < appliedDataEnd) {
      throw new Error(
        `Indicators cannot rewind from index ${appliedDataEnd} to ${safeTargetDataEnd}`,
      );
    }

    for (let index = appliedDataEnd; index < safeTargetDataEnd; index += 1) {
      const candle = data[index];
      const btcCandle = btcData[index];
      if (!candle || !btcCandle) continue;
      controller.next(candle, btcCandle);
    }
    appliedDataEnd = safeTargetDataEnd;
  };

  const syncToCurrentData = () => {
    syncDataRange(data.length);
  };
  const getAppliedDataEnd = () =>
    sharedReplayState ? sharedReplayState.appliedDataEnd : appliedDataEnd;
  const markAppliedDataEnd = (value: number) => {
    if (sharedReplayState) {
      sharedReplayState.appliedDataEnd = Math.max(
        sharedReplayState.appliedDataEnd,
        value,
      );
    } else {
      appliedDataEnd = Math.max(appliedDataEnd, value);
    }
  };

  const ensureControllerInitialized = (): SnapshotController => {
    syncToCurrentData();

    if (sharedReplayState) {
      if (!sharedReplayState.controller) {
        sharedReplayState.controller = createController(
          sharedReplayState.appliedDataEnd,
        );
      }
      return createSnapshotController(sharedReplayState.controller);
    }

    if (!controller) {
      controller = createController(appliedDataEnd);
    }

    return createSnapshotController(controller);
  };

  return {
    isInitialized: () =>
      sharedReplayState
        ? sharedReplayState.controller != null
        : controller != null,

    setCurrentBar: (candle, btcCandle) => {
      currentBarPair = { candle, btcCandle };
    },

    onBar: (candle, btcCandle) => {
      const resolvedCandle = candle ?? currentBarPair?.candle;
      const resolvedBtcCandle = btcCandle ?? currentBarPair?.btcCandle;
      if (!resolvedCandle || !resolvedBtcCandle) return;
      if (
        data[data.length - 1]?.timestamp === resolvedCandle.timestamp &&
        btcData[btcData.length - 1]?.timestamp === resolvedBtcCandle.timestamp
      ) {
        if (getAppliedDataEnd() >= data.length) {
          return;
        }
        syncDataRange(data.length - 1);
        applyBar(resolvedCandle, resolvedBtcCandle);
        markAppliedDataEnd(data.length);
        return;
      }
      applyBar(resolvedCandle, resolvedBtcCandle);
    },

    next: (candle, btcCandle) => {
      const explicitCandleDataEnd =
        data[data.length - 1]?.timestamp === candle.timestamp &&
        btcData[btcData.length - 1]?.timestamp === btcCandle.timestamp
          ? data.length - 1
          : data.length;
      syncDataRange(explicitCandleDataEnd);
      const result = applyBar(candle, btcCandle);
      if (explicitCandleDataEnd === data.length - 1) {
        markAppliedDataEnd(data.length);
      }
      return result;
    },

    // Lazy bootstrap for live mode: initialize on history before current bar and then apply current bar once.
    ensureInitializedWithCurrentBar: ensureControllerInitialized,

    snapshot: (options) => ensureControllerInitialized().snapshot(options),

    latestNumber: (key) => ensureControllerInitialized().latestNumber(key),
  };
};
