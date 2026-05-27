import {
  BaseContextBackend,
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
  snapshot: () => ReturnType<IndicatorsController['result']>;
};

type SharedReplayControllerState = {
  controller: IndicatorsController;
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
            snapshot: () => ReturnType<IndicatorsController['result']>;
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
  baseContextBackend?: BaseContextBackend;
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
  baseContextBackend,
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
        baseContextBackend,
        initialRuntimeState: initialRuntimeState ?? undefined,
      },
    );
  const sharedReplayState =
    env === 'BACKTEST' && sharedReplayKey
      ? (() => {
          let existing = sharedReplayControllers.get(sharedReplayKey);
          if (!existing) {
            existing = {
              controller: createController(),
              lastTimestamp: null,
              lastResult: undefined,
            };
            sharedReplayControllers.set(sharedReplayKey, existing);
          }
          return existing;
        })()
      : null;
  let controller: IndicatorsController | null =
    sharedReplayState?.controller ??
    (env === 'BACKTEST' ? createController() : null);
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

      sharedReplayState.lastTimestamp = candle.timestamp;
      sharedReplayState.lastResult = sharedReplayState.controller.next(
        candle,
        btcCandle,
      );
      return sharedReplayState.lastResult;
    }

    if (!controller) return undefined;
    return controller.next(candle, btcCandle);
  };

  const ensureControllerInitialized = (): SnapshotController => {
    if (sharedReplayState) {
      return createSnapshotController(sharedReplayState.controller);
    }

    if (controller) return createSnapshotController(controller);

    controller = createController(-1);

    const lastCandle = data[data.length - 1];
    const lastBtcCandle = btcData[btcData.length - 1];
    if (lastCandle && lastBtcCandle) {
      controller.next(lastCandle, lastBtcCandle);
    }

    return createSnapshotController(controller);
  };

  return {
    isInitialized: () => controller != null,

    setCurrentBar: (candle, btcCandle) => {
      currentBarPair = { candle, btcCandle };
    },

    onBar: (candle, btcCandle) => {
      const resolvedCandle = candle ?? currentBarPair?.candle;
      const resolvedBtcCandle = btcCandle ?? currentBarPair?.btcCandle;
      if (!resolvedCandle || !resolvedBtcCandle) return;
      applyBar(resolvedCandle, resolvedBtcCandle);
    },

    next: (candle, btcCandle) => {
      return applyBar(candle, btcCandle);
    },

    // Lazy bootstrap for live mode: initialize on history before current bar and then apply current bar once.
    ensureInitializedWithCurrentBar: ensureControllerInitialized,

    snapshot: () => ensureControllerInitialized().snapshot(),

    latestNumber: (key) => ensureControllerInitialized().latestNumber(key),
  };
};
