import { BacktestPriceMode, Direction, Interval, StrategyConfig } from '@types';

export interface PineScriptSideConfig {
  enable: boolean;
  direction: Direction;
  TP: number;
  SL: number;
  minRiskRatio: number;
}

const DEFAULT_PINE_SCRIPT = `//@version=5
indicator("TradeJS Pine MA Cross", overlay=true)

fastLength = input.int(9, "Fast MA")
slowLength = input.int(21, "Slow MA")

fast = ta.sma(close, fastLength)
slow = ta.sma(close, slowLength)

entryLong = fast > slow and fast[1] <= slow[1]
entryShort = fast < slow and fast[1] >= slow[1]

plot(fast, "fast")
plot(slow, "slow")
plot(entryLong ? 1 : 0, "entryLong")
plot(entryShort ? 1 : 0, "entryShort")
`;

export const config = {
  ENV: 'BACKTEST',
  INTERVAL: '15' as Interval,
  MAKE_ORDERS: true,
  CLOSE_OPPOSITE_POSITIONS: false,
  BACKTEST_PRICE_MODE: 'mid' as const,
  AI_ENABLED: false,
  ML_ENABLED: false,
  ML_THRESHOLD: 0.1,
  MIN_AI_QUALITY: 3,
  FEE_PERCENT: 0.005,
  MAX_LOSS_VALUE: 10,
  MAX_CORRELATION: 0.45,
  TRADE_COOLDOWN_MS: 0,
  PINE_SCRIPT: DEFAULT_PINE_SCRIPT,
  PINE_SCRIPT_INPUTS: {} as Record<string, unknown>,
  PINE_LOOKBACK_BARS: 300,
  PINE_ENTRY_LONG_PLOT: 'entryLong',
  PINE_ENTRY_SHORT_PLOT: 'entryShort',
  PINE_EXIT_LONG_PLOT: '',
  PINE_EXIT_SHORT_PLOT: '',
  PINE_LINE_PLOTS: ['fast', 'slow'],
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

export type PineScriptConfig = StrategyConfig &
  Omit<
    typeof config,
    'BACKTEST_PRICE_MODE' | 'LONG' | 'SHORT' | 'PINE_LINE_PLOTS'
  > & {
    BACKTEST_PRICE_MODE: BacktestPriceMode;
    PINE_LINE_PLOTS: readonly string[];
    LONG: PineScriptSideConfig;
    SHORT: PineScriptSideConfig;
  };
