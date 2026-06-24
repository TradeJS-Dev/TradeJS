import { FEE_PERCENT } from '@tradejs/core/constants';
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/types';

export interface MarketFlushReversalSideConfig {
  enable: boolean;
  direction: Direction;
  minRiskRatio: number;
}

export const config = {
  ENV: 'BACKTEST',
  INTERVAL: '15' as Interval,
  MAKE_ORDERS: true,
  CLOSE_OPPOSITE_POSITIONS: false,
  BACKTEST_PRICE_MODE: 'open' as const,
  AI_ENABLED: true,
  AI_MODE: 'gate' as const,
  ML_ENABLED: false,
  ML_THRESHOLD: 0.1,
  MIN_AI_QUALITY: 4,
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
  MFR_MIN_VOLUME_REL20: 1.1,
  MFR_MIN_MARKET_LIQ_SPIKE_RATIO: 2,
  MFR_MIN_SWEEP_WICK_PCT: 0.2,
  MFR_MAX_LONG_RANGE_POSITION: 0.45,
  MFR_MIN_SHORT_RANGE_POSITION: 0.55,
  MFR_STOP_ATR_BUFFER_MULT: 0.25,
  MFR_STOP_BUFFER_PCT: 0.05,
  MFR_FALLBACK_STOP_ATR_MULT: 1.4,
  MFR_TARGET_R_MULT: 2.2,
  MFR_EXIT_ON_OPPOSITE_SIGNAL: true,
  LONG: {
    enable: true,
    direction: 'LONG',
    minRiskRatio: 1.4,
  },
  SHORT: {
    enable: true,
    direction: 'SHORT',
    minRiskRatio: 1.4,
  },
} as const;

export type MarketFlushReversalConfig = StrategyConfig &
  Omit<typeof config, 'BACKTEST_PRICE_MODE' | 'LONG' | 'SHORT'> & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    LONG: MarketFlushReversalSideConfig;
    SHORT: MarketFlushReversalSideConfig;
  };
