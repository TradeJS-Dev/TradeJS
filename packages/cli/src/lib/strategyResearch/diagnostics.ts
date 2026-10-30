import type { ResearchDataset, StrategyResearchSpec } from './types';
import { summarizeCoreResearchCohorts, DAY_MS } from '../coreResearch/metrics';
import { sha256Json } from '../coreResearch/io';
import { calendarMeanInterval } from './events';

const quantile = (values: number[], fraction: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
};

export const buildResearchDiagnostics = (
  spec: StrategyResearchSpec,
  dataset: ResearchDataset,
) => {
  const days = (spec.testSince - spec.core.window.start) / DAY_MS;
  const tradeBySignal = new Map(
    dataset.trades.map((trade) => [trade.signalId, trade]),
  );
  const numericKeys = [
    ...new Set(
      dataset.rows.flatMap((row) =>
        Object.keys(row.features).filter(
          (key) => typeof row.features[key] === 'number',
        ),
      ),
    ),
  ]
    .sort()
    .slice(0, 24);
  const features = numericKeys.map((key) => {
    const rows = dataset.rows
      .filter((row) => typeof row.features[key] === 'number')
      .sort((a, b) => Number(a.features[key]) - Number(b.features[key]));
    const maximum = Number(rows.at(-1)?.features[key]);
    const boundaries = [
      ...new Set(
        [1, 2, 3, 4]
          .map((index) =>
            Number(rows[Math.floor((rows.length * index) / 5)]?.features[key]),
          )
          .filter((value) => Number.isFinite(value) && value < maximum),
      ),
    ];
    const bins = Array.from({ length: boundaries.length + 1 }, (_, index) => {
      const selected = rows.filter(
        (row) =>
          Number(row.features[key]) > (boundaries[index - 1] ?? -Infinity) &&
          Number(row.features[key]) <= (boundaries[index] ?? Infinity),
      );
      const trades = selected.flatMap((row) => {
        const trade = tradeBySignal.get(row.signalId ?? '');
        return trade ? [trade] : [];
      });
      return {
        lower: selected[0]?.features[key] ?? null,
        upper: selected.at(-1)?.features[key] ?? null,
        events: new Set(selected.map((row) => row.timestamp)).size,
        metrics: summarizeCoreResearchCohorts(trades, days),
        outcomeP10: quantile(
          trades.map((trade) => trade.netProfit),
          0.1,
        ),
        outcomeP90: quantile(
          trades.map((trade) => trade.netProfit),
          0.9,
        ),
        meanInterval95: calendarMeanInterval(
          trades.map((trade) => ({
            timestamp: trade.signalTimestamp,
            value: trade.netProfit,
          })),
          spec.core.window.start,
          spec.testSince,
          `${key}-${index}`,
        ),
      };
    });
    return {
      key,
      coverage: dataset.rows.length ? rows.length / dataset.rows.length : 0,
      bins,
    };
  });
  const paths = dataset.samples.map((sample) => {
    const before = sample.candles.filter(
      (candle) => candle.timestamp <= sample.trade.signalTimestamp,
    );
    const price = before.at(-1)?.close;
    const risk =
      price != null && sample.stop != null ? Math.abs(price - sample.stop) : 0;
    const after = sample.candles.filter(
      (candle) => candle.timestamp > sample.trade.signalTimestamp,
    );
    const sign = sample.trade.direction === 'LONG' ? 1 : -1;
    const horizons = spec.diagnostics.horizons.map((bars) => {
      const selected = after.slice(0, bars);
      if (!price || !(risk > 0) || selected.length < bars)
        return { bars, available: false as const };
      const favorable = Math.max(
        ...selected.map((candle) =>
          sign === 1 ? candle.high - price : price - candle.low,
        ),
      );
      const adverse = Math.max(
        ...selected.map((candle) =>
          sign === 1 ? price - candle.low : candle.high - price,
        ),
      );
      return {
        bars,
        available: true as const,
        moveR: (sign * (selected.at(-1)!.close - price)) / risk,
        mfeR: Math.max(0, favorable / risk),
        maeR: Math.max(0, adverse / risk),
      };
    });
    return {
      signalId: sample.trade.signalId,
      symbol: sample.trade.symbol,
      direction: sample.trade.direction,
      horizons,
    };
  });
  return {
    scope:
      'mature DEV only; chart samples stratified by direction/outcome, not an unbiased estimate of all events',
    contextCoverage: dataset.contextCoverage,
    purgedLabels: dataset.purgedLabels,
    currentGate: {
      approved: dataset.rows.filter((row) => row.aiApproved).length,
      total: dataset.rows.length,
    },
    jev: {
      availableRows: dataset.rows.filter((row) =>
        Object.keys(row.features).some((key) =>
          key.startsWith('additionalIndicators.jev.scores.'),
        ),
      ).length,
      totalRows: dataset.rows.length,
      interpretation:
        'Optional recorded Jev features; no provider request or inferred image assessment',
    },
    features,
    paths,
    fan: spec.diagnostics.horizons.map((bars) => {
      const values = paths.flatMap((sample) =>
        sample.horizons.flatMap((horizon) =>
          horizon.bars === bars && horizon.available ? [horizon.moveR] : [],
        ),
      );
      return {
        bars,
        samples: values.length,
        p10: quantile(values, 0.1),
        median: quantile(values, 0.5),
        p90: quantile(values, 0.9),
      };
    }),
    sampleIds: dataset.samples.map((sample) => ({
      signalId: sample.trade.signalId,
      sha256: sha256Json(sample),
    })),
    eventStudy: dataset.eventStudy ?? [],
  };
};

export type ResearchDiagnostics = ReturnType<typeof buildResearchDiagnostics>;
