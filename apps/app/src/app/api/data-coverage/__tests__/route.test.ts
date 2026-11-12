/** @jest-environment node */

import { NextRequest } from 'next/server';
import {
  readDataCoverage,
  readDataCoverageDay,
} from '@tradejs/infra/timescale/dataCoverage';
import { getCurrentUserName } from '#app/lib/currentUser';
import { GET } from '../route';

jest.mock('@tradejs/infra/timescale/dataCoverage', () => ({
  getDataCoveragePeriodEnd: () => Date.UTC(2026, 10, 13),
  isDataCoverageDataset: () => true,
  readDataCoverage: jest.fn(),
  readDataCoverageDay: jest.fn(),
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
const readOverview = jest.mocked(readDataCoverage);
const readDay = jest.mocked(readDataCoverageDay);
const currentUser = jest.mocked(getCurrentUserName);
const request = (dataset: string, params: Record<string, string> = {}) =>
  new NextRequest(
    `http://localhost/api/data-coverage?${new URLSearchParams({ dataset, to: String(to), ...params })}`,
  );

beforeEach(() => {
  jest.clearAllMocks();
  currentUser.mockResolvedValue('root');
  readOverview.mockResolvedValue(overview);
  readDay.mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('shares an in-flight query and reuses its result only for the authorized user', async () => {
  let finish!: (value: typeof overview) => void;
  readOverview.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );

  const first = GET(request('bybit-candles-15m'));
  const second = GET(request('bybit-candles-15m'));
  await Promise.resolve();
  expect(readOverview).toHaveBeenCalledTimes(1);
  finish(overview);

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

it('refreshes the selected period and invalidates its daily breakdowns', async () => {
  const dataset = 'bybit-candles-1h';
  const details = { day: String(day) };
  await GET(request(dataset));
  await GET(request(dataset, details));
  await GET(request(dataset, details));
  expect(readDay).toHaveBeenCalledTimes(1);

  const fresh = { ...overview, series: 1 };
  readOverview.mockResolvedValueOnce(fresh);
  expect(await (await GET(request(dataset, { refresh: '1' }))).json()).toEqual(
    fresh,
  );
  expect(await (await GET(request(dataset))).json()).toEqual(fresh);
  expect(readOverview).toHaveBeenCalledTimes(2);

  await GET(request(dataset, details));
  expect(readDay).toHaveBeenCalledTimes(2);
});

it('retries failures and recomputes recent coverage after the TTL', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(day);
  const dataset = 'cmc-global-1d';
  readOverview.mockRejectedValueOnce(new Error('Timed out'));
  expect((await GET(request(dataset))).status).toBe(500);
  expect((await GET(request(dataset))).status).toBe(200);
  expect(readOverview).toHaveBeenCalledTimes(2);

  now.mockReturnValue(day + 60_000);
  expect((await GET(request(dataset))).status).toBe(200);
  expect(readOverview).toHaveBeenCalledTimes(3);
});
