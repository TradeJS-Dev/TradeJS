import { createHash } from 'node:crypto';
import type { VisualTrade, VisualDataset } from './model';
export const summarize = (rows: VisualTrade[]) => {
  const wins = rows.filter((t) => t.pnl > 0),
    losses = rows.filter((t) => t.pnl < 0),
    grossProfit = wins.reduce((s, t) => s + t.pnl, 0),
    grossLoss = -losses.reduce((s, t) => s + t.pnl, 0);
  return {
    n: rows.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: rows.length - wins.length - losses.length,
    pnl: grossProfit - grossLoss,
    pf: grossLoss ? grossProfit / grossLoss : null,
    mean: rows.length ? (grossProfit - grossLoss) / rows.length : null,
  };
};
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function selectAtlas(
  trades: VisualTrade[],
  count = 100,
  seed = 'trade-atlas/v1',
) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000)
    throw new Error('count must be 1..1000');
  const selected: VisualTrade[] = [];
  for (const strategy of [...new Set(trades.map((t) => t.strategy))].sort())
    for (const sign of [1, -1]) {
      const population = trades
        .filter((t) => t.strategy === strategy && Math.sign(t.pnl) === sign)
        .sort(
          (a, b) => a.signalTime - b.signalTime || a.id.localeCompare(b.id),
        );
      const n = Math.min(count, population.length);
      for (let i = 0; i < n; i++)
        selected.push(
          population
            .slice(
              Math.floor((i * population.length) / n),
              Math.floor(((i + 1) * population.length) / n),
            )
            .sort(
              (a, b) =>
                hash(`${seed}:${a.id}`).localeCompare(
                  hash(`${seed}:${b.id}`),
                ) || a.id.localeCompare(b.id),
            )[0],
        );
    }
  return selected;
}
const median = (a: number[]) => {
  const s = [...a].sort((a, b) => a - b);
  return s.length
    ? (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2
    : null;
};
export function analyzeVisualTrades(trades: VisualTrade[]) {
  const scopes = ['ALL', 'LONG', 'SHORT'] as const;
  return Object.fromEntries(
    scopes.map((direction) => {
      const rows = trades.filter(
        (t) => direction === 'ALL' || t.direction === direction,
      );
      const pockets = Object.fromEntries(
        [...new Set(rows.flatMap((t) => Object.keys(t.pockets)))]
          .sort()
          .map((p) => [
            p,
            {
              pass: summarize(rows.filter((t) => t.pockets[p] === true)),
              fail: summarize(rows.filter((t) => t.pockets[p] === false)),
              unknown: rows.filter((t) => t.pockets[p] === undefined).length,
            },
          ]),
      );
      const contrasts = [
        ...new Set(rows.flatMap((t) => Object.keys(t.features))),
      ]
        .sort()
        .map((feature) => {
          const known = rows.filter((t) => t.features[feature] !== undefined),
            wins = known
              .filter((t) => t.pnl > 0)
              .map((t) => t.features[feature]),
            losses = known
              .filter((t) => t.pnl < 0)
              .map((t) => t.features[feature]);
          const values = known
            .map((t) => t.features[feature])
            .sort((a, b) => a - b);
          const iqr = values.length
            ? values[Math.floor((values.length - 1) * 0.75)] -
              values[Math.floor((values.length - 1) * 0.25)]
            : 0;
          const winMedian = median(wins),
            lossMedian = median(losses);
          return {
            feature,
            n: known.length,
            missing: rows.length - known.length,
            wins: wins.length,
            losses: losses.length,
            winMedian,
            lossMedian,
            iqr,
            medianDifferenceIqr:
              iqr && winMedian !== null && lossMedian !== null
                ? (winMedian - lossMedian) / iqr
                : null,
          };
        });
      return [direction, { summary: summarize(rows), pockets, contrasts }];
    }),
  );
}
export interface DrawdownEpisode {
  id: string;
  start: number;
  trough: number;
  end: number;
  recovered: boolean;
  depth: number;
  peak: number;
  points: Array<[number, number]>;
  tradeIds: string[];
  contributions: Record<string, ReturnType<typeof summarize>>;
}
export function drawdownEpisodes(dataset: VisualDataset): DrawdownEpisode[] {
  if (dataset.population !== 'complete')
    throw new Error(
      'Drawdowns require the complete population, never a selected atlas',
    );
  const events = new Map<number, VisualTrade[]>();
  for (const t of dataset.trades) {
    const group = events.get(t.exitTime) ?? [];
    group.push(t);
    events.set(t.exitTime, group);
  }
  const output: DrawdownEpisode[] = [];
  let equity = 0,
    peak = 0,
    peakTime = dataset.trades.length
      ? dataset.trades.reduce((min, t) => Math.min(min, t.entryTime), Infinity)
      : 0;
  let episode: DrawdownEpisode | undefined;
  let members: VisualTrade[] = [];
  const finish = () => {
    if (!episode) return;
    const groups = new Map<string, VisualTrade[]>();
    for (const t of members)
      for (const key of [
        `strategy:${t.strategy}`,
        `symbol:${t.symbol}`,
        `direction:${t.direction}`,
        ...Object.entries(t.groups).map(([k, v]) => `group:${k}:${v}`),
      ]) {
        const a = groups.get(key) ?? [];
        a.push(t);
        groups.set(key, a);
      }
    episode.contributions = Object.fromEntries(
      [...groups].map(([k, rows]) => [k, summarize(rows)]),
    );
    output.push(episode);
    episode = undefined;
    members = [];
  };
  for (const [timestamp, rows] of [...events].sort((a, b) => a[0] - b[0])) {
    rows.sort(
      (a, b) =>
        a.strategy.localeCompare(b.strategy) || a.id.localeCompare(b.id),
    );
    equity += rows.reduce((s, t) => s + t.pnl, 0);
    if (!episode && equity < peak)
      episode = {
        id: `drawdown-${output.length + 1}`,
        start: peakTime,
        trough: timestamp,
        end: timestamp,
        recovered: false,
        depth: 0,
        peak,
        points: [[peakTime, peak]],
        tradeIds: [],
        contributions: {},
      };
    if (episode) {
      episode.points.push([timestamp, equity]);
      episode.end = timestamp;
      members.push(...rows);
      episode.tradeIds.push(...rows.map((t) => `${t.strategy}:${t.id}`));
      if (peak - equity > episode.depth) {
        episode.depth = peak - equity;
        episode.trough = timestamp;
      }
      if (equity >= peak) {
        episode.recovered = true;
        finish();
      }
    }
    if (equity >= peak) {
      peak = equity;
      peakTime = timestamp;
    }
  }
  finish();
  return output;
}
