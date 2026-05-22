import { FEE_PERCENT } from '@tradejs/core/constants';
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/types';

export type AdaptiveMomentumRibbonKcMaType =
  | 'SMA'
  | 'EMA'
  | 'SMMA (RMA)'
  | 'WMA'
  | 'VWMA';

export interface AdaptiveMomentumRibbonSideConfig {
  enable: boolean;
  direction: Direction;
  TP: number;
  SL: number;
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
  AMR_LOOKBACK_BARS: 200,
  AMR_MOMENTUM_PERIOD: 32,
  AMR_BUTTERWORTH_SMOOTHING: 4,
  AMR_WAIT_CLOSE: true,
  AMR_CONFIRM_ON_NEXT_BAR: true,
  AMR_MIN_SIGNAL_OSC_ABS: 0.55,
  AMR_REQUIRE_KC_BIAS: true,
  AMR_MIN_BARS_BETWEEN_SIGNALS: 12,
  AMR_SHOW_INVALIDATION_LEVELS: true,
  AMR_SHOW_KELTNER_CHANNEL: true,
  AMR_KC_LENGTH: 20,
  AMR_KC_MA_TYPE: 'EMA' as AdaptiveMomentumRibbonKcMaType,
  AMR_ATR_LENGTH: 14,
  AMR_ATR_MULTIPLIER: 2,
  AMR_EXIT_ON_INVALIDATION: true,
  AMR_LINE_PLOTS: ['kcMidline', 'kcUpper', 'kcLower', 'invalidationLevel'],
  LONG: {
    enable: true,
    direction: 'LONG',
    TP: 2,
    SL: 1,
  },
  SHORT: {
    enable: true,
    direction: 'SHORT',
    TP: 2,
    SL: 1,
  },
} as const;

export type AdaptiveMomentumRibbonConfig = StrategyConfig &
  Omit<
    typeof config,
    'BACKTEST_PRICE_MODE' | 'LONG' | 'SHORT' | 'AMR_LINE_PLOTS'
  > & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    AMR_LINE_PLOTS: readonly string[];
    LONG: AdaptiveMomentumRibbonSideConfig;
    SHORT: AdaptiveMomentumRibbonSideConfig;
  };
