import type {
  DataCoverageDataset,
  DataCoverageDay,
  DataCoverageSeriesDay,
  DataCoverage,
  DataBackfillRequest,
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

export function resolveDataBackfill(request: DataBackfillRequest) {
  const dataset = findDataset(request.dataset);
  if (
    !dataset ||
    !Number.isSafeInteger(request.day) ||
    request.day < 0 ||
    request.day % DAY_MS !== 0 ||
    typeof request.series !== 'string'
  )
    return null;
  const series = request.series;
  const validSeries =
    dataset.dimension === 'symbol'
      ? /^[\p{L}\p{N}]{1,56}USDT$/u.test(series)
      : dataset.dimension === 'universe'
        ? /^binance_top\d+_usdt_[a-f0-9]{12}$/.test(series)
        : dataset.dimension === 'index_slug'
          ? series === 'cmc20' || series === 'cmc100'
          : series === 'Total';
  const end = Math.min(
    request.day + DAY_MS,
    Math.floor(Date.now() / dataset.stepMs) * dataset.stepMs,
  );
  return validSeries && end > request.day ? { dataset, end } : null;
}

export async function readDataBackfillSlots(
  request: DataBackfillRequest,
  cutoff?: number,
) {
  const target = resolveDataBackfill(request);
  if (!target) throw new Error('Invalid data backfill target.');
  const { dataset } = target;
  const end = Math.min(target.end, cutoff ?? target.end);
  const expected = (end - request.day) / dataset.stepMs;
  const relation = await queryMarketContext<{ present: boolean }>(
    'SELECT to_regclass($1) IS NOT NULL AS present',
    [dataset.table],
  );
  if (!relation.rows[0]?.present)
    return { loaded: new Set<number>(), expected };
  const params = [
    new Date(request.day),
    new Date(end),
    ...(dataset.dimension ? [request.series] : []),
  ];
  const { rows } = await queryMarketContext<{ slot: Date }>(
    `SELECT DISTINCT time_bucket('${dataset.stepMs / 60_000} minutes', ts) AS slot
       FROM ${dataset.table} WHERE ${datasetWhere(dataset)} AND ts >= $1 AND ts < $2
       ${dataset.dimension ? `AND ${dataset.dimension} = $3` : ''}`,
    params,
  );
  return {
    loaded: new Set(rows.map(({ slot }) => slot.getTime())),
    expected,
  };
}

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

const MAX_ACTIVE_SCANS = 2;
let activeScans = 0;
const waitingScans: (() => void)[] = [];

async function withScanSlot<T>(
  read: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  if (activeScans >= MAX_ACTIVE_SCANS) {
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        signal.removeEventListener('abort', abort);
        resolve();
      };
      const abort = () => {
        const index = waitingScans.indexOf(ready);
        if (index >= 0) waitingScans.splice(index, 1);
        reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      waitingScans.push(ready);
    });
  } else {
    activeScans++;
  }
  try {
    signal.throwIfAborted();
    return await read();
  } finally {
    const next = waitingScans.shift();
    if (next) next();
    else activeScans--;
  }
}

export async function readDataCoverageSnapshot(
  id: string,
  { from, to }: CoveragePeriod,
  signal: AbortSignal,
  onProgress?: (scannedDays: number, totalDays: number) => void,
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
      const scanStart = from - padding;
      const totalDays = Math.max(0, Math.ceil((end - scanStart) / DAY_MS));
      onProgress?.(0, totalDays);
      const scan = async () => {
        for (let start = scanStart; start < end; start += batchMs) {
          const endOfBatch = Math.min(start + batchMs, end);
          const rows = await readDailyBatch(sql, start, endOfBatch, signal);
          onProgress?.(Math.ceil((endOfBatch - scanStart) / DAY_MS), totalDays);
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
      };
      if (highVolume) await withScanSlot(scan, signal);
      else await scan();
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
