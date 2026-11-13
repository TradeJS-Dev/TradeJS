export type DiagnosticReport = {
  id: string;
  deploymentId: string;
  label: string;
  window: { startTime: number; endTime: number };
};

type Trade = {
  time?: number;
  price?: number;
  exitPrice?: number;
  pnl?: number;
  quantity?: number;
  signalId?: string;
  orderId?: string;
};

export type ComparisonCase = {
  id: string;
  category: 'matched' | 'runtimeOnly' | 'backtestOnly';
  strategy: string;
  symbol: string;
  direction?: string;
  interval?: string;
  universe: 'crypto' | 'tradfi';
  time: number;
  runtime: Trade | null;
  replay: Trade | null;
  classification?: string;
  reason?: string;
  decision?: string;
  evaluationId?: string;
};

export type StrategyComparison = {
  deployment?: string;
  provider: string;
  strategies: Array<{
    name: string;
    matched: number;
    runtimeOnly: number;
    backtestOnly: number;
  }>;
  cases: ComparisonCase[];
};
