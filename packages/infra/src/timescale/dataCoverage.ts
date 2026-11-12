import type {
  DataCoverageDataset,
  DataCoverageDay,
  DataCoverageSeriesDay,
  DataCoverage,
} from '@tradejs/types';
import { coverageDatasets, type CoverageDataset } from './dataCoverageCatalog';
import { queryMarketContext } from './query';

export const listDataCoverageDatasets = (): DataCoverageDataset[] =>
  coverageDatasets.map(
    ({ id, provider, label, interval, dimension, stepMs }) => ({
      id,
      provider,
      label,
      interval,
      dimension,
      stepMs,
    }),
  );

const datasetWhere = ({ table, interval, filter, stepMs }: CoverageDataset) => {
  if (table === 'candles')
    return `(${filter}) AND interval = ${stepMs / 60_000}`;
  if (table === 'market_global_context') return filter;
  return `(${filter}) AND interval = '${interval}'`;
};

const findDataset = (id: string) =>
  coverageDatasets.find((item) => item.id === id);

export const isDataCoverageDataset = (id: string) => Boolean(findDataset(id));

const DAY_MS = 86_400_000;

export const getDataCoveragePeriodEnd = () =>
  (Math.floor(Date.now() / DAY_MS) + 1) * DAY_MS;

type CoveragePeriod = { from: number; to: number };

function seriesDaysQuery(dataset: CoverageDataset) {
  const { table, dimension, stepMs } = dataset;
  const key = dimension ?? "'Total'";
  const slotsPerDay = DAY_MS / stepMs;
  return `
    WITH samples AS (
      SELECT ${key} AS key,
             floor(extract(epoch FROM ts) / 86400)::int AS day,
             floor(extract(epoch FROM ts) * 1000 / ${stepMs})::bigint AS slot,
             ts
      FROM ${table}
      WHERE ${datasetWhere(dataset)} AND ts >= $1 AND ts < $2
    ), daily AS (
      SELECT key, day, count(DISTINCT slot)::int AS loaded,
             min(slot) AS first_slot, max(slot) AS last_slot,
             min(ts) AS first_sample, max(ts) AS last_sample
      FROM samples GROUP BY key, day
    ), bounds AS (
      SELECT key, min(first_slot) AS first_slot, max(last_slot) AS last_slot
      FROM daily GROUP BY key
    ), series_days AS (
      SELECT bounds.key, days.day, coalesce(daily.loaded, 0) AS loaded,
             (least(bounds.last_slot + 1, (days.day + 1)::bigint * ${slotsPerDay})
               - greatest(bounds.first_slot, days.day::bigint * ${slotsPerDay}))::int
               - coalesce(daily.loaded, 0) AS missing,
             daily.first_sample, daily.last_sample
      FROM bounds
      CROSS JOIN LATERAL generate_series(
        greatest($3::int, (bounds.first_slot / ${slotsPerDay})::int),
        least($4::int - 1, (bounds.last_slot / ${slotsPerDay})::int)
      ) AS days(day)
      LEFT JOIN daily ON daily.key = bounds.key AND daily.day = days.day
    )
  `;
}

async function queryCoverage<TRow extends Record<string, unknown>>(
  id: string,
  { from, to }: CoveragePeriod,
  signal: AbortSignal,
  select: string,
  values: number[] = [],
) {
  const dataset = findDataset(id);
  if (!dataset) return [];
  const relation = await queryMarketContext<{ present: boolean }>(
    'SELECT to_regclass($1) IS NOT NULL AS present',
    [dataset.table],
    { signal },
  );
  if (!relation.rows[0].present) return [];

  // Samples just outside the view distinguish gaps at its edges from series
  // whose local history starts or ends there.
  const padding = 7 * DAY_MS;
  const cutoff = Math.floor(Date.now() / dataset.stepMs) * dataset.stepMs;
  const { rows } = await queryMarketContext<TRow>(
    seriesDaysQuery(dataset) + select,
    [
      new Date(from - padding),
      new Date(Math.min(to + padding, cutoff)),
      from / DAY_MS,
      to / DAY_MS,
      ...values,
    ],
    { signal },
  );
  return rows;
}

export async function readDataCoverage(
  id: string,
  period: CoveragePeriod,
  signal: AbortSignal,
): Promise<DataCoverage> {
  const rows = await queryCoverage<{
    day: number | null;
    loaded: number;
    missing: number;
    series: number;
    first: Date | null;
    last: Date | null;
  }>(
    id,
    period,
    signal,
    `
    SELECT day, coalesce(sum(loaded), 0)::int AS loaded,
           coalesce(sum(missing), 0)::int AS missing,
           count(DISTINCT key)::int AS series,
           min(first_sample) AS first, max(last_sample) AS last
    FROM series_days GROUP BY GROUPING SETS ((day), ())
    ORDER BY day NULLS FIRST
  `,
  );
  const summary = rows[0];
  const days: DataCoverageDay[] = rows
    .slice(1)
    .map(({ day, loaded, missing, series }) => ({
      day: Number(day) * DAY_MS,
      loaded,
      missing,
      series,
    }));
  return {
    first: summary?.first?.getTime() ?? null,
    last: summary?.last?.getTime() ?? null,
    series: summary?.series ?? 0,
    days,
  };
}

export async function readDataCoverageDay(
  id: string,
  period: CoveragePeriod,
  day: number,
  signal: AbortSignal,
): Promise<DataCoverageSeriesDay[]> {
  return queryCoverage(
    id,
    period,
    signal,
    `
    SELECT key, loaded, missing FROM series_days
    WHERE day = $5 ORDER BY missing DESC, key
  `,
    [day / DAY_MS],
  );
}
