import { FEE_PERCENT } from '@tradejs/core/constants';
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/types';

export interface VolumeDivergenceModeConfig {
  enable: boolean;
  direction: Direction;
  TP: number;
  SL: number;
  minRiskRatio: number;
}

export const config = {
  ENV: 'BACKTEST',
  INTERVAL: '15' as Interval,
  MAKE_ORDERS: true,
  CLOSE_OPPOSITE_POSITIONS: false,
  BACKTEST_PRICE_MODE: 'mid' as const,
  AI_ENABLED: false,
  AI_MODE: 'llm' as const,
  ML_ENABLED: false,
  ML_THRESHOLD: 0.1,
  MIN_AI_QUALITY: 3,
  FEE_PERCENT,
  MAX_LOSS_VALUE: 10,
  MA_FAST: 14,
  MA_MEDIUM: 49,
  MA_SLOW: 50,
  OBV_SMA: 10,
  ATR: 14,
  ATR_PCT_SHORT: 7,
  ATR_PCT_LONG: 30,
  BB: 20,
  BB_STD: 2,
  MACD_FAST: 12,
  MACD_SLOW: 26,
  MACD_SIGNAL: 9,
  LEVEL_LOOKBACK: 20,
  LEVEL_DELAY: 2,
  NORMALIZATION_LENGTH: 100,
  PIVOT_LOOKBACK_LEFT: 8,
  PIVOT_LOOKBACK_RIGHT: 3,
  MIN_BARS_BETWEEN_PIVOTS: 4,
  MAX_BARS_BETWEEN_PIVOTS: 36,
  ALLOW_STRUCTURE_ADVANCE_ENTRY: false,
  MIN_DIVERGENCE_AMPLITUDE_ATR_RATIO: 0.35,
  MIN_RECLAIM_PCT: 105,
  MIN_CONFIRMATION_CANDLE_QUALITY: 0.58,
  BULLISH: {
    enable: true,
    direction: 'LONG',
    TP: 4,
    SL: 1.3,
    minRiskRatio: 2,
  },
  BEARISH: {
    enable: true,
    direction: 'SHORT',
    TP: 4,
    SL: 1.3,
    minRiskRatio: 2,
  },
} as const;

export type VolumeDivergenceConfig = StrategyConfig &
  Omit<typeof config, 'BACKTEST_PRICE_MODE' | 'BULLISH' | 'BEARISH'> & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    BULLISH: VolumeDivergenceModeConfig;
    BEARISH: VolumeDivergenceModeConfig;
  };
