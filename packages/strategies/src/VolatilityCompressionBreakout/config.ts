import { FEE_PERCENT } from '@tradejs/core/constants';
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/types';

export interface VolatilityCompressionBreakoutSideConfig {
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
  VCB_MAX_ATR_PCT_RANK: 30,
  VCB_MAX_BB_WIDTH_RANK: 30,
  VCB_REQUIRE_BOTH_COMPRESSION_FILTERS: false,
  VCB_MIN_RANGE_EXPANSION_RANK: 60,
  VCB_MIN_VOLUME_REL20: 1.15,
  VCB_MIN_BREAKOUT_BODY_ATR: 0.2,
  VCB_MIN_BREAKOUT_DISTANCE_ATR: 0,
  VCB_MIN_BREAKOUT_DISTANCE_ATR_LONG: 0.5,
  VCB_MIN_BREAKOUT_DISTANCE_ATR_SHORT: 0,
  VCB_MAX_BREAKOUT_DISTANCE_ATR: 0,
  VCB_ENTRY_MAX_ATR_PCT_RANK: 0,
  VCB_ENTRY_MAX_ATR_PCT_RANK_LONG: 0,
  VCB_ENTRY_MAX_ATR_PCT_RANK_SHORT: 23,
  VCB_REQUIRE_BOTH_EXPANSION_FILTERS: false,
  VCB_MIN_ACCEPTANCE_CLOSES: 0,
  VCB_REQUIRE_DIRECTIONAL_BODY: false,
  VCB_REQUIRE_MTF_ALIGNMENT: false,
  VCB_REQUIRE_TRADE_FLOW_ALIGNMENT: false,
  VCB_STOP_ATR_BUFFER_MULT: 0.25,
  VCB_STOP_BUFFER_PCT: 0.04,
  VCB_FALLBACK_STOP_ATR_MULT: 1.2,
  VCB_TARGET_R_MULT: 2.4,
  VCB_EXIT_ON_OPPOSITE_BREAKOUT: true,
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

export type VolatilityCompressionBreakoutConfig = StrategyConfig &
  Omit<typeof config, 'BACKTEST_PRICE_MODE' | 'LONG' | 'SHORT'> & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    LONG: VolatilityCompressionBreakoutSideConfig;
    SHORT: VolatilityCompressionBreakoutSideConfig;
  };
