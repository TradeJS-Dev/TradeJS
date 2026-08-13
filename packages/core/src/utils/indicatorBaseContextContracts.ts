import type { Candle } from '@tradejs/types';
import type { NumericHistoryBuffer } from './indicatorHistory';
import type {
  BreakoutRuntimeState,
  CloseStreakRuntimeState,
  IndicatorPeriods,
} from './indicatorControllerContracts';

export type BaseResultSnapshot = {
  maFast: number | null;
  maMedium: number | null;
  maSlow: number | null;
  atr: number | null;
  atrPct: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  obv: number | null;
  smaObv: number | null;
  macd: number | null | undefined;
  macdSignal: number | null | undefined;
  macdHistogram: number | null | undefined;
  price24hPcnt: number;
  price1hPcnt: number;
  highPrice1h: number | null;
  lowPrice1h: number | null;
  volume1h: number | null;
  highPrice24h: number | null;
  lowPrice24h: number | null;
  volume24h: number | null;
  highLevel: number | null;
  lowLevel: number | null;
  prevClose: number | null;
  correlation: number;
  spread: number | null;
};

export const BASE_CONTEXT_MA_LAYER_PERIODS = [
  [5, 12],
  [9, 13],
  [34, 50],
  [72, 89],
  [180, 200],
] as const;

export type BaseContextMaLayerInput = {
  fastPeriod: number;
  slowPeriod: number;
  fast: number | null;
  slow: number | null;
};

export type BaseContextContextMaInput = {
  baseline: number | null;
};

export type BaseContextAdaptiveChannelInput = {
  centerline: number | null;
  previousCenterline: number | null;
};

export type BaseContextPsarInput = {
  value: number | null;
  direction: 'bull' | 'bear' | 'unknown';
  rawBuySignal: boolean | null;
  rawSellSignal: boolean | null;
  buySignal: boolean | null;
  sellSignal: boolean | null;
  emaFilter: number | null;
  trendLongOk: boolean | null;
  trendShortOk: boolean | null;
  adxOk: boolean | null;
  candleLongOk: boolean | null;
  candleShortOk: boolean | null;
  cooldownOk: boolean | null;
  barsSinceSignal: number | null;
};

export type BuildBaseContextParams = {
  candle: Candle;
  prevCandle: Candle | null;
  baseResult: BaseResultSnapshot;
  candlesHistory: Candle[];
  btcCandlesHistory: Candle[];
  ethCandlesHistory?: Candle[];
  closeSeries: number[];
  volumeSeries: number[];
  btcCloseSeries: number[];
  coinResampledCandles: {
    h1: Candle[];
    h4: Candle[];
    d1: Candle[];
  };
  btcResampledCandles: {
    h1: Candle[];
    h4: Candle[];
    d1: Candle[];
  };
  ethResampledCandles?: {
    h1: Candle[];
    h4: Candle[];
    d1: Candle[];
  };
  indicatorHistory: Record<string, NumericHistoryBuffer>;
  indicatorPeriods: IndicatorPeriods;
  closeStreaks: CloseStreakRuntimeState;
  breakoutState: BreakoutRuntimeState;
  rsiValue?: number | null;
  adxValue?: {
    adx: number;
    pdi: number;
    mdi: number;
  } | null;
  maLayers?: BaseContextMaLayerInput[] | null;
  contextMa?: BaseContextContextMaInput | null;
  adaptiveChannel?: BaseContextAdaptiveChannelInput | null;
  psar?: BaseContextPsarInput | null;
};
