export interface AIChatMessage {
  from: 'user' | 'ai';
  text: string;
  command?: string;
}

export type AIChatHistory = AIChatMessage[];
