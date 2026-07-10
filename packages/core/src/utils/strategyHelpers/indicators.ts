import {
  createIndicators,
  getRequiredControllerSeedWindow,
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
  latestSnapshot: () => ReturnType<IndicatorsController['next']>;
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

const canUseSharedReplayController = (env: string, sharedReplayKey?: string) =>
  (env === 'BACKTEST' || env === 'PARITY') && Boolean(sharedReplayKey);

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
  ethData?: KlineChartData;
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
  ethData = [],
  btcBinanceData,
  btcCoinbaseData,
  periods,
  pluginRegistryScope,
  initialRuntimeState,
  replayStartIndex = 0,
  sharedReplayKey,
}: StrategyIndicatorsStateParams): StrategyIndicatorsState => {
  let ethDataByTimestamp: Map<number, KlineChartData[number]> | null = null;
  const controllerSeedWindow = getRequiredControllerSeedWindow(periods);
  const createController = (initialDataEnd?: number) => {
    const endIndex = initialDataEnd == null ? data.length : initialDataEnd;
    const startIndex = Math.max(
      replayStartIndex,
      endIndex - controllerSeedWindow,
    );
    const resolveEthDataWindow = (
      fromIndex: number,
      toIndex: number,
      coinWindow: KlineChartData,
    ) =>
      coinWindow.every(
        (candle, offset) =>
          ethData[fromIndex + offset]?.timestamp === candle.timestamp,
      )
        ? ethData.slice(fromIndex, toIndex)
        : (() => {
            const timestamps = new Set(
              coinWindow.map((candle) => candle.timestamp),
            );
            return ethData.filter((candle) => timestamps.has(candle.timestamp));
          })();
    const createControllerWithState = (
      coinWindow: KlineChartData,
      btcWindow: KlineChartData,
      ethWindow: KlineChartData,
      state:
        | IndicatorsControllerRuntimeState
        | IndicatorsControllerCheckpointState
        | null
        | undefined,
    ) =>
      createIndicators(coinWindow, btcWindow, {
        periods,
        ethData: ethWindow,
        btcBinanceData,
        btcCoinbaseData,
        pluginRegistryScope,
        initialRuntimeState: state ?? undefined,
      });

    if (startIndex <= replayStartIndex) {
      const dataWindow = data.slice(startIndex, endIndex);
      return createControllerWithState(
        dataWindow,
        btcData.slice(startIndex, endIndex),
        resolveEthDataWindow(startIndex, endIndex, dataWindow),
        initialRuntimeState,
      );
    }

    const warmupData = data.slice(replayStartIndex, startIndex);
    const warmupController = createControllerWithState(
      warmupData,
      btcData.slice(replayStartIndex, startIndex),
      resolveEthDataWindow(replayStartIndex, startIndex, warmupData),
      initialRuntimeState,
    );
    const dataWindow = data.slice(startIndex, endIndex);

    return createControllerWithState(
      dataWindow,
      btcData.slice(startIndex, endIndex),
      resolveEthDataWindow(startIndex, endIndex, dataWindow),
      warmupController.checkpointRuntimeState(),
    );
  };
  const sharedReplayState =
    canUseSharedReplayController(env, sharedReplayKey) && sharedReplayKey
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
        ethCandle?: KlineChartData[number];
      }
    | undefined;
  const resolveEthCandle = (index: number, candle: KlineChartData[number]) => {
    if (
      currentBarPair?.candle.timestamp === candle.timestamp &&
      currentBarPair.ethCandle
    ) {
      return currentBarPair.ethCandle;
    }

    const alignedEthCandle = ethData[index];
    if (alignedEthCandle?.timestamp === candle.timestamp) {
      return alignedEthCandle;
    }

    ethDataByTimestamp ??= new Map(
      ethData.map((item) => [item.timestamp, item]),
    );
    return ethDataByTimestamp.get(candle.timestamp);
  };
  const applyBar = (
    candle: KlineChartData[number],
    btcCandle: KlineChartData[number],
    ethCandle?: KlineChartData[number],
  ) => {
    if (sharedReplayState) {
      if (sharedReplayState.lastTimestamp === candle.timestamp) {
        return (
          sharedReplayState.lastResult ??
          sharedReplayState.controller?.latestSnapshot()
        );
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
      sharedReplayState.lastResult =
        ethCandle == null
          ? sharedReplayState.controller.next(candle, btcCandle)
          : sharedReplayState.controller.next(candle, btcCandle, ethCandle);
      return sharedReplayState.lastResult;
    }

    if (!controller) {
      controller = createController(appliedDataEnd);
    }

    const result =
      ethCandle == null
        ? controller.next(candle, btcCandle)
        : controller.next(candle, btcCandle, ethCandle);
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
        const ethCandle =
          candle == null ? undefined : resolveEthCandle(index, candle);
        if (!candle || !btcCandle) continue;
        sharedReplayState.lastTimestamp = candle.timestamp;
        sharedReplayState.lastResult =
          ethCandle == null
            ? sharedReplayState.controller.next(candle, btcCandle)
            : sharedReplayState.controller.next(candle, btcCandle, ethCandle);
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
      const ethCandle =
        candle == null ? undefined : resolveEthCandle(index, candle);
      if (!candle || !btcCandle) continue;
      if (ethCandle == null) {
        controller.next(candle, btcCandle);
      } else {
        controller.next(candle, btcCandle, ethCandle);
      }
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

    setCurrentBar: (candle, btcCandle, ethCandle) => {
      currentBarPair = { candle, btcCandle, ethCandle };
    },

    updateReferenceData: (nextReferenceData) => {
      btcBinanceData = nextReferenceData.btcBinanceData;
      btcCoinbaseData = nextReferenceData.btcCoinbaseData;
      controller?.updateReferenceData(nextReferenceData);
      sharedReplayState?.controller?.updateReferenceData(nextReferenceData);
    },

    onBar: (candle, btcCandle, ethCandle) => {
      const resolvedCandle = candle ?? currentBarPair?.candle;
      const resolvedBtcCandle = btcCandle ?? currentBarPair?.btcCandle;
      const resolvedEthCandle =
        ethCandle ??
        currentBarPair?.ethCandle ??
        (resolvedCandle == null
          ? undefined
          : resolveEthCandle(data.length - 1, resolvedCandle));
      if (!resolvedCandle || !resolvedBtcCandle) return;
      if (
        data[data.length - 1]?.timestamp === resolvedCandle.timestamp &&
        btcData[btcData.length - 1]?.timestamp === resolvedBtcCandle.timestamp
      ) {
        if (getAppliedDataEnd() >= data.length) {
          return;
        }
        syncDataRange(data.length - 1);
        applyBar(resolvedCandle, resolvedBtcCandle, resolvedEthCandle);
        markAppliedDataEnd(data.length);
        return;
      }
      applyBar(resolvedCandle, resolvedBtcCandle, resolvedEthCandle);
    },

    next: (candle, btcCandle, ethCandle) => {
      const resolvedEthCandle =
        ethCandle ?? resolveEthCandle(data.length - 1, candle);
      const explicitCurrent =
        data[data.length - 1]?.timestamp === candle.timestamp &&
        btcData[btcData.length - 1]?.timestamp === btcCandle.timestamp;
      if (explicitCurrent && getAppliedDataEnd() >= data.length) {
        return ensureControllerInitialized().latestSnapshot();
      }
      const explicitCandleDataEnd = explicitCurrent
        ? data.length - 1
        : data.length;
      syncDataRange(explicitCandleDataEnd);
      const result = applyBar(candle, btcCandle, resolvedEthCandle);
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
