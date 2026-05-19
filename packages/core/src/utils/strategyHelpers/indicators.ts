import {
  createIndicators,
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

export interface StrategyIndicatorsStateParams {
  env: string;
  data: KlineChartData;
  btcData: KlineChartData;
  btcBinanceData?: KlineChartData;
  btcCoinbaseData?: KlineChartData;
  periods?: Partial<IndicatorPeriods>;
  pluginRegistryScope?: string;
  initialRuntimeState?: IndicatorsControllerRuntimeState | null;
  replayStartIndex?: number;
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
}: StrategyIndicatorsStateParams): StrategyIndicatorsState => {
  let controller: IndicatorsController | null =
    env === 'BACKTEST'
      ? createIndicators(
          data.slice(replayStartIndex),
          btcData.slice(replayStartIndex),
          {
            periods,
            btcBinanceData,
            btcCoinbaseData,
            pluginRegistryScope,
            initialRuntimeState: initialRuntimeState ?? undefined,
          },
        )
      : null;
  let currentBarPair:
    | {
        candle: KlineChartData[number];
        btcCandle: KlineChartData[number];
      }
    | undefined;
  const withSnapshot = (value: IndicatorsController): SnapshotController => {
    const nextSnapshot =
      typeof (value as IndicatorsController & { snapshot?: unknown })
        .snapshot === 'function'
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

  const applyBar = (
    candle: KlineChartData[number],
    btcCandle: KlineChartData[number],
  ) => {
    if (!controller) return;
    controller.next(candle, btcCandle);
  };

  const ensureControllerInitialized = (): SnapshotController => {
    if (controller) return withSnapshot(controller);

    controller = createIndicators(
      data.slice(replayStartIndex, -1),
      btcData.slice(replayStartIndex, -1),
      {
        periods,
        btcBinanceData,
        btcCoinbaseData,
        pluginRegistryScope,
        initialRuntimeState: initialRuntimeState ?? undefined,
      },
    );

    const lastCandle = data[data.length - 1];
    const lastBtcCandle = btcData[btcData.length - 1];
    if (lastCandle && lastBtcCandle) {
      controller.next(lastCandle, lastBtcCandle);
    }

    return withSnapshot(controller);
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
      if (!controller) return undefined;
      return controller.next(candle, btcCandle);
    },

    // Lazy bootstrap for live mode: initialize on history before current bar and then apply current bar once.
    ensureInitializedWithCurrentBar: ensureControllerInitialized,

    snapshot: () => ensureControllerInitialized().snapshot(),

    latestNumber: (key) => ensureControllerInitialized().latestNumber(key),
  };
};
