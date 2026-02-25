import { createIndicators, IndicatorPeriods } from '@utils/indicators';
import { KlineChartData } from '@types';

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

export interface StrategyIndicatorsStateParams {
  env: string;
  data: KlineChartData;
  btcData: KlineChartData;
  periods?: Partial<IndicatorPeriods>;
}

export interface StrategyIndicatorsState {
  isInitialized: () => boolean;
  onBar: (
    candle: KlineChartData[number],
    btcCandle: KlineChartData[number],
  ) => void;
  ensureInitializedWithCurrentBar: () => IndicatorsController;
  result: () => ReturnType<IndicatorsController['result']> | undefined;
}

export const createStrategyIndicatorsState = ({
  env,
  data,
  btcData,
  periods,
}: StrategyIndicatorsStateParams): StrategyIndicatorsState => {
  let controller: IndicatorsController | null =
    env === 'BACKTEST' ? createIndicators(data, btcData, { periods }) : null;

  return {
    isInitialized: () => controller != null,

    onBar: (candle, btcCandle) => {
      if (!controller) return;
      controller.next(candle, btcCandle);
    },

    // Lazy bootstrap for live mode: initialize on history before current bar and then apply current bar once.
    ensureInitializedWithCurrentBar: () => {
      if (controller) return controller;

      controller = createIndicators(data.slice(0, -1), btcData.slice(0, -1), {
        periods,
      });

      const lastCandle = data[data.length - 1];
      const lastBtcCandle = btcData[btcData.length - 1];
      if (lastCandle && lastBtcCandle) {
        controller.next(lastCandle, lastBtcCandle);
      }

      return controller;
    },

    result: () => controller?.result(),
  };
};
