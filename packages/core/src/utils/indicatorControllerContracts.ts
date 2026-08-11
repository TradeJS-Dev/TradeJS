import type { Candle } from '@tradejs/types';
import type { NumericHistoryBuffer } from './indicatorHistory';
import type {
  SerializableAdxState,
  SerializableAtrState,
  SerializableBollingerState,
  SerializableEmaState,
  SerializableMacdState,
  SerializableObvState,
  SerializablePsarState,
  SerializableRsiState,
  SerializableSmaState,
} from './serializableIndicators';
import type { SpreadSmootherState } from './spread';

export interface IndicatorPeriods {
  maFast: number;
  maMedium: number;
  maSlow: number;
  obvSma: number;
  atr: number;
  atrPctShort: number;
  atrPctLong: number;
  bb: number;
  bbStd: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  levelLookback: number;
  levelDelay: number;
}

export type CloseStreakRuntimeState = {
  up: number;
  down: number;
};

export type BreakoutRuntimeState = {
  side: 'high' | 'low' | null;
  barsSinceBreakout: number | null;
};

export type IndicatorRuntimeState = {
  maFast: SerializableSmaState;
  maMedium: SerializableSmaState;
  maSlow: SerializableSmaState;
  atr: SerializableAtrState;
  atrPctShort: SerializableSmaState;
  atrPctLong: SerializableSmaState;
  bb: SerializableBollingerState;
  obv: SerializableObvState;
  smaObv: SerializableSmaState;
  macd: SerializableMacdState;
  rsi: SerializableRsiState;
  adx: SerializableAdxState;
  baseContextHl2Ema: Record<string, SerializableEmaState>;
  baseContextCloseEma34: SerializableEmaState;
  baseContextTypicalSma20: SerializableSmaState;
  baseContextAdaptivePreviousCenterline: number | null;
  baseContextPsar: SerializablePsarState;
  baseContextPsarEma50: SerializableEmaState;
  baseContextPsarFilterBarsSinceSignal: number | null;
  btcMaFast: SerializableSmaState;
  btcMaSlow: SerializableSmaState;
  spreadSmoother: SpreadSmootherState;
};

export type IndicatorsControllerRuntimeState = {
  indicatorState: IndicatorRuntimeState;
  indicatorHistory: Record<string, NumericHistoryBuffer>;
  btcRuntimeHistory: Record<string, NumericHistoryBuffer>;
  latestIndicatorValues: Record<string, number>;
  rawCoinCandles: Candle[];
  rawBtcCandles: Candle[];
  rawEthCandles?: Candle[];
  coinResampledCandles: { h1: Candle[]; h4: Candle[]; d1: Candle[] };
  btcResampledCandles: { h1: Candle[]; h4: Candle[]; d1: Candle[] };
  ethResampledCandles?: { h1: Candle[]; h4: Candle[]; d1: Candle[] };
  closeStreaks: CloseStreakRuntimeState;
  breakoutState: BreakoutRuntimeState;
  btcCloses: number[];
  btcBinanceCursor: number;
  btcCoinbaseCursor: number;
};

export type IndicatorsControllerCheckpointState = Pick<
  IndicatorsControllerRuntimeState,
  | 'indicatorState'
  | 'rawCoinCandles'
  | 'rawBtcCandles'
  | 'rawEthCandles'
  | 'coinResampledCandles'
  | 'btcResampledCandles'
  | 'ethResampledCandles'
  | 'closeStreaks'
  | 'breakoutState'
  | 'btcCloses'
  | 'btcBinanceCursor'
  | 'btcCoinbaseCursor'
> &
  Partial<
    Pick<
      IndicatorsControllerRuntimeState,
      'indicatorHistory' | 'btcRuntimeHistory' | 'latestIndicatorValues'
    >
  >;
