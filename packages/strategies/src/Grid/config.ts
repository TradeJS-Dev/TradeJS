import { FEE_PERCENT } from '@tradejs/core/constants';
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/types';

export type GridRangeFilterMode =
  | 'off'
  | 'block_entries'
  | 'block_all'
  | 'edge_all';

export interface GridSideConfig {
  enable: boolean;
  direction: Direction;
}

export type GridEntryMode = 'pullback_recovery' | 'breakout_retest';
export type GridContinuationRiskMode = 'legacy_step' | 'retest_structure';

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
  MA_FAST: 20,
  MA_MEDIUM: 50,
  MA_SLOW: 100,
  OBV_SMA: 10,
  ATR: 14,
  ATR_PCT_SHORT: 7,
  ATR_PCT_LONG: 30,
  BB: 20,
  BB_STD: 2,
  MACD_FAST: 12,
  MACD_SLOW: 26,
  MACD_SIGNAL: 9,
  GRID_FAST_EMA: 20,
  GRID_SLOW_EMA: 55,
  GRID_ATR_PERIOD: 14,
  GRID_TREND_SLOPE_BARS: 5,
  GRID_MIN_TREND_STRENGTH_ATR: 0.15,
  GRID_MAX_TREND_STRENGTH_ATR: 2.5,
  GRID_MIN_SLOW_SLOPE_ATR: 0.04,
  GRID_MIN_ATR_PCT: 0.15,
  GRID_MAX_ATR_PCT: 5,
  GRID_MAX_PULLBACK_BEYOND_SLOW_ATR: 0.5,
  GRID_ENTRY_MODE: 'pullback_recovery' as GridEntryMode,
  GRID_BREAKOUT_LOOKBACK_BARS: 20,
  GRID_BREAKOUT_MIN_DISTANCE_ATR: 0.1,
  GRID_BREAKOUT_ACCEPTANCE_BARS: 1,
  GRID_BREAKOUT_RETEST_MAX_BARS: 4,
  GRID_BREAKOUT_RETEST_TOLERANCE_ATR: 0.3,
  GRID_BREAKOUT_RETEST_MAX_CLOSE_DISTANCE_ATR: 0,
  GRID_CONTINUATION_ALLOW_SCALE_IN: false,
  GRID_CONTINUATION_RISK_MODE: 'legacy_step' as GridContinuationRiskMode,
  GRID_CONTINUATION_STOP_BUFFER_ATR: 0.1,
  GRID_CONTINUATION_MIN_STOP_DISTANCE_ATR: 0.35,
  GRID_CONTINUATION_TARGET_R: 1,
  GRID_STEP_ATR_MULT: 0.8,
  GRID_MIN_STEP_PCT: 0.35,
  GRID_STOP_ATR_MULT: 4.5,
  GRID_TAKE_PROFIT_STEP_MULT: 1,
  GRID_TAKE_PROFIT_STEP_MULT_LONG: 1.25,
  GRID_TAKE_PROFIT_STEP_MULT_SHORT: 1.1,
  GRID_MIN_NET_RISK_RATIO: 0,
  GRID_MAX_LEVELS: 4,
  GRID_MAX_CANDLE_RANGE_ATR: 3,
  GRID_EXIT_ON_REGIME_FLIP: true,
  GRID_EXIT_ON_VOLATILITY_SHOCK: true,
  GRID_ENTRY_COOLDOWN_BARS: 8,
  GRID_PROTECTION_REPRICE_ATR: 0.15,
  GRID_MAX_FIGURE_POINTS: 160,
  GRID_RANGE_FILTER_MODE: 'off' as GridRangeFilterMode,
  GRID_RANGE_PIVOT_LEFT_BARS: 3,
  GRID_RANGE_PIVOT_RIGHT_BARS: 3,
  GRID_RANGE_LOOKBACK_BARS: 96,
  GRID_RANGE_MIN_PIVOTS_PER_SIDE: 2,
  GRID_RANGE_MIN_WIDTH_ATR: 3,
  GRID_RANGE_MAX_WIDTH_ATR: 18,
  GRID_RANGE_MAX_CENTER_SLOPE_ATR_PER_BAR: 0.03,
  GRID_RANGE_MAX_BOUNDARY_DIVERGENCE_ATR: 1,
  GRID_RANGE_MIN_CONTAINMENT_RATIO: 0.75,
  GRID_RANGE_CONTAINMENT_TOLERANCE_ATR: 0.2,
  GRID_RANGE_EDGE_FRACTION: 0.35,
  LONG: {
    enable: true,
    direction: 'LONG',
  },
  SHORT: {
    enable: true,
    direction: 'SHORT',
  },
} as const;

export type GridConfig = StrategyConfig &
  Omit<
    typeof config,
    | 'BACKTEST_PRICE_MODE'
    | 'GRID_ENTRY_MODE'
    | 'GRID_CONTINUATION_RISK_MODE'
    | 'LONG'
    | 'SHORT'
  > & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    GRID_ENTRY_MODE: GridEntryMode;
    GRID_CONTINUATION_RISK_MODE: GridContinuationRiskMode;
    LONG: GridSideConfig;
    SHORT: GridSideConfig;
  };
