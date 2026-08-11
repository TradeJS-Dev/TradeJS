export type BacktestJobStatus =
  | 'running'
  | 'pausing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type BacktestPeriodMode = 'days' | 'range';

export interface BacktestJobRequest {
  strategyName: string;
  configId: string;
  periodMode: BacktestPeriodMode;
  days?: number;
  startTime?: number;
  endTime?: number;
  ai: boolean;
  fast: boolean;
  interval: string;
  connector: string;
  tickers?: string;
  tickersLimit?: number;
  testsLimit?: number;
  parallel?: number;
}

export interface BacktestJobProgress {
  completed: number;
  total: number | null;
  percent: number;
  averageProfit: number | null;
  winRate: number | null;
  successTests: number | null;
  errorTests: number | null;
}

export interface BacktestJobRecord {
  id: string;
  userName: string;
  status: BacktestJobStatus;
  request: BacktestJobRequest;
  command: string;
  args: string[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  pausedAt?: string;
  cancelledAt?: string;
  lastHeartbeatAt?: string;
  pid?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  runCount: number;
  progress: BacktestJobProgress;
  logs: string[];
  error?: string;
  pauseReason?: string;
}

export interface BacktestConfigSummary {
  id: string;
  strategyName: string;
  paramCount: number;
  combinationCount: number;
}
