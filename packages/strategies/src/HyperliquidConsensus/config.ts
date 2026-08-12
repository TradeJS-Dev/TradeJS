import { FEE_PERCENT } from '@tradejs/core/constants';
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/types';

export interface HyperliquidConsensusSideConfig {
  enable: boolean;
  direction: Direction;
  minRiskRatio: number;
}

export const config = {
  ENV: 'BACKTEST',
  INTERVAL: '5' as Interval,
  MAKE_ORDERS: true,
  CLOSE_OPPOSITE_POSITIONS: false,
  BACKTEST_PRICE_MODE: 'open' as const,
  AI_ENABLED: false,
  AI_MODE: 'llm' as const,
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
  HLC_MIN_UNIQUE_WHALES: 3,
  HLC_MIN_COVERAGE_PCT: 0.8,
  HLC_MIN_POSITION_AWARE_PCT: 0.8,
  HLC_MIN_TOTAL_ENTRY_NOTIONAL_USD: 100_000,
  HLC_MIN_NET_ENTRY_NOTIONAL_USD: 50_000,
  HLC_LONG_MIN_ENTRY_SHARE: 0.62,
  HLC_SHORT_MAX_ENTRY_SHARE: 0.38,
  HLC_MAX_CONTEXT_AGE_MS: 60_000,
  HLC_ENTRY_COOLDOWN_MS: 86_400_000,
  HLC_STOP_ATR_MULT: 1.8,
  HLC_STOP_BUFFER_PCT: 0.2,
  HLC_TARGET_R_MULT: 2,
  HLC_EXIT_ON_OPPOSITE_CONSENSUS: true,
  HLC_EXIT_ON_POSITION_REDUCTION: true,
  HLC_EXIT_MIN_UNIQUE_WHALES: 3,
  HLC_EXIT_MIN_NOTIONAL_USD: 50_000,
  HLC_EXIT_MIN_DIRECTION_SHARE: 0.62,
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

export type HyperliquidConsensusConfig = StrategyConfig &
  Omit<typeof config, 'BACKTEST_PRICE_MODE' | 'LONG' | 'SHORT'> & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    LONG: HyperliquidConsensusSideConfig;
    SHORT: HyperliquidConsensusSideConfig;
  };
