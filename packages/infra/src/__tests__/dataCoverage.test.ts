/** @jest-environment node */

import {
  getDataCoveragePeriodEnd,
  isDataCoverageDataset,
  listDataCoverageDatasets,
  readDataCoverageSnapshot,
} from '../timescale/dataCoverage';
import { queryMarketContext } from '../timescale/query';

jest.mock('../timescale/query', () => ({
  queryMarketContext: jest.fn(),
}));

const query = jest.mocked(queryMarketContext);
const queryResult = <Row extends Record<string, unknown>>(rows: Row[]) => ({
  rows,
  rowCount: rows.length,
  command: 'SELECT',
  oid: 0,
  fields: [],
});
const dayMs = 86_400_000;
const period = { from: Date.UTC(2026, 9, 14), to: Date.UTC(2026, 10, 13) };
const signal = new AbortController().signal;

beforeEach(() => {
  query.mockReset().mockResolvedValue(queryResult([]));
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('lists unique dataset IDs and exposes only public catalog metadata', () => {
  const datasets = listDataCoverageDatasets();
  expect(new Set(datasets.map(({ id }) => id)).size).toBe(datasets.length);
  expect(datasets.find(({ id }) => id === 'bybit-candles-1h')).toEqual({
    id: 'bybit-candles-1h',
    provider: 'Bybit',
    label: 'Candles',
    interval: '1h',
    dimension: 'symbol',
    stepMs: 3_600_000,
  });
  expect(isDataCoverageDataset('cmc-global-1d')).toBe(true);
  expect(isDataCoverageDataset('unknown')).toBe(false);
});

it('keeps a gap between batches and serves the same counts in daily detail', async () => {
  const stepMs = 3_600_000;
  const first = new Date(period.from + 23 * stepMs);
  const last = new Date(period.to - dayMs);
  jest.spyOn(Date, 'now').mockReturnValue(period.to - 5 * 60_000);
  query
    .mockResolvedValueOnce(queryResult([{ present: true }]))
    .mockResolvedValueOnce(queryResult([]))
    .mockResolvedValueOnce(
      queryResult([
        {
          key: 'BTCUSDT',
          day: period.from / dayMs,
          loaded: 1,
          first,
          last: first,
        },
      ]),
    )
    .mockResolvedValueOnce(queryResult([]))
    .mockResolvedValueOnce(queryResult([]))
    .mockResolvedValueOnce(queryResult([]))
    .mockResolvedValueOnce(
      queryResult([
        {
          key: 'BTCUSDT',
          day: last.getTime() / dayMs,
          loaded: 1,
          first: last,
          last,
        },
      ]),
    );

  expect(getDataCoveragePeriodEnd()).toBe(period.to);
  const snapshot = await readDataCoverageSnapshot(
    'bybit-candles-1h',
    period,
    signal,
  );
  expect(snapshot.coverage).toMatchObject({
    first: first.getTime(),
    last: last.getTime(),
    series: 1,
  });
  const gapDay = period.from + 7 * dayMs;
  expect(snapshot.coverage.days).toContainEqual({
    day: gapDay,
    loaded: 0,
    missing: 24,
    series: 1,
  });
  expect(snapshot.readDay(gapDay)).toEqual([
    { key: 'BTCUSDT', loaded: 0, missing: 24 },
  ]);
  expect(snapshot.readDay(period.to)).toEqual([]);
  expect(query).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining(
      "provider = 'bybit' AND symbol LIKE '%USDT') AND interval = 60",
    ),
    [new Date(period.from - 7 * dayMs), new Date(period.from)],
    { signal },
  );
  expect(query).toHaveBeenNthCalledWith(
    7,
    expect.stringContaining('count(DISTINCT'),
    [new Date(gapDay + 21 * dayMs), new Date(period.to - stepMs)],
    { signal },
  );
});

it('uses padded samples to establish a boundary without counting them in the visible period', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(period.to + 30 * dayMs);
  const before = new Date(period.from - dayMs);
  const after = new Date(period.to + dayMs);
  query
    .mockResolvedValueOnce(queryResult([{ present: true }]))
    .mockResolvedValueOnce(
      queryResult([
        {
          key: 'BTCUSDT',
          day: before.getTime() / dayMs,
          loaded: 1,
          first: before,
          last: before,
        },
        {
          key: 'ETHUSDT',
          day: before.getTime() / dayMs,
          loaded: 1,
          first: before,
          last: before,
        },
      ]),
    )
    .mockResolvedValueOnce(queryResult([]))
    .mockResolvedValueOnce(queryResult([]))
    .mockResolvedValueOnce(queryResult([]))
    .mockResolvedValueOnce(queryResult([]))
    .mockResolvedValueOnce(
      queryResult([
        {
          key: 'BTCUSDT',
          day: after.getTime() / dayMs,
          loaded: 1,
          first: after,
          last: after,
        },
      ]),
    );
  const snapshot = await readDataCoverageSnapshot(
    'coinalyze-open-interest-15m',
    period,
    signal,
  );
  expect(snapshot.coverage).toMatchObject({
    first: null,
    last: null,
    series: 1,
  });
  expect(snapshot.readDay(period.from)).toEqual([
    { key: 'BTCUSDT', loaded: 0, missing: 96 },
  ]);
});

it('returns empty coverage when the dataset table has not been created', async () => {
  query.mockResolvedValueOnce(queryResult([{ present: false }]));
  const snapshot = await readDataCoverageSnapshot(
    'cmc-global-1d',
    period,
    signal,
  );
  expect(snapshot.coverage).toEqual({
    first: null,
    last: null,
    series: 0,
    days: [],
  });
  expect(query).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining('to_regclass'),
    ['market_global_context'],
    { signal },
  );
});

it('retries a timed-out scan in smaller UTC day batches', async () => {
  const timeout = new Error('Timed out');
  timeout.name = 'TimescaleQueryTimeoutError';
  const from = period.from;
  const to = from + dayMs;
  jest.spyOn(Date, 'now').mockReturnValue(to);
  query
    .mockResolvedValueOnce(queryResult([{ present: true }]))
    .mockRejectedValueOnce(timeout)
    .mockResolvedValueOnce(queryResult([]))
    .mockResolvedValueOnce(
      queryResult([
        {
          key: 'Total',
          day: from / dayMs,
          loaded: 1,
          first: new Date(from),
          last: new Date(from),
        },
      ]),
    );

  const snapshot = await readDataCoverageSnapshot(
    'cmc-global-1d',
    { from, to },
    signal,
  );
  expect(snapshot.coverage.days).toEqual([
    { day: from, loaded: 1, missing: 0, series: 1 },
  ]);
  const middle = new Date(from - 3 * dayMs);
  expect(query).toHaveBeenNthCalledWith(
    3,
    expect.any(String),
    [new Date(from - 7 * dayMs), middle],
    { signal },
  );
  expect(query).toHaveBeenNthCalledWith(
    4,
    expect.any(String),
    [middle, new Date(to)],
    { signal },
  );
});
