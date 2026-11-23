import type { StrategyConfig } from './backtest';
import type {
  StrategyManifest,
  StrategyRegistryEntry,
} from './strategyAdapters';
import type { Candle, Direction } from './trade';

export interface PortfolioEntryCandidate {
  id: string;
  strategy: string;
  symbol: string;
  direction: Direction;
  stop: number;
  targets: readonly number[];
  gate: {
    approved: boolean;
    reason: string | null;
    rawQuality: number | null;
    explicitHardBlock: boolean;
  };
}

export interface PortfolioEntryBatch {
  closedAt: number;
  candidates: readonly PortfolioEntryCandidate[];
  market: {
    candle(symbol: string, barsAgo: number): Candle | undefined;
  };
}

export interface PortfolioEntrySelection {
  ranked: readonly string[];
  pending: readonly { candidateId: string; confirmAt: number }[];
}

export interface PortfolioReplayExecution {
  maxPositions: number;
  feeRate: number;
  slippageBps: number;
}

export interface PortfolioConfirmation {
  candidate: PortfolioEntryCandidate;
  candle: Candle;
  openingPrice: number;
  minNetRewardToRisk: number;
}

export interface PortfolioChildStrategy {
  entry: StrategyRegistryEntry;
  config: StrategyConfig;
}

export interface PortfolioStrategyEntry<TConfig extends StrategyConfig = any> {
  kind: 'portfolio';
  manifest: StrategyManifest;
  defaults: TConfig;
  parseConfig(input: unknown): TConfig;
  resolveChildren(config: TConfig): readonly PortfolioChildStrategy[];
  selectEntries(batch: PortfolioEntryBatch): PortfolioEntrySelection;
  confirmEntry(
    input: PortfolioConfirmation,
  ): { qty: number; risk: number } | null;
  execution: PortfolioReplayExecution;
}
