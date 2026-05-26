import { FEE_PERCENT } from '@tradejs/core/constants';
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/types';

export type MSLLiquidityZonesSwingAreaMode = 'wick_extremity' | 'full_range';
export type MSLLiquidityZonesFilterMode = 'count' | 'volume';

export interface MSLLiquidityZonesSideConfig {
  enable: boolean;
  direction: Direction;
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
  MSLZONES_PIVOT_LOOKBACK: 15,
  MSLZONES_SWING_AREA_MODE: 'wick_extremity' as const,
  MSLZONES_FILTER_MODE: 'count' as const,
  MSLZONES_MIN_FILTER_VALUE: 0,
  MSLZONES_SHOW_SWING_HIGH_ZONES: true,
  MSLZONES_SHOW_SWING_LOW_ZONES: true,
  MSLZONES_MAX_AGE: 500,
  MSLZONES_REACTION_CLOSE_BEYOND_ZONE: true,
  MSLZONES_REQUIRE_REACTION_BODY: true,
  MSLZONES_MAX_RETEST_PENETRATION_PCT: 125,
  MSLZONES_STOP_ZONE_BUFFER_MULT: 0.2,
  MSLZONES_STOP_BUFFER_PCT: 0.03,
  MSLZONES_TARGET_R_MULT: 2,
  MSLZONES_EXIT_ON_OPPOSITE_RETEST: true,
  MSLZONES_MAX_FIGURE_ZONES: 24,
  LONG: {
    enable: true,
    direction: 'LONG',
    minRiskRatio: 1.2,
  },
  SHORT: {
    enable: true,
    direction: 'SHORT',
    minRiskRatio: 1.2,
  },
} as const;

export type MSLLiquidityZonesConfig = StrategyConfig &
  Omit<
    typeof config,
    | 'BACKTEST_PRICE_MODE'
    | 'LONG'
    | 'SHORT'
    | 'MSLZONES_SWING_AREA_MODE'
    | 'MSLZONES_FILTER_MODE'
  > & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    LONG: MSLLiquidityZonesSideConfig;
    SHORT: MSLLiquidityZonesSideConfig;
    MSLZONES_SWING_AREA_MODE: MSLLiquidityZonesSwingAreaMode;
    MSLZONES_FILTER_MODE: MSLLiquidityZonesFilterMode;
  };
