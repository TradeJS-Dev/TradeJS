import { FEE_PERCENT } from '@tradejs/core/constants';
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/types';

export type LiquidityZonesSwingAreaMode = 'wick_extremity' | 'full_range';
export type LiquidityZonesFilterMode = 'count' | 'volume';

export interface LiquidityZonesSideConfig {
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
  LIQUIDITY_ZONES_PIVOT_LOOKBACK: 15,
  LIQUIDITY_ZONES_SWING_AREA_MODE: 'wick_extremity' as const,
  LIQUIDITY_ZONES_FILTER_MODE: 'count' as const,
  LIQUIDITY_ZONES_MIN_FILTER_VALUE: 0,
  LIQUIDITY_ZONES_SHOW_SWING_HIGH_ZONES: true,
  LIQUIDITY_ZONES_SHOW_SWING_LOW_ZONES: true,
  LIQUIDITY_ZONES_MAX_AGE: 500,
  LIQUIDITY_ZONES_MIN_ZONE_AGE: 0,
  LIQUIDITY_ZONES_REACTION_CLOSE_BEYOND_ZONE: true,
  LIQUIDITY_ZONES_REQUIRE_REACTION_BODY: true,
  LIQUIDITY_ZONES_MAX_RETEST_PENETRATION_PCT: 125,
  LIQUIDITY_ZONES_MIN_REACTION_CLOSE_DISTANCE_PCT: 0,
  LIQUIDITY_ZONES_STOP_ZONE_BUFFER_MULT: 0.2,
  LIQUIDITY_ZONES_STOP_BUFFER_PCT: 0.03,
  LIQUIDITY_ZONES_TARGET_R_MULT: 2,
  LIQUIDITY_ZONES_EXIT_ON_OPPOSITE_RETEST: true,
  LIQUIDITY_ZONES_MAX_FIGURE_ZONES: 24,
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

export type LiquidityZonesConfig = StrategyConfig &
  Omit<
    typeof config,
    | 'BACKTEST_PRICE_MODE'
    | 'LONG'
    | 'SHORT'
    | 'LIQUIDITY_ZONES_SWING_AREA_MODE'
    | 'LIQUIDITY_ZONES_FILTER_MODE'
  > & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    LONG: LiquidityZonesSideConfig;
    SHORT: LiquidityZonesSideConfig;
    LIQUIDITY_ZONES_SWING_AREA_MODE: LiquidityZonesSwingAreaMode;
    LIQUIDITY_ZONES_FILTER_MODE: LiquidityZonesFilterMode;
  };
