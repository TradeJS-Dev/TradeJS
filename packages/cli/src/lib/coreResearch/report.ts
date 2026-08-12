import type {
  CoreResearchComparison,
  CoreResearchResult,
  CoreResearchSpec,
  CoreResearchTrade,
  CoreResearchVariantAnalysis,
  CoreResearchWindowMetrics,
} from './types';
import { orderCoreResearchTrades } from './metrics';

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const format = (value: number | null, digits = 2) =>
  value == null || !Number.isFinite(value) ? 'n/a' : value.toFixed(digits);

const tone = (value: number | null) =>
  value == null ? '' : value > 0 ? 'positive' : value < 0 ? 'negative' : '';

const metricRows = (
  variant: CoreResearchVariantAnalysis,
  window: CoreResearchWindowMetrics,
) =>
  (['ALL', 'LONG', 'SHORT'] as const)
    .map((cohort) => {
      const metrics = window.cohorts[cohort];
      return `<tr><td>${escapeHtml(variant.variant.label)}</td><td>${escapeHtml(window.label)}</td><td>${cohort}</td><td>${metrics.trades}</td><td class="${tone(metrics.pnl)}">${format(metrics.pnl)}</td><td class="${tone(metrics.pnlPerTrade)}">${format(metrics.pnlPerTrade, 4)}</td><td>${format(metrics.profitFactor, 4)}</td><td>${format(metrics.winRatePct)}%</td><td>${format(metrics.realizedMaxDrawdown)}</td><td>${format(metrics.cadencePerDay, 3)}</td><td>${format(metrics.averageWin)}</td><td>${format(metrics.averageLoss)}</td><td>${format(metrics.payoffRatio, 3)}</td><td>${format(metrics.medianPnl)}</td><td>${format(metrics.pnlP05)}</td><td>${format(metrics.pnlP95)}</td><td>${format(metrics.medianHoldingHours, 2)}</td><td>${metrics.maximumConsecutiveLosses}</td></tr>`;
    })
    .join('');

const equitySeries = (trades: CoreResearchTrade[]) => {
  let equity = 0;
  return orderCoreResearchTrades(trades).map((trade) => {
    equity += trade.netProfit;
    return { timestamp: trade.exitTimestamp, value: equity };
  });
};

const drawdownSeries = (trades: CoreResearchTrade[]) => {
  let equity = 0;
  let peak = 0;
  return orderCoreResearchTrades(trades).map((trade) => {
    equity += trade.netProfit;
    peak = Math.max(peak, equity);
    return { timestamp: trade.exitTimestamp, value: peak - equity };
  });
};

const MAX_CHART_POINTS = 1_200;

const downsampleCurve = (
  points: Array<{ timestamp: number; value: number }>,
) => {
  if (points.length <= MAX_CHART_POINTS) return points;
  const interior = points.slice(1, -1);
  const bucketCount = Math.max(1, Math.floor((MAX_CHART_POINTS - 2) / 2));
  const bucketSize = Math.ceil(interior.length / bucketCount);
  const selected = [points[0]];
  for (let start = 0; start < interior.length; start += bucketSize) {
    const bucket = interior.slice(start, start + bucketSize);
    if (!bucket.length) continue;
    const minimum = bucket.reduce((best, point) =>
      point.value < best.value ? point : best,
    );
    const maximum = bucket.reduce((best, point) =>
      point.value > best.value ? point : best,
    );
    const extrema = minimum === maximum ? [minimum] : [minimum, maximum];
    selected.push(
      ...extrema.sort((left, right) => left.timestamp - right.timestamp),
    );
  }
  selected.push(points.at(-1)!);
  return selected;
};

const buildCurveSvg = (
  tradesByVariant: Map<string, CoreResearchTrade[]>,
  cohort: 'ALL' | 'LONG' | 'SHORT',
  curve: 'equity' | 'drawdown',
) => {
  const colors = ['#78dce8', '#ff6188', '#a9dc76', '#ffd866', '#ab9df2'];
  const series = [...tradesByVariant.entries()].map(([id, trades], index) => ({
    id,
    color: colors[index % colors.length],
    points: downsampleCurve(
      (curve === 'equity' ? equitySeries : drawdownSeries)(
        cohort === 'ALL'
          ? trades
          : trades.filter((trade) => trade.direction === cohort),
      ),
    ),
  }));
  const points = series.flatMap((entry) => entry.points);
  if (!points.length) return '<p>No completed trades.</p>';
  const minTimestamp = Math.min(...points.map((point) => point.timestamp));
  const maxTimestamp = Math.max(...points.map((point) => point.timestamp));
  const minValue = Math.min(0, ...points.map((point) => point.value));
  const maxValue = Math.max(0, ...points.map((point) => point.value));
  const width = 960;
  const height = 300;
  const padding = 30;
  const x = (timestamp: number) =>
    padding +
    ((timestamp - minTimestamp) / Math.max(1, maxTimestamp - minTimestamp)) *
      (width - 2 * padding);
  const y = (value: number) =>
    height -
    padding -
    ((value - minValue) / Math.max(1e-9, maxValue - minValue)) *
      (height - 2 * padding);
  const zeroY = y(0);
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${cohort} ${curve}"><line x1="${padding}" x2="${width - padding}" y1="${zeroY}" y2="${zeroY}" class="zero"/>${series
    .map(
      (entry) =>
        `<polyline fill="none" stroke="${entry.color}" stroke-width="2" points="${entry.points.map((point) => `${x(point.timestamp).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ')}"><title>${escapeHtml(entry.id)}</title></polyline>`,
    )
    .join(
      '',
    )}</svg><div class="legend">${series.map((entry) => `<span><i style="background:${entry.color}"></i>${escapeHtml(entry.id)}</span>`).join('')}</div>`;
};

const comparisonCards = (comparisons: CoreResearchComparison[]) =>
  comparisons
    .map(
      (comparison) =>
        `<article class="card"><h3>${escapeHtml(comparison.candidateId)} vs ${escapeHtml(comparison.controlId)}</h3><p class="verdict ${comparison.selection.passed ? 'positive' : 'negative'}">${comparison.selection.passed ? 'PASS selection' : 'REJECT selection'}</p><dl><dt>Matched</dt><dd>${comparison.matched}</dd><dt>Control only</dt><dd>${comparison.controlOnly}</dd><dt>Candidate only</dt><dd>${comparison.candidateOnly}</dd><dt>Identity retained</dt><dd>${format(comparison.matchedIdentityPctOfControl)}%</dd><dt>Matched ΔPnL</dt><dd>${format(comparison.cohorts.ALL.matchedPnlDelta)}</dd><dt>Removed control PnL</dt><dd>${format(comparison.cohorts.ALL.controlOnlyPnl)}</dd><dt>Added candidate PnL</dt><dd>${format(comparison.cohorts.ALL.candidateOnlyPnl)}</dd><dt>Aggregate ΔPnL</dt><dd>${format(comparison.cohorts.ALL.delta.pnl)}</dd><dt>Aggregate ΔDD</dt><dd>${format(comparison.cohorts.ALL.delta.realizedMaxDrawdown)}</dd><dt>Bootstrap P(Δ&gt;0)</dt><dd>${format(comparison.bootstrap.probabilityPositive, 4)}</dd><dt>Holm p</dt><dd>${format(comparison.bootstrap.holmAdjustedPValue, 4)}</dd></dl><p>${comparison.selection.failedRules.length ? escapeHtml(comparison.selection.failedRules.map((rule) => `${rule.scope}.${rule.metric} ${rule.expected}`).join('; ')) : 'All preregistered rules passed.'}</p></article>`,
    )
    .join('');

const regimeRows = (variants: CoreResearchVariantAnalysis[]) => {
  const keys = [
    ...new Set(variants.flatMap((variant) => Object.keys(variant.regimes))),
  ].sort();
  return keys
    .flatMap((key) =>
      variants.map((variant) => {
        const metrics = variant.regimes[key]?.ALL;
        return `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(variant.variant.label)}</td><td>${metrics?.trades ?? 0}</td><td class="${tone(metrics?.pnl ?? null)}">${format(metrics?.pnl ?? null)}</td><td>${format(metrics?.profitFactor ?? null, 3)}</td><td>${format(metrics?.winRatePct ?? null)}%</td></tr>`;
      }),
    )
    .join('');
};

const traceRows = (variants: CoreResearchVariantAnalysis[]) =>
  variants
    .map(
      (variant) =>
        `<tr><td>${escapeHtml(variant.variant.label)}</td><td>${escapeHtml(variant.reconciliation.status)}</td><td>${escapeHtml(JSON.stringify(variant.setupIdentitySources))}</td><td>${escapeHtml(JSON.stringify(variant.traceFunnel.events))}</td><td>${escapeHtml(JSON.stringify(variant.traceFunnel.skipCounts))}</td><td>${escapeHtml(variant.latestSignalTimeRegime?.key ?? 'n/a')}</td></tr>`,
    )
    .join('');

export const buildCoreResearchHtml = (params: {
  spec: CoreResearchSpec;
  result: CoreResearchResult;
  tradesByVariant: Map<string, CoreResearchTrade[]>;
}) => {
  const { spec, result, tradesByVariant } = params;
  const allRows = result.variants
    .flatMap((variant) =>
      [variant.full, ...variant.terminal].map((window) =>
        metricRows(variant, window),
      ),
    )
    .join('');
  const robustnessRows = result.variants
    .flatMap((variant) =>
      [...variant.folds, ...variant.monthly].map((window) =>
        metricRows(variant, window),
      ),
    )
    .join('');
  const costRows = result.variants
    .flatMap((variant) =>
      variant.costStress.map((stress) => {
        const metrics = stress.cohorts.ALL;
        return `<tr><td>${escapeHtml(variant.variant.label)}</td><td>${stress.extraRoundTripBps}</td><td>${metrics.trades}</td><td class="${tone(metrics.pnl)}">${format(metrics.pnl)}</td><td>${format(metrics.pnlPerTrade, 4)}</td><td>${format(metrics.profitFactor, 4)}</td><td>${format(metrics.realizedMaxDrawdown)}</td></tr>`;
      }),
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(spec.researchId)}</title><style>:root{color-scheme:dark;--bg:#17171f;--panel:#22222d;--line:#3a3a49;--text:#f8f8f2;--muted:#a9a9b5;--good:#a9dc76;--bad:#ff6188}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}main{max-width:1240px;margin:auto;padding:28px}h1{font-size:30px}h2{margin-top:36px}.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px}.positive{color:var(--good)}.negative{color:var(--bad)}dl{display:grid;grid-template-columns:1fr auto;gap:6px;margin:0}dt{color:var(--muted)}dd{margin:0}table{border-collapse:collapse;width:100%;font-size:12px;background:var(--panel)}th,td{padding:7px 9px;border:1px solid var(--line);text-align:right}th{text-align:center;position:sticky;top:0;background:#292936}td:nth-child(-n+3){text-align:left}.scroll{overflow:auto;max-height:600px}svg{width:100%;background:var(--panel);border:1px solid var(--line);border-radius:10px}.zero{stroke:#777;stroke-dasharray:4 4}.legend{display:flex;gap:16px;margin:7px}.legend i{display:inline-block;width:12px;height:3px;margin-right:6px;vertical-align:middle}.evidence{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.evidence span{padding:9px;border:1px solid var(--line);border-radius:6px}</style></head><body><main><header><p class="muted">${escapeHtml(result.schema)} · ${escapeHtml(result.generatedAt)}</p><h1>${escapeHtml(spec.researchId)}</h1><p>${escapeHtml(spec.hypothesis.claim)}</p><p class="muted">Mechanism: ${escapeHtml(spec.hypothesis.mechanism)} · stage=${spec.stage} · target=${spec.hypothesis.target} · spec=${result.specSha256}</p></header><h2>Selection</h2><section class="grid">${comparisonCards(result.comparisons)}</section><h2>Evidence matrix</h2><section class="evidence">${Object.entries(
    result.evidence,
  )
    .map(
      ([key, value]) =>
        `<span class="${value === 'present' ? 'positive' : 'negative'}">${escapeHtml(key)}: ${value}</span>`,
    )
    .join(
      '',
    )}</section><h2>ALL equity</h2>${buildCurveSvg(tradesByVariant, 'ALL', 'equity')}<h2>ALL realized drawdown</h2>${buildCurveSvg(tradesByVariant, 'ALL', 'drawdown')}<h2>LONG equity</h2>${buildCurveSvg(tradesByVariant, 'LONG', 'equity')}<h2>LONG realized drawdown</h2>${buildCurveSvg(tradesByVariant, 'LONG', 'drawdown')}<h2>SHORT equity</h2>${buildCurveSvg(tradesByVariant, 'SHORT', 'equity')}<h2>SHORT realized drawdown</h2>${buildCurveSvg(tradesByVariant, 'SHORT', 'drawdown')}<h2>Fixed cohort metrics</h2><p class="muted">Avg PnL/trade = cohort PnL / cohort N. ALL drawdown is aggregate portfolio; LONG/SHORT drawdowns are side-only.</p><div class="scroll"><table><thead><tr><th>Variant</th><th>Window</th><th>Cohort</th><th>N</th><th>PnL</th><th>Avg PnL/trade</th><th>PF</th><th>WR</th><th>Realized DD</th><th>Cad/day</th><th>Avg win</th><th>Avg loss</th><th>Payoff</th><th>Median</th><th>P05</th><th>P95</th><th>Median hold h</th><th>Max loss streak</th></tr></thead><tbody>${allRows}</tbody></table></div><h2>Fold and monthly robustness</h2><div class="scroll"><table><thead><tr><th>Variant</th><th>Window</th><th>Cohort</th><th>N</th><th>PnL</th><th>Avg PnL/trade</th><th>PF</th><th>WR</th><th>Realized DD</th><th>Cad/day</th><th>Avg win</th><th>Avg loss</th><th>Payoff</th><th>Median</th><th>P05</th><th>P95</th><th>Median hold h</th><th>Max loss streak</th></tr></thead><tbody>${robustnessRows}</tbody></table></div><h2>Cost stress</h2><div class="scroll"><table><thead><tr><th>Variant</th><th>Extra round-trip bps</th><th>N</th><th>PnL</th><th>Avg PnL/trade</th><th>PF</th><th>Realized DD</th></tr></thead><tbody>${costRows}</tbody></table></div><h2>Signal-time market regimes</h2><div class="scroll"><table><thead><tr><th>Trend | Volatility | Breadth | Derivatives</th><th>Variant</th><th>N</th><th>PnL</th><th>PF</th><th>WR</th></tr></thead><tbody>${regimeRows(result.variants)}</tbody></table></div><h2>Trace funnel and reconciliation</h2><div class="scroll"><table><thead><tr><th>Variant</th><th>Reconcile</th><th>Setup identity source</th><th>Events</th><th>Top skips</th><th>Latest signal-time regime</th></tr></thead><tbody>${traceRows(result.variants)}</tbody></table></div><h2>Multiple testing / overfitting</h2><pre>${escapeHtml(JSON.stringify({ multipleTesting: result.multipleTesting, overfittingDiagnostics: result.overfittingDiagnostics }, null, 2))}</pre><h2>Lineage</h2><pre>${escapeHtml(JSON.stringify({ stage: spec.stage, universeSha256: spec.universe.sha256, lineage: spec.lineage ?? null, artifactHashes: result.artifactHashes }, null, 2))}</pre></main></body></html>`;
};
