import type { Direction } from './trade';
import type { AiPayload } from './strategyAdapters';

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
  payload: AiPayload;
  testId?: string;
  testSuiteId?: string;
  testName?: string;
  configId?: string;
  connectorName?: string;
}
