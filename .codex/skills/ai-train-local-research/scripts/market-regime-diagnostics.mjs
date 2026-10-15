// Explanatory cohorts of frozen approvals. Never refits a gate or reranks capacity.
const DAY = 86400000;
const finite = (x) => typeof x === 'number' && Number.isFinite(x);

export function validateRegimeStudy(spec) {
  if (!spec || !Array.isArray(spec.dimensions) || !Array.isArray(spec.periods))
    throw new Error('Regime study requires dimensions and periods');
  const ids = new Set();
  for (const d of spec.dimensions) {
    if (!d.id || ids.has(d.id) || typeof d.path !== 'string')
      throw new Error('Invalid/duplicate regime dimension');
    ids.add(d.id);
    if (
      /(?:^|\.)(?:[^.]*GateFeatures|quality|profit|timestamp|coverage|available|points|rows)(?:\.|$)/i.test(
        d.path,
      )
    )
      throw new Error('Regime dimension must be a signal-time market feature');
    if (d.edges) {
      if (
        !d.edges.every(finite) ||
        d.edges.some((v, i) => i && v <= d.edges[i - 1])
      )
        throw new Error('Regime edges must be finite and strictly increasing');
    } else if (!Array.isArray(d.categories) || !d.categories.length)
      throw new Error('Regime dimension requires edges or categories');
  }
  const periods = new Set();
  for (const p of spec.periods) {
    if (
      !p.id ||
      periods.has(p.id) ||
      !finite(p.start) ||
      !finite(p.end) ||
      p.start >= p.end
    )
      throw new Error('Invalid/duplicate regime period');
    periods.add(p.id);
  }
  return spec;
}

export const savedSnapshotStatus = (value) =>
  value === undefined
    ? 'missing'
    : value === null
      ? 'null'
      : !finite(value)
        ? 'invalid-or-nonnumeric'
        : value === 0
          ? 'zero'
          : value > 0
            ? 'positive'
            : 'negative';

export function regimeBucket(value, dimension) {
  if (value == null || (typeof value === 'number' && !finite(value)))
    return 'missing';
  if (dimension.edges) {
    if (!finite(value)) return 'missing';
    const i = dimension.edges.findIndex((edge) => value < edge);
    const n = i === -1 ? dimension.edges.length : i;
    return `[${n ? dimension.edges[n - 1] : '-inf'},${n < dimension.edges.length ? dimension.edges[n] : '+inf'})`;
  }
  return dimension.categories.includes(value) ? String(value) : 'other';
}

function bucketLabels(d) {
  return d.edges
    ? Array.from(
        { length: d.edges.length + 1 },
        (_, i) =>
          `[${i ? d.edges[i - 1] : '-inf'},${i < d.edges.length ? d.edges[i] : '+inf'})`,
      ).concat('missing')
    : d.categories.map(String).concat('other', 'missing');
}

export function buildMarketRegimeDiagnostics({
  rows,
  selectors,
  spec,
  summarizeRows,
  summaryOptions = {},
}) {
  validateRegimeStudy(spec);
  const realized = new Map();
  for (const r of rows) {
    const t = r.completedTrade;
    if (
      !finite(t?.exitTimestamp) ||
      t.exitTimestamp < r.timestamp ||
      !finite(t.netProfit)
    )
      throw new Error('Regime analysis requires complete valid trade outcomes');
    realized.set(r, { ...r, timestamp: t.exitTimestamp, profit: t.netProfit });
  }
  const metrics = (group, start, end) => {
    const days = Math.max((end - start) / DAY, 1);
    const ordered = group
      .map((r) => realized.get(r))
      .sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence);
    const options = {
      ...summaryOptions,
      denominatorDays: days,
      calendarDays: Math.ceil(days),
    };
    const decision = summarizeRows(group, days, options);
    const completed = summarizeRows(ordered, days, options);
    const exits = {};
    let grossBeforeFees = 0,
      fees = 0,
      slippageEmbeddedInGross = 0,
      costMissing = 0;
    const durations = { win: [], loss: [] };
    for (const r of group) {
      const t = r.completedTrade;
      const reason = t.exitReason ?? 'missing';
      const e = (exits[reason] ??= { n: 0, pnl: 0 });
      e.n++;
      e.pnl += t.netProfit;
      if (![t.grossProfit, t.totalFee, t.totalSlippageCost].every(finite))
        costMissing++;
      else {
        grossBeforeFees += t.grossProfit;
        fees += t.totalFee;
        slippageEmbeddedInGross += t.totalSlippageCost;
      }
      if (
        finite(t.entryTimestamp) &&
        t.exitTimestamp >= t.entryTimestamp &&
        t.netProfit !== 0
      )
        durations[t.netProfit > 0 ? 'win' : 'loss'].push(
          (t.exitTimestamp - t.entryTimestamp) / 3600000,
        );
    }
    const mean = (v) =>
      v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    return {
      decision,
      completed,
      exits,
      costs: {
        complete: costMissing === 0,
        missing: costMissing,
        grossBeforeFees,
        fees,
        slippageEmbeddedInGross,
        reconciliation: costMissing
          ? null
          : grossBeforeFees - fees - completed.totalProfit,
      },
      holdingHours: {
        winners: mean(durations.win),
        losers: mean(durations.loss),
      },
    };
  };
  const streams = [];
  for (const name of spec.streams ?? [...selectors.keys()]) {
    const selector = selectors.get(name);
    if (!selector) throw new Error(`Unknown frozen regime stream ${name}`);
    const selected = rows.filter(selector);
    const periods = spec.periods.map((p) => {
      const period = selected.filter(
        (r) => r.timestamp >= p.start && r.timestamp < p.end,
      );
      return {
        ...p,
        metrics: metrics(period, p.start, p.end),
        snapshotAudits: (spec.snapshotAudits ?? []).map((d) => ({
          id: d.id,
          path: d.path,
          role: 'Original saved snapshot data-quality audit only, never market regime or approval feature',
          buckets: [
            'missing',
            'null',
            'zero',
            'positive',
            'negative',
            'invalid-or-nonnumeric',
          ].map((status) => {
            const group = period.filter(
              (r) =>
                savedSnapshotStatus(r.savedSnapshotFeatures?.[d.path]) ===
                status,
            );
            return {
              status,
              metrics: metrics(group, p.start, p.end),
              directions: Object.fromEntries(
                ['LONG', 'SHORT'].map((side) => [
                  side,
                  metrics(
                    group.filter((r) => r.direction === side),
                    p.start,
                    p.end,
                  ),
                ]),
              ),
            };
          }),
        })),
        directions: Object.fromEntries(
          ['LONG', 'SHORT'].map((side) => [
            side,
            metrics(
              period.filter((r) => r.direction === side),
              p.start,
              p.end,
            ),
          ]),
        ),
        dimensions: spec.dimensions.map((d) => {
          const groups = new Map(bucketLabels(d).map((key) => [key, []]));
          for (const r of period)
            groups.get(regimeBucket(r.features[d.path], d)).push(r);
          return {
            id: d.id,
            path: d.path,
            scope: d.scope,
            units: d.units,
            buckets: [...groups].map(([bucket, group]) => ({
              bucket,
              share: period.length ? group.length / period.length : null,
              metrics: metrics(group, p.start, p.end),
              directions: Object.fromEntries(
                ['LONG', 'SHORT'].map((side) => [
                  side,
                  metrics(
                    group.filter((r) => r.direction === side),
                    p.start,
                    p.end,
                  ),
                ]),
              ),
            })),
          };
        }),
      };
    });
    const monthGroups = new Map();
    for (const r of selected) {
      const month = new Date(r.timestamp).toISOString().slice(0, 7);
      (
        monthGroups.get(month) ??
        (monthGroups.set(month, []), monthGroups.get(month))
      ).push(r);
    }
    const months = [...monthGroups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, group]) => {
        const start = Date.parse(`${month}-01T00:00:00Z`);
        const date = new Date(start);
        date.setUTCMonth(date.getUTCMonth() + 1);
        const end = date.getTime();
        return {
          month,
          metrics: metrics(group, start, end),
          directions: Object.fromEntries(
            ['LONG', 'SHORT'].map((side) => [
              side,
              metrics(
                group.filter((r) => r.direction === side),
                start,
                end,
              ),
            ]),
          ),
          mix: spec.dimensions.map((d) => ({
            id: d.id,
            counts: Object.fromEntries(
              bucketLabels(d).map((b) => [
                b,
                group.filter((r) => regimeBucket(r.features[d.path], d) === b)
                  .length,
              ]),
            ),
          })),
        };
      });
    const decompositions = (spec.comparePeriods ?? []).map(
      ([before, after]) => {
        const a = periods.find((p) => p.id === before),
          b = periods.find((p) => p.id === after);
        if (!a || !b) throw new Error('Unknown regime comparison period');
        return {
          before,
          after,
          dimensions: spec.dimensions.map((d, i) => {
            const cells = a.dimensions[i].buckets.map((x, j) => {
              const y = b.dimensions[i].buckets[j];
              const ma = x.metrics.completed.averageTrade,
                mb = y.metrics.completed.averageTrade;
              return {
                bucket: x.bucket,
                beforeN: x.metrics.completed.trades,
                afterN: y.metrics.completed.trades,
                beforeShare: x.share,
                afterShare: y.share,
                beforeMean: ma,
                afterMean: mb,
                mixEffect:
                  ma == null || y.share == null
                    ? null
                    : (y.share - x.share) * ma,
                withinRegimeEffect:
                  ma == null || mb == null || y.share == null
                    ? null
                    : y.share * (mb - ma),
              };
            });
            const complete = cells.every((c) => c.beforeN || !c.afterN);
            return {
              id: d.id,
              complete,
              totalMeanChange:
                b.metrics.completed.averageTrade == null ||
                a.metrics.completed.averageTrade == null
                  ? null
                  : b.metrics.completed.averageTrade -
                    a.metrics.completed.averageTrade,
              mixEffect: complete
                ? cells.reduce((n, c) => n + (c.mixEffect ?? 0), 0)
                : null,
              withinRegimeEffect: complete
                ? cells.reduce((n, c) => n + (c.withinRegimeEffect ?? 0), 0)
                : null,
              cells,
            };
          }),
        };
      },
    );
    streams.push({
      name,
      selected: selected.length,
      periods,
      months,
      decompositions,
      worstTrades: [...selected]
        .sort((a, b) => realized.get(a).profit - realized.get(b).profit)
        .slice(0, 20)
        .map((r) => ({
          signalId: r.signalId,
          symbol: r.symbol,
          direction: r.direction,
          timestamp: r.timestamp,
          trade: r.completedTrade,
          features: Object.fromEntries(
            spec.dimensions.map((d) => [d.id, r.features[d.path] ?? null]),
          ),
        })),
    });
  }
  return {
    schema: 'tradejs-market-regime-diagnostics/v1',
    role: 'Retrospective explanation, not candidate selection or causal proof',
    periodMembership:
      'signal timestamp, completed outcomes sorted by exit inside each fixed cohort',
    missingPolicy: 'Explicit missing bucket; never neutral or zero',
    costs:
      'Gross already includes modeled slippage; subtract fees once, never subtract slippage twice',
    spec,
    streams,
  };
}
