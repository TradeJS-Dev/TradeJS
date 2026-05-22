import { FEE_PERCENT } from '@tradejs/core/constants';
import {
  BacktestPriceMode,
  Direction,
  Interval,
  StrategyConfig,
} from '@tradejs/types';

export interface MaStrategySideConfig {
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
  TRADE_COOLDOWN_MS: 0,
  MA_FAST: 21,
  MA_SLOW: 55,
  LONG: {
    enable: true,
    direction: 'LONG',
    TP: 2,
    SL: 1,
    minRiskRatio: 1.5,
  },
  SHORT: {
    enable: true,
    direction: 'SHORT',
    TP: 2,
    SL: 1,
    minRiskRatio: 1.5,
  },
} as const;

export type MaStrategyConfig = StrategyConfig &
  Omit<typeof config, 'BACKTEST_PRICE_MODE' | 'LONG' | 'SHORT'> & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    LONG: MaStrategySideConfig;
    SHORT: MaStrategySideConfig;
  };
