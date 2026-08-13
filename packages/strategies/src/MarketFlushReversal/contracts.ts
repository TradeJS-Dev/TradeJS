import type { Candle, Direction } from '@tradejs/types';
import type { MarketFlushReversalEntryMode } from './config';

export interface MarketFlushReversalSignalContext {
  signalDirection: Direction;
  marketPressure: string | null;
  marketRiskFlags: string[];
  marketLiqSpikeRatio: number | null;
  marketLiqImbalance: number | null;
  marketFundingZScore: number | null;
  marketPriceOiDivergenceType: string | null;
  marketFlushConfirmed: boolean;
  minMarketLiqSpikeRatio: number;
  rejectionClosePosition: number | null;
  rejectionBodyAtr: number | null;
  rejectionConfirmed: boolean;
  sweepState: string | null;
  breakoutState: string | null;
  tailSide: string | null;
  rangePosition20: number | null;
  sweepWickPct: number | null;
  volumeRel20: number | null;
  buyPressurePct: number | null;
  deltaDivergenceVsPrice: string | null;
  structureConfirmed: boolean;
  participationConfirmed: boolean;
  entryMode?: MarketFlushReversalEntryMode;
  setupTimestamp?: number;
  entryDelayBars?: number;
  priceImprovementAtr?: number | null;
  pendingStopSource?: 'frozen_setup';
  setupSweepExtremePrice?: number | null;
  setupStopAnchorPrice?: number | null;
  setupStopLossPrice?: number;
  confirmationStopLossPrice?: number;
  selectedStopLossPrice?: number;
  setupStopDistanceAtr?: number | null;
  confirmationStopDistanceAtr?: number | null;
  stopDistanceDeltaAtr?: number | null;
}

export interface MarketFlushReversalEntryCandidate {
  direction: Direction;
  setupTimestamp: number;
  setupPrice: number;
  referencePrice: number;
  atr: number;
  stopLossPrice: number;
  setupSweepExtremePrice?: number | null;
  setupStopAnchorPrice?: number | null;
  context: MarketFlushReversalSignalContext;
}

export interface MarketFlushReversalPendingEntry
  extends MarketFlushReversalEntryCandidate {
  ageBars: number;
}

export interface MarketFlushReversalEntrySignal
  extends MarketFlushReversalEntryCandidate {
  entryMode: MarketFlushReversalEntryMode;
  entryTimestamp: number;
  entryDelayBars: number;
  priceImprovementAtr: number | null;
}

export interface MarketFlushReversalEntryEvent {
  candle: Candle;
  candidate: MarketFlushReversalEntryCandidate | null;
}

export interface MarketFlushReversalEntryEngineState {
  pending: MarketFlushReversalPendingEntry | null;
  signal: MarketFlushReversalEntrySignal | null;
  timestamp: number | null;
}
