import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Direction, PositionLogData } from '@tradejs/types';
import type { HistoricalSignalsReplayResult } from './historicalSignalsReplay';

const DAY_MS = 86_400_000;
const WINDOWS = [365, 180, 90, 30, 7] as const;
const COLORS = [
  '#2563eb',
  '#dc2626',
  '#059669',
  '#7c3aed',
  '#ea580c',
  '#0891b2',
  '#c026d3',
  '#4d7c0f',
  '#be123c',
  '#4338ca',
  '#0f766e',
];

export type PortfolioTrade = {
  strategyName: string;
  direction: Direction;
  openedAt: number;
  exitedAt: number;
  pnl: number;
};

export type PortfolioMetricRow = {
  window: string;
  scope: string;
  cohort: 'ALL' | 'LONG' | 'SHORT';
  n: number;
  wins: number;
  losses: number;
  pnl: number;
  pnlPerTrade: number | null;
  profitFactor: number | null;
  winRate: number | null;
  realizedMaxDrawdown: number;
  cadencePerDay: number;
};

type CurvePoint = { timestamp: number; value: number };

const finite = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const round = (value: number, digits = 8) => Number(value.toFixed(digits));

export const tradesFromPositionLog = (
  strategyName: string,
  positionLog: PositionLogData,
): PortfolioTrade[] =>
  positionLog.map((position) => ({
    strategyName,
    direction: position.direction,
    openedAt: position.open.timestamp,
    exitedAt: position.close.timestamp,
    pnl: finite(
      position.netProfit,
      finite(position.close.amount) - finite(position.open.amount),
    ),
  }));

const curveForTrades = (
  trades: PortfolioTrade[],
  start: number,
  end: number,
): CurvePoint[] => {
  let value = 0;
  const realized = [...trades]
    .sort(
      (left, right) =>
        left.exitedAt - right.exitedAt ||
        left.strategyName.localeCompare(right.strategyName),
    )
    .map((trade) => ({
      timestamp: trade.exitedAt,
      value: (value = round(value + trade.pnl)),
    }));
  return [
    { timestamp: start, value: 0 },
    ...realized,
    { timestamp: end, value },
  ];
};

const drawdownCurve = (equity: CurvePoint[]): CurvePoint[] => {
  let peak = 0;
  return equity.map((point) => {
    peak = Math.max(peak, point.value);
    return { timestamp: point.timestamp, value: round(point.value - peak) };
  });
};

const maxDrawdown = (trades: PortfolioTrade[]) => {
  let equity = 0;
  let peak = 0;
  let worst = 0;
  for (const trade of [...trades].sort((a, b) => a.exitedAt - b.exitedAt)) {
    equity += trade.pnl;
    peak = Math.max(peak, equity);
    worst = Math.max(worst, peak - equity);
  }
  return worst;
};

export const calculatePortfolioMetricRow = ({
  trades,
  window,
  scope,
  cohort,
  start,
  end,
}: {
  trades: PortfolioTrade[];
  window: string;
  scope: string;
  cohort: 'ALL' | 'LONG' | 'SHORT';
  start: number;
  end: number;
}): PortfolioMetricRow => {
  const selected = trades.filter(
    (trade) =>
      trade.exitedAt >= start &&
      trade.exitedAt < end &&
      (cohort === 'ALL' || trade.direction === cohort),
  );
  const grossProfit = selected
    .filter((trade) => trade.pnl > 0)
    .reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(
    selected
      .filter((trade) => trade.pnl < 0)
      .reduce((sum, trade) => sum + trade.pnl, 0),
  );
  const pnl = selected.reduce((sum, trade) => sum + trade.pnl, 0);
  const wins = selected.filter((trade) => trade.pnl > 0).length;
  const losses = selected.filter((trade) => trade.pnl <= 0).length;
  const days = Math.max(1, (end - start) / DAY_MS);
  return {
    window,
    scope,
    cohort,
    n: selected.length,
    wins,
    losses,
    pnl: round(pnl),
    pnlPerTrade: selected.length ? round(pnl / selected.length) : null,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : null,
    winRate: selected.length ? round((wins / selected.length) * 100) : null,
    realizedMaxDrawdown: round(maxDrawdown(selected)),
    cadencePerDay: round(selected.length / days),
  };
};

const windowBounds = (start: number, end: number) => [
  { label: 'full', start, end },
  ...WINDOWS.map((days) => ({
    label: `${days}d`,
    start: Math.max(start, end - days * DAY_MS),
    end,
  })),
];

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const display = (value: number | null, digits = 2) =>
  value == null || !Number.isFinite(value) ? 'n/a' : value.toFixed(digits);
const displayPercent = (value: number | null) =>
  value == null || !Number.isFinite(value) ? 'n/a' : `${value.toFixed(1)}%`;

const downsample = (points: CurvePoint[], limit = 2_000) => {
  if (points.length <= limit) return points;
  const result: CurvePoint[] = [];
  const step = (points.length - 1) / (limit - 1);
  for (let index = 0; index < limit; index += 1) {
    result.push(points[Math.round(index * step)]);
  }
  return result;
};

const renderSvg = ({
  title,
  series,
  start,
  end,
}: {
  title: string;
  series: Array<{
    name: string;
    color: string;
    points: CurvePoint[];
    strokeWidth?: number;
  }>;
  start: number;
  end: number;
}) => {
  const width = 1_280;
  const legendColumns = 3;
  const legendRows = Math.max(1, Math.ceil(series.length / legendColumns));
  const height = 640 + legendRows * 20;
  const left = 78;
  const right = 24;
  const top = 58;
  const bottom = 90 + legendRows * 20;
  const allValues = series.flatMap(({ points }) =>
    points.map(({ value }) => value),
  );
  const min = Math.min(0, ...allValues);
  const max = Math.max(0, ...allValues);
  const span = Math.max(1, max - min);
  const timeSpan = Math.max(1, end - start);
  const x = (timestamp: number) =>
    left + ((timestamp - start) / timeSpan) * (width - left - right);
  const y = (value: number) =>
    top + ((max - value) / span) * (height - top - bottom);
  const grid = Array.from({ length: 6 }, (_, index) => {
    const value = max - (span * index) / 5;
    const py = y(value);
    return `<line x1="${left}" y1="${py}" x2="${width - right}" y2="${py}" stroke="#e5e7eb"/><text x="${left - 10}" y="${py + 4}" text-anchor="end" font-size="12" fill="#64748b">${value.toFixed(1)}</text>`;
  }).join('');
  const paths = series
    .map(({ name, color, points, strokeWidth = 2 }) => {
      const sampled = downsample(points);
      const d = sampled
        .map(
          (point, index) =>
            `${index ? 'L' : 'M'}${x(point.timestamp).toFixed(2)},${y(point.value).toFixed(2)}`,
        )
        .join(' ');
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"/><title>${escapeHtml(name)}</title>`;
    })
    .join('');
  const legend = series
    .map(
      ({ name, color }, index) =>
        `<g transform="translate(${left + (index % legendColumns) * 390},${height - 20 - (legendRows - 1 - Math.floor(index / legendColumns)) * 20})"><line x1="0" y1="-4" x2="20" y2="-4" stroke="${color}" stroke-width="3"/><text x="26" y="0" font-size="12" fill="#334155">${escapeHtml(name)}</text></g>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><text x="${left}" y="32" font-size="22" font-family="sans-serif" fill="#0f172a">${escapeHtml(title)}</text><g font-family="sans-serif">${grid}<line x1="${left}" y1="${y(0)}" x2="${width - right}" y2="${y(0)}" stroke="#94a3b8"/>${paths}<text x="${left}" y="${height - bottom + 26}" font-size="12" fill="#64748b">${new Date(start).toISOString().slice(0, 10)}</text><text x="${width - right}" y="${height - bottom + 26}" text-anchor="end" font-size="12" fill="#64748b">${new Date(end).toISOString().slice(0, 10)}</text>${legend}</g></svg>`;
};

const metricTable = (rows: PortfolioMetricRow[]) => {
  const body = rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.window)}</td><td>${escapeHtml(row.scope)}</td><td>${row.cohort}</td><td>${row.n}</td><td>${display(row.pnl)}</td><td>${display(row.pnlPerTrade)}</td><td>${display(row.profitFactor)}</td><td>${displayPercent(row.winRate)}</td><td>${display(row.realizedMaxDrawdown)}</td><td>${display(row.cadencePerDay, 3)}</td></tr>`,
    )
    .join('');
  return `<table><thead><tr><th>Window</th><th>Scope</th><th>Cohort</th><th>N</th><th>PnL</th><th>PnL/trade</th><th>PF</th><th>WR</th><th>Realized MaxDD</th><th>Cadence/day</th></tr></thead><tbody>${body}</tbody></table>`;
};

const markdownTable = (rows: PortfolioMetricRow[]) =>
  [
    '| Window | Scope | Cohort | N | PnL | PnL/trade | PF | WR | Realized MaxDD | Cadence/day |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map(
      (row) =>
        `| ${row.window} | ${row.scope} | ${row.cohort} | ${row.n} | ${display(row.pnl)} | ${display(row.pnlPerTrade)} | ${display(row.profitFactor)} | ${displayPercent(row.winRate)} | ${display(row.realizedMaxDrawdown)} | ${display(row.cadencePerDay, 3)} |`,
    ),
  ].join('\n');

export const writePortfolioReport = async ({
  projectRoot,
  timestamp,
  replayResult,
  window,
  lineage,
  command,
}: {
  projectRoot: string;
  timestamp: string;
  replayResult: HistoricalSignalsReplayResult;
  window: { start: number; end: number };
  lineage: Record<string, unknown>;
  command: string;
}) => {
  const outputDir = path.resolve(projectRoot, 'data/replay/output');
  await fs.mkdir(outputDir, { recursive: true });
  const trades = replayResult.strategies.flatMap((strategy) =>
    tradesFromPositionLog(strategy.strategyName, strategy.positionLog),
  );
  const bounds = windowBounds(window.start, window.end);
  const portfolioRows = bounds.flatMap((bound) =>
    (['ALL', 'LONG', 'SHORT'] as const).map((cohort) =>
      calculatePortfolioMetricRow({
        trades,
        window: bound.label,
        scope: 'PORTFOLIO',
        cohort,
        start: bound.start,
        end: bound.end,
      }),
    ),
  );
  const strategyRows = bounds.flatMap((bound) =>
    replayResult.strategies.map((strategy) =>
      calculatePortfolioMetricRow({
        trades: trades.filter(
          (trade) => trade.strategyName === strategy.strategyName,
        ),
        window: bound.label,
        scope: strategy.strategyName,
        cohort: 'ALL',
        start: bound.start,
        end: bound.end,
      }),
    ),
  );
  const portfolioEquity = curveForTrades(trades, window.start, window.end);
  const strategySeries = replayResult.strategies.flatMap((strategy, index) => {
    const strategyTrades = trades.filter(
      (trade) => trade.strategyName === strategy.strategyName,
    );
    return strategyTrades.length
      ? [
          {
            name: strategy.strategyName,
            color: COLORS[index % COLORS.length],
            points: curveForTrades(strategyTrades, window.start, window.end),
          },
        ]
      : [];
  });
  const equitySvg = renderSvg({
    title: 'Portfolio and strategy realized PnL overlay',
    series: [
      {
        name: 'PORTFOLIO',
        color: '#111827',
        points: portfolioEquity,
        strokeWidth: 3,
      },
      ...strategySeries,
    ],
    start: window.start,
    end: window.end,
  });
  const drawdownSvg = renderSvg({
    title: 'Aggregate portfolio realized drawdown',
    series: [
      {
        name: 'PORTFOLIO',
        color: '#111827',
        points: drawdownCurve(portfolioEquity),
      },
    ],
    start: window.start,
    end: window.end,
  });
  const prefix = `${timestamp}-portfolio-backtest`;
  const paths = {
    markdown: path.join(outputDir, `${prefix}.md`),
    json: path.join(outputDir, `${prefix}.json`),
    equitySvg: path.join(outputDir, `${prefix}-equity.svg`),
    drawdownSvg: path.join(outputDir, `${prefix}-drawdown.svg`),
    html: path.join(outputDir, `${prefix}.html`),
  };
  const report = {
    schema: 'tradejs-portfolio-backtest/v1',
    generatedAt: new Date().toISOString(),
    command,
    window: {
      start: window.start,
      end: window.end,
      startIso: new Date(window.start).toISOString(),
      endIso: new Date(window.end).toISOString(),
    },
    lineage,
    counts: {
      strategies: replayResult.strategies.length,
      signals: replayResult.signals.length,
      completedTrades: trades.length,
    },
    metrics: { portfolio: portfolioRows, strategies: strategyRows },
    curves: {
      portfolioEquity,
      portfolioDrawdown: drawdownCurve(portfolioEquity),
      strategies: strategySeries.map(({ name, points }) => ({ name, points })),
    },
    trades,
  };
  const checksum = createHash('sha256')
    .update(JSON.stringify(report))
    .digest('hex');
  const semantics =
    'Production strategy order, at most one open position per symbol, and fixed-risk symbol batches merged by canonical realized PnL.';
  const markdown = `# Portfolio Backtest\n\n- Window: ${report.window.startIso} .. ${report.window.endIso}\n- Strategies: ${report.counts.strategies}\n- Signals: ${report.counts.signals}\n- Completed trades: ${report.counts.completedTrades}\n- Portfolio semantics: ${semantics}\n- Report checksum: \`${checksum}\`\n- Command: \`${command}\`\n\n![Strategy PnL overlay](./${path.basename(paths.equitySvg)})\n\n![Portfolio drawdown](./${path.basename(paths.drawdownSvg)})\n\n## Portfolio metrics\n\n${markdownTable(portfolioRows)}\n\n## Strategy metrics\n\n${markdownTable(strategyRows)}\n`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Portfolio Backtest</title><style>body{font-family:Inter,system-ui,sans-serif;margin:32px;color:#0f172a}h1,h2{margin-top:32px}.meta{color:#475569}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:8px;border:1px solid #e2e8f0;text-align:right}th:nth-child(-n+3),td:nth-child(-n+3){text-align:left}.chart{overflow:auto;border:1px solid #e2e8f0;margin:16px 0}</style></head><body><h1>Portfolio Backtest</h1><p class="meta">${escapeHtml(report.window.startIso)} .. ${escapeHtml(report.window.endIso)} · ${report.counts.strategies} strategies · ${trades.length} completed trades · MAX_LOSS_VALUE=${escapeHtml(String(lineage.maxLossValue))}</p><p class="meta">${escapeHtml(semantics)}</p><div class="chart">${equitySvg}</div><div class="chart">${drawdownSvg}</div><h2>Portfolio metrics</h2>${metricTable(portfolioRows)}<h2>Strategy metrics</h2>${metricTable(strategyRows)}<h2>Lineage</h2><pre>${escapeHtml(JSON.stringify(lineage, null, 2))}</pre></body></html>`;
  await Promise.all([
    fs.writeFile(paths.markdown, markdown, 'utf8'),
    fs.writeFile(
      paths.json,
      `${JSON.stringify({ ...report, checksum }, null, 2)}\n`,
      'utf8',
    ),
    fs.writeFile(paths.equitySvg, equitySvg, 'utf8'),
    fs.writeFile(paths.drawdownSvg, drawdownSvg, 'utf8'),
    fs.writeFile(paths.html, html, 'utf8'),
  ]);
  return { ...paths, checksum };
};
