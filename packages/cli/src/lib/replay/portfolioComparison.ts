import { createHash } from 'node:crypto';
import { canonicalJson } from '../coreResearch/io';
import { calendarClusterBootstrap } from '../coreResearch/statistics';
import type { PortfolioReplayDiagnostics } from './historicalSignalsReplayExecution';

type ComparisonMetricRow = {
  window: string;
  scope: string;
  cohort: string;
  n: number;
  pnl: number;
  realizedMaxDrawdown: number;
};

type PortfolioReport = {
  schema: string;
  window: { start: number; end: number };
  lineage: Record<string, unknown>;
  metrics: {
    portfolio: ComparisonMetricRow[];
    strategies: ComparisonMetricRow[];
  };
  trades: Array<{ exitedAt: number; pnl: number }>;
  portfolioDiagnostics?: PortfolioReplayDiagnostics;
  curves: { portfolioDrawdown: Array<{ timestamp: number; value: number }> };
};

type Strategy = {
  strategyName: string;
  effectiveConfig: Record<string, unknown>;
  maxLossValue: number;
};

const key = (value: unknown) => canonicalJson(value);

function longestRecovery(
  points: PortfolioReport['curves']['portfolioDrawdown'],
) {
  let start: number | undefined;
  let lastPeak: number | undefined;
  let longestMs = 0;
  for (const point of points) {
    if (point.value === 0) {
      if (start !== undefined)
        longestMs = Math.max(longestMs, point.timestamp - start);
      start = undefined;
      lastPeak = point.timestamp;
    } else if (start === undefined) start = lastPeak ?? point.timestamp;
  }
  return { longestCompletedMs: longestMs, unresolvedSince: start ?? null };
}

function compareCapacityAdmissions(
  before: PortfolioReplayDiagnostics,
  after: PortfolioReplayDiagnostics,
  changed?: string,
) {
  const count = (
    filled: PortfolioReplayDiagnostics,
    rejected: PortfolioReplayDiagnostics,
  ) => {
    const keys = new Set(
      filled.admissions
        .filter(
          (event) => event.strategy !== changed && event.status === 'filled',
        )
        .map((event) => event.key),
    );
    return new Set(
      rejected.admissions
        .filter(
          (event) =>
            event.status === 'capacity-rejected' && keys.has(event.key),
        )
        .map((event) => event.key),
    ).size;
  };
  return { displaced: count(before, after), restored: count(after, before) };
}

export function comparePortfolioReports(
  input: unknown,
  candidate: PortfolioReport,
) {
  if (!input || typeof input !== 'object' || !('checksum' in input)) {
    throw new Error('Expected a checksum-bound portfolio report');
  }
  const { checksum, ...payload } = input as PortfolioReport & {
    checksum: unknown;
  };
  if (
    checksum !==
      createHash('sha256').update(JSON.stringify(payload)).digest('hex') ||
    payload.schema !== 'tradejs-portfolio-backtest/v1'
  ) {
    throw new Error('Control portfolio report checksum or schema mismatch');
  }
  const control = payload;
  if (
    control.lineage?.batchCount !== 1 ||
    candidate.lineage.batchCount !== 1 ||
    control.lineage.cacheOnly !== true ||
    candidate.lineage.cacheOnly !== true
  ) {
    throw new Error(
      'Portfolio comparison requires two cache-only reports from a single shared batch',
    );
  }
  for (const field of [
    'connector',
    'interval',
    'tickers',
    'candleCoverage',
    'binanceMarketContextRows',
    'maxLossValue',
  ] as const) {
    if (
      candidate.lineage[field] === undefined ||
      key(control.lineage[field]) !== key(candidate.lineage[field])
    ) {
      throw new Error(`Portfolio comparison scope mismatch: ${field}`);
    }
  }
  if (key(control.window) !== key(candidate.window))
    throw new Error('Portfolio comparison window mismatch');
  const before = control.lineage.strategies as Strategy[] | undefined;
  const after = candidate.lineage.strategies as Strategy[] | undefined;
  if (
    !Array.isArray(before) ||
    !Array.isArray(after) ||
    key(before.map((s) => s.strategyName)) !==
      key(after.map((s) => s.strategyName))
  ) {
    throw new Error(
      'Portfolio comparison requires the same ordered strategies',
    );
  }
  const changed = after.filter((s, index) => key(s) !== key(before[index]));
  if (changed.length > 1)
    throw new Error(
      'Portfolio comparison allows at most one strategy replacement',
    );
  if (
    after.some(
      (s, index) =>
        s.maxLossValue !== before[index].maxLossValue ||
        key(s.effectiveConfig.PORTFOLIO_POLICY) !==
          key(before[index].effectiveConfig.PORTFOLIO_POLICY),
    )
  ) {
    throw new Error(
      'Portfolio comparison requires unchanged risk and portfolio policies',
    );
  }
  const all = (report: PortfolioReport) => {
    const row = report.metrics.portfolio.find(
      (r) => r.window === 'full' && r.cohort === 'ALL',
    );
    if (!row) throw new Error('Missing full ALL portfolio metrics');
    return row;
  };
  const a = all(control),
    b = all(candidate);
  const toPnl = (report: PortfolioReport) =>
    report.trades.map((trade) => ({
      exitTimestamp: trade.exitedAt,
      netProfit: trade.pnl,
    }));
  const strategyDelta = candidate.metrics.strategies
    .filter((row) => row.window === 'full')
    .map((row) => {
      const previous = control.metrics.strategies.find(
        (r) =>
          r.window === row.window &&
          r.scope === row.scope &&
          r.cohort === row.cohort,
      );
      return {
        strategy: row.scope,
        cohort: row.cohort,
        trades: previous ? row.n - previous.n : null,
        pnl: previous ? row.pnl - previous.pnl : null,
      };
    });
  const markBefore = control.portfolioDiagnostics?.markedMaxDrawdown ?? null;
  const markAfter = candidate.portfolioDiagnostics?.markedMaxDrawdown ?? null;
  const displacement =
    control.portfolioDiagnostics && candidate.portfolioDiagnostics
      ? compareCapacityAdmissions(
          control.portfolioDiagnostics,
          candidate.portfolioDiagnostics,
          changed[0]?.strategyName,
        )
      : null;
  return {
    controlChecksum: checksum,
    markedDrawdown: {
      control: markBefore,
      candidate: markAfter,
      delta:
        markBefore === null || markAfter === null
          ? null
          : markAfter - markBefore,
    },
    capacityDisplacement: displacement,
    changedStrategy: changed[0]?.strategyName ?? null,
    delta: {
      pnl: b.pnl - a.pnl,
      trades: b.n - a.n,
      realizedMaxDrawdown: b.realizedMaxDrawdown - a.realizedMaxDrawdown,
    },
    recovery: {
      control: longestRecovery(control.curves.portfolioDrawdown),
      candidate: longestRecovery(candidate.curves.portfolioDrawdown),
    },
    strategyDelta,
    bootstrap: calendarClusterBootstrap({
      control: toPnl(control),
      candidate: toPnl(candidate),
      clusterDays: 7,
      iterations: 1000,
      confidenceLevel: 0.95,
      seed: String(checksum),
      start: candidate.window.start,
      end: candidate.window.end,
    }),
    limitations: [
      'Scope and recorded coverage match. Report lineage does not prove equality of every historical source byte.',
      'Marked drawdown uses last observed candle closes at replay cycle boundaries. It does not measure intra-candle excursions.',
      'Capacity displacement counts only identical signals of unchanged strategies filled in one run and explicitly rejected by the position cap in the other.',
    ],
  };
}
