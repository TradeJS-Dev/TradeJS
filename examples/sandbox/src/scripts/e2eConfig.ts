export const SANDBOX_E2E_USER = 'sandbox';
export const SANDBOX_E2E_PASSWORD = 'sandbox';
export const SANDBOX_E2E_TOKEN = 'sandbox-token';

export const SANDBOX_E2E_STRATEGY = 'SandboxDeterministicSignal';
export const SANDBOX_E2E_BACKTEST_CONFIG = 'SandboxDeterministicSignal:base';
export const SANDBOX_E2E_DEPLOYMENT = 'sandbox-forward';
export const SANDBOX_E2E_ACCOUNT = 'sandbox-account';

export const SANDBOX_E2E_CONNECTOR_PROVIDER = 'sandbox';
export const SANDBOX_E2E_TICKER = 'SANDBOX';
export const SANDBOX_E2E_SYMBOL = `${SANDBOX_E2E_TICKER}USDT`;
export const SANDBOX_E2E_TIMEFRAME = '15';

export const SANDBOX_E2E_GRID_CONFIG = {
  INTERVAL: ['15'],
  SANDBOX_ENTRY_EVERY_BARS: [96],
  SANDBOX_QTY: [1],
  SANDBOX_TP_PCT: [0.4],
  SANDBOX_SL_PCT: [1],
} as const;

export interface ExpectedSandboxSnapshot {
  orders: number;
  wins: number;
  losses: number;
  amount: number;
  netProfit: number;
  winRate: number;
  maxDrawdown: number;
}

export interface ExpectedSandboxSignalsSnapshot {
  signalBucketCount: number;
  storeSignalsCount: number;
  strategy: string;
  symbol: string;
  direction: string;
  interval: string;
}

export const SANDBOX_E2E_STRATEGY_CONFIG = {
  INTERVAL: SANDBOX_E2E_TIMEFRAME,
  UNIVERSE: 'crypto',
  SANDBOX_ENTRY_EVERY_BARS: 1,
  SANDBOX_QTY: 1,
  SANDBOX_TP_PCT: 0.4,
  SANDBOX_SL_PCT: 1,
} as const;

export const SANDBOX_E2E_EXPECTED: ExpectedSandboxSnapshot = {
  orders: 159,
  wins: 0,
  losses: 159,
  amount: 98.85,
  netProfit: -1.15,
  winRate: 0,
  maxDrawdown: 1.15,
};

export const SANDBOX_E2E_SIGNALS_EXPECTED: ExpectedSandboxSignalsSnapshot = {
  signalBucketCount: 1,
  storeSignalsCount: 1,
  strategy: SANDBOX_E2E_STRATEGY,
  symbol: SANDBOX_E2E_SYMBOL,
  direction: 'LONG',
  interval: SANDBOX_E2E_TIMEFRAME,
};
