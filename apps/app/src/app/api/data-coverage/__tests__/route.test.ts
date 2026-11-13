/** @jest-environment node */

import { NextRequest } from 'next/server';
import { readDataCoverageSnapshot } from '@tradejs/infra/timescale/dataCoverage';
import { getCurrentUserName } from '#app/lib/currentUser';
import { GET } from '../route';

jest.mock('@tradejs/infra/timescale/dataCoverage', () => ({
  getDataCoveragePeriodEnd: () => Date.UTC(2026, 10, 13),
  isDataCoverageDataset: () => true,
  readDataCoverageSnapshot: jest.fn(),
}));
jest.mock('#app/lib/currentUser', () => ({
  getCurrentUserName: jest.fn(),
}));
jest.mock('#app/lib/installation', () => ({
  INSTALL_USER_NAME: 'root',
}));
jest.mock('@tradejs/infra/logger', () => ({
  logger: { error: jest.fn() },
}));

const to = Date.UTC(2026, 10, 13);
const day = Date.UTC(2026, 10, 12);
const overview = { first: null, last: null, series: 0, days: [] };
const readSnapshot = jest.mocked(readDataCoverageSnapshot);
const snapshot = { coverage: overview, readDay: () => [] };
const currentUser = jest.mocked(getCurrentUserName);
const request = (dataset: string, params: Record<string, string> = {}) =>
  new NextRequest(
    `http://localhost/api/data-coverage?${new URLSearchParams({ dataset, to: String(to), ...params })}`,
  );

beforeEach(() => {
  jest.clearAllMocks();
  currentUser.mockResolvedValue('root');
  readSnapshot.mockResolvedValue(snapshot);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('shares an in-flight query and reuses its result only for the authorized user', async () => {
  let finish!: (value: typeof snapshot) => void;
  readSnapshot.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );

  const first = GET(request('bybit-candles-15m'));
  const second = GET(request('bybit-candles-15m'));
  await Promise.resolve();
  expect(readSnapshot).toHaveBeenCalledTimes(1);
  finish(snapshot);

  const responses = await Promise.all([first, second]);
  expect(
    responses.map((res) => res.headers.get('x-data-coverage-cache')),
  ).toEqual(['miss', 'shared']);
  expect(await responses[1].json()).toEqual(overview);
  expect(
    (await GET(request('bybit-candles-15m'))).headers.get(
      'x-data-coverage-cache',
    ),
  ).toBe('hit');

  currentUser.mockResolvedValueOnce(null);
  expect((await GET(request('bybit-candles-15m'))).status).toBe(401);
});

it('shares the annual snapshot with daily detail and replaces both on refresh', async () => {
  const dataset = 'bybit-candles-1h';
  const year = { year: '2026' };
  const details = { ...year, day: String(day) };
  await GET(request(dataset, year));
  await GET(request(dataset, details));
  expect(readSnapshot).toHaveBeenCalledTimes(1);
  expect(readSnapshot).toHaveBeenCalledWith(
    dataset,
    { from: Date.UTC(2026, 0, 1), to },
    expect.anything(),
    expect.any(Function),
  );

  const fresh = { ...overview, series: 1 };
  const rows = [{ key: 'BTCUSDT', loaded: 4, missing: 0 }];
  readSnapshot.mockResolvedValueOnce({ coverage: fresh, readDay: () => rows });
  expect(
    await (await GET(request(dataset, { ...year, refresh: '1' }))).json(),
  ).toEqual(fresh);
  expect(await (await GET(request(dataset, details))).json()).toEqual(rows);
  expect(readSnapshot).toHaveBeenCalledTimes(2);
});

it('rejects future years and days outside the chosen calendar year', async () => {
  const dataset = 'cmc-global-1d';
  expect((await GET(request(dataset, { year: '2027' }))).status).toBe(400);
  expect(
    (await GET(request(dataset, { year: '2025', day: String(day) }))).status,
  ).toBe(400);
  expect(readSnapshot).not.toHaveBeenCalled();
});

it('returns scan progress immediately and keeps the previous overview visible on refresh', async () => {
  const dataset = 'binance-candles-1h';
  const year = { year: '2026', progress: '1' };
  let finish!: (value: typeof snapshot) => void;
  readSnapshot.mockImplementationOnce((_id, _period, _signal, onProgress) => {
    onProgress?.(7, 317);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });

  const first = await GET(request(dataset, year));
  expect(first.status).toBe(202);
  expect(await first.json()).toEqual({ scannedDays: 7, totalDays: 317 });
  expect((await GET(request(dataset, year))).status).toBe(202);
  expect(readSnapshot).toHaveBeenCalledTimes(1);
  finish(snapshot);
  expect(await (await GET(request(dataset, year))).json()).toEqual(overview);

  readSnapshot.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const refresh = await GET(request(dataset, { ...year, refresh: '1' }));
  expect(refresh.status).toBe(202);
  expect(await refresh.json()).toMatchObject({ coverage: overview });
  finish(snapshot);
});

it('retries failures and recomputes recent coverage after the TTL', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(day);
  const dataset = 'cmc-global-1d';
  readSnapshot.mockRejectedValueOnce(new Error('Timed out'));
  expect((await GET(request(dataset))).status).toBe(500);
  expect((await GET(request(dataset))).status).toBe(200);
  expect(readSnapshot).toHaveBeenCalledTimes(2);

  now.mockReturnValue(day + 60_000);
  expect((await GET(request(dataset))).status).toBe(200);
  expect(readSnapshot).toHaveBeenCalledTimes(3);
});
