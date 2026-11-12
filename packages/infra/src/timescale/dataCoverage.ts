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

type DailyRow = {
  key: string;
  day: number;
  loaded: number;
  first: Date;
  last: Date;
};

type SeriesCoverage = {
  firstSlot: number;
  lastSlot: number;
  loaded: Uint16Array;
};

function dailyCoverageQuery(dataset: CoverageDataset) {
  const { table, dimension, stepMs } = dataset;
  const key = dimension ?? "'Total'";
  const where = datasetWhere(dataset);
  const slot = `time_bucket('${stepMs / 60_000} minutes', ts)`;
  return `SELECT ${key} AS key,
                 floor(extract(epoch FROM ts) / 86400)::int AS day,
                 count(DISTINCT ${slot})::int AS loaded,
                 min(ts) AS first, max(ts) AS last
            FROM ${table}
           WHERE ${where} AND ts >= $1 AND ts < $2
           GROUP BY 1, 2`;
}

async function readDailyBatch(
  sql: string,
  start: number,
  end: number,
  signal: AbortSignal,
): Promise<DailyRow[]> {
  try {
    const { rows } = await queryMarketContext<DailyRow>(
      sql,
      [new Date(start), new Date(end)],
      { signal },
    );
    return rows;
  } catch (error) {
    const days = Math.ceil((end - start) / DAY_MS);
    if (
      !(error instanceof Error) ||
      error.name !== 'TimescaleQueryTimeoutError' ||
      days <= 1
    )
      throw error;
    const middle = start + Math.floor(days / 2) * DAY_MS;
    const earlier = await readDailyBatch(sql, start, middle, signal);
    return earlier.concat(await readDailyBatch(sql, middle, end, signal));
  }
}

let largeScanQueue = Promise.resolve();

function queueLargeScan(read: () => Promise<DailyRow[]>) {
  const batch = largeScanQueue.then(read);
  largeScanQueue = batch.then(
    () => undefined,
    () => undefined,
  );
  return batch;
}

export async function readDataCoverageSnapshot(
  id: string,
  { from, to }: CoveragePeriod,
  signal: AbortSignal,
) {
  const dataset = findDataset(id);
  const series = new Map<string, SeriesCoverage>();
  const days = new Map<number, DataCoverageDay>();
  let first: number | null = null;
  let last: number | null = null;
  const stepMs = dataset?.stepMs ?? DAY_MS;

  if (dataset) {
    const relation = await queryMarketContext<{ present: boolean }>(
      'SELECT to_regclass($1) IS NOT NULL AS present',
      [dataset.table],
      { signal },
    );
    if (relation.rows[0].present) {
      const padding = 7 * DAY_MS;
      const cutoff = Math.floor(Date.now() / stepMs) * stepMs;
      const end = Math.min(to + padding, cutoff);
      const highVolume =
        dataset.table === 'candles' || dataset.table === 'derivatives_market';
      const batchMs = (highVolume ? 7 : 60) * DAY_MS;
      const sql = dailyCoverageQuery(dataset);
      // Bounded scans avoid sorting a year's worth of candle timestamps in one query.
      for (let start = from - padding; start < end; start += batchMs) {
        const endOfBatch = Math.min(start + batchMs, end);
        const read = () => readDailyBatch(sql, start, endOfBatch, signal);
        const rows = await (highVolume ? queueLargeScan(read) : read());
        for (const row of rows) {
          const sampleFirst = row.first.getTime();
          const sampleLast = row.last.getTime();
          const firstSlot = Math.floor(sampleFirst / stepMs);
          const lastSlot = Math.floor(sampleLast / stepMs);
          const entry = series.get(row.key) ?? {
            firstSlot,
            lastSlot,
            loaded: new Uint16Array((to - from) / DAY_MS),
          };
          entry.firstSlot = Math.min(entry.firstSlot, firstSlot);
          entry.lastSlot = Math.max(entry.lastSlot, lastSlot);
          series.set(row.key, entry);

          const day = row.day * DAY_MS;
          if (day < from || day >= to) continue;
          entry.loaded[(day - from) / DAY_MS] = row.loaded;
          first = first === null ? sampleFirst : Math.min(first, sampleFirst);
          last = last === null ? sampleLast : Math.max(last, sampleLast);
        }
      }
    }
  }

  const countsForDay = (entry: SeriesCoverage, day: number) => {
    const expected = Math.max(
      0,
      Math.min(entry.lastSlot + 1, (day + DAY_MS) / stepMs) -
        Math.max(entry.firstSlot, day / stepMs),
    );
    const loaded = entry.loaded[(day - from) / DAY_MS];
    return { loaded, missing: expected - loaded, expected };
  };

  for (const [key, entry] of series) {
    const start = Math.max(
      from,
      Math.floor((entry.firstSlot * stepMs) / DAY_MS) * DAY_MS,
    );
    const end = Math.min(
      to,
      (Math.floor((entry.lastSlot * stepMs) / DAY_MS) + 1) * DAY_MS,
    );
    if (start >= end) {
      series.delete(key);
      continue;
    }
    for (let day = start; day < end; day += DAY_MS) {
      const { loaded, missing } = countsForDay(entry, day);
      const summary = days.get(day) ?? {
        day,
        loaded: 0,
        missing: 0,
        series: 0,
      };
      summary.loaded += loaded;
      summary.missing += missing;
      summary.series++;
      days.set(day, summary);
    }
  }

  const coverage: DataCoverage = {
    first,
    last,
    series: series.size,
    days: [...days.values()].sort((left, right) => left.day - right.day),
  };
  const readDay = (day: number): DataCoverageSeriesDay[] => {
    if (day < from || day >= to || day % DAY_MS !== 0) return [];
    const rows: DataCoverageSeriesDay[] = [];
    for (const [key, entry] of series) {
      const { loaded, missing, expected } = countsForDay(entry, day);
      if (expected > 0) rows.push({ key, loaded, missing });
    }
    return rows.sort(
      (left, right) =>
        right.missing - left.missing || left.key.localeCompare(right.key),
    );
  };
  return { coverage, readDay };
}
