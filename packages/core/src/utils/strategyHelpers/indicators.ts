import { createIndicators, IndicatorPeriods } from '../../indicators';
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
): Partial<IndicatorPeriods> => ({
  maFast: config.MA_FAST,
  maMedium: config.MA_MEDIUM,
  maSlow: config.MA_SLOW,
  obvSma: config.OBV_SMA,
  atr: config.ATR,
  atrPctShort: config.ATR_PCT_SHORT,
  atrPctLong: config.ATR_PCT_LONG,
  bb: config.BB,
  bbStd: config.BB_STD,
  macdFast: config.MACD_FAST,
  macdSlow: config.MACD_SLOW,
  macdSignal: config.MACD_SIGNAL,
  levelLookback: config.LEVEL_LOOKBACK,
  levelDelay: config.LEVEL_DELAY,
});

type IndicatorsController = ReturnType<typeof createIndicators>;
type SnapshotController = IndicatorsController & {
  snapshot: () => ReturnType<IndicatorsController['result']>;
};

export interface StrategyIndicatorsStateParams {
  env: string;
  data: KlineChartData;
  btcData: KlineChartData;
  btcBinanceData?: KlineChartData;
  btcCoinbaseData?: KlineChartData;
  periods?: Partial<IndicatorPeriods>;
}

export const createStrategyIndicatorsState = ({
  env,
  data,
  btcData,
  btcBinanceData,
  btcCoinbaseData,
  periods,
}: StrategyIndicatorsStateParams): StrategyIndicatorsState => {
  let controller: IndicatorsController | null =
    env === 'BACKTEST'
      ? createIndicators(data, btcData, {
          periods,
          btcBinanceData,
          btcCoinbaseData,
        })
      : null;
  let currentBarPair:
    | {
        candle: KlineChartData[number];
        btcCandle: KlineChartData[number];
      }
    | undefined;
  const withSnapshot = (value: IndicatorsController): SnapshotController =>
    Object.assign(value, {
      snapshot: () => value.result(),
    });

  const applyBar = (
    candle: KlineChartData[number],
    btcCandle: KlineChartData[number],
  ) => {
    if (!controller) return;
    controller.next(candle, btcCandle);
  };

  const ensureControllerInitialized = (): SnapshotController => {
    if (controller) return withSnapshot(controller);

    controller = createIndicators(data.slice(0, -1), btcData.slice(0, -1), {
      periods,
      btcBinanceData,
      btcCoinbaseData,
    });

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

    latestNumber: (key) => {
      const snapshot = ensureControllerInitialized().snapshot() as
        | Record<string, unknown>
        | undefined;
      const value = snapshot?.[key];
      if (!Array.isArray(value) || value.length === 0) {
        return undefined;
      }
      const last = value[value.length - 1];
      return typeof last === 'number' ? last : undefined;
    },
  };
};
