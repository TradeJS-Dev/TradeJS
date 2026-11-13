/** Deployment ID, then strategy name, then the report ID in its installed package. */
export type RuntimeLaunchReportBindings = Record<
  string,
  Record<string, string>
>;

/** Historical backtest evidence used to select a strategy for launch. */
export interface RuntimeLaunchReport {
  schema: 'tradejs-launch-report/v1';
  strategy: string;
  candidate: string;
  sourceSha256: string;
  researchRiskUsdt?: number;
  note?: string;
  period?: { start: number; end: number };
  metrics: {
    trades?: number;
    winRatePercent?: number;
    maxDrawdownDurationDays?: number;
    maxLossStreak?: number;
    maxDrawdown?: number;
    pnl?: number;
    profitFactor?: number;
  };
  chart?: { caption: string; sha256: string };
}

export interface RuntimeLaunchReportResponse {
  report: RuntimeLaunchReport;
  chartUrl?: string;
}
