export const MCP_SCOPES = [
  'market:read',
  'runtime:read',
  'backtests:read',
  'backtests:run',
  'diagnostics:read',
  'diagnostics:run',
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export interface McpPrincipal {
  userName: string;
  clientId: string;
  grantId: string;
  scopes: McpScope[];
}

export interface McpJob {
  id: string;
  userName: string;
  clientId: string;
  kind: 'backtest' | 'runtime-evidence' | 'runtime-feedback-replay';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  request: Record<string, unknown>;
  args: string[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  cancelRequested?: boolean;
  error?: string;
  exitCode?: number | null;
  logs: string[];
  outputId: string;
  packageManifestSha256: string;
}
