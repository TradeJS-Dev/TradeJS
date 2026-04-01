import type { Direction } from './trade';

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

export interface AiDatasetRow extends AiPromptPair {
  signalId: string;
  strategyName: string;
  symbol: string;
  direction: Direction;
  timestamp: number;
  profit: number;
  testId?: string;
  testSuiteId?: string;
  testName?: string;
  connectorName?: string;
}
