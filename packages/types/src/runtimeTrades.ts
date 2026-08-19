import type { SimpleOrderLogData, StrategyConfig, TestStat } from './backtest';
import type { MarketUniverse } from './market';
import type { RuntimeStrategyControlState } from './runtimeControls';
import type { Interval, RuntimeTradeRecord } from './trade';

export interface RuntimeStrategyTradeSummary {
  totalTrades: number;
  activeTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  activePnl: number;
  closedPnl: number;
  totalPnl: number;
  symbolConcentrationTop1: number | null;
  symbolConcentrationTop5: number | null;
}

export interface RuntimeStrategyTradeView {
  orderId: string;
  symbol: string;
  direction: RuntimeTradeRecord['direction'];
  status: RuntimeTradeRecord['status'];
  qty: number;
  entryTimestamp: number;
  entryPrice: number;
  actualEntryPrice: number | null;
  exitTimestamp: number | null;
  exitPrice: number | null;
  actualExitPrice: number | null;
  currentPrice: number | null;
  pnl: number | null;
  durationHours: number | null;
  entrySlippagePercent: number | null;
  exitSlippagePercent: number | null;
  exitType: RuntimeTradeRecord['exitType'] | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPercent: number | null;
  stopLossPercent: number | null;
  openFee: number | null;
  closeFee: number | null;
  fundingFee: number | null;
  totalFee: number | null;
  lastSyncedAt: number | null;
}

export interface RuntimeStrategyView {
  runtimeKey: string;
  strategyName: string;
  configId: string;
  version: number;
  controlState: RuntimeStrategyControlState;
  interval: Interval;
  universe: MarketUniverse;
  accountId?: string;
  accountLabel?: string;
  deploymentId: string;
  policyProfileId?: string;
  connected: boolean;
  enabled: boolean;
  config: StrategyConfig;
  symbols: string[];
  stat: TestStat;
  summary: RuntimeStrategyTradeSummary;
  orderLog: SimpleOrderLogData;
  recentTrades: RuntimeStrategyTradeView[];
  orders: RuntimeStrategyTradeView[];
}

export interface RuntimeStrategiesResponse {
  provider: string;
  hours: number;
  generatedAt: number;
  dataSources?: {
    localTrades: number;
    exchangeFallbackTrades: number;
    exchangeErrors: string[];
  };
  strategies: RuntimeStrategyView[];
}
