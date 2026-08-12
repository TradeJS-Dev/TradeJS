import type { Direction } from './trade';
import type { AiPayload } from './strategyAdapters';
import type { TestTradeResult } from './backtest';

export interface AIChatMessage {
  from: 'user' | 'ai';
  text: string;
  command?: string;
}

export type AIChatHistory = AIChatMessage[];

export interface AiPromptPair {
  systemPrompt: string;
  humanPrompt: string;
}

export interface AiDatasetRow {
  signalId: string;
  strategyName: string;
  symbol: string;
  direction: Direction;
  timestamp: number;
  profit: number;
  tradeResult?: TestTradeResult;
  payload: AiPayload;
  testId?: string;
  testSuiteId?: string;
  testName?: string;
  configId?: string;
  connectorName?: string;
  backtestRunId?: string;
  backtestTestKey?: string;
  backtestChunkId?: string;
  research?: {
    schema: 'tradejs-core-research-row/v1';
    setupIdentity: string;
    setupIdentitySource: 'strategy-context' | 'signal-time-fallback';
  };
}
