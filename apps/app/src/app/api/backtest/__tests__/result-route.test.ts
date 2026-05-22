const mockAuth = jest.fn();
const mockGetData = jest.fn();
const mockGetTimeline = jest.fn();
const mockCompactOrderLog = jest.fn();
const mockReadPersistedBacktestOrderLog = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

jest.mock('#app/auth', () => ({
  auth: () => mockAuth(),
}));

jest.mock('@tradejs/core/backtest', () => {
  const actual = jest.requireActual('@tradejs/core/backtest');
  return {
    ...actual,
    getTimeline: (...args: unknown[]) => mockGetTimeline(...args),
    compactOrderLog: (...args: unknown[]) => mockCompactOrderLog(...args),
  };
});

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    log: jest.fn(),
  },
}));

jest.mock('@tradejs/infra/backtestArtifacts', () => ({
  parseBacktestArtifactRef: (value: unknown) =>
    value &&
    typeof value === 'object' &&
    (value as { kind?: string }).kind === 'file'
      ? value
      : null,
  readPersistedBacktestOrderLog: (...args: unknown[]) =>
    mockReadPersistedBacktestOrderLog(...args),
}));

jest.mock('@tradejs/infra/redis', () => ({
  getData: (...args: unknown[]) => mockGetData(...args),
  redisKeys: {
    testOrders: (u: string, s: string, n: string) => `orders:${u}:${s}:${n}`,
    testConfig: (u: string, s: string, n: string) => `config:${u}:${s}:${n}`,
    testStat: (u: string, s: string, n: string) => `stat:${u}:${s}:${n}`,
  },
}));

import { GET } from '../result/[strategy]/[name]/route';

describe('backtest result route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when params are missing', async () => {
    const res = await GET({} as Request, {
      params: Promise.resolve({ strategy: '', name: '' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 when user is unauthorized', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET({} as Request, {
      params: Promise.resolve({ strategy: 'TrendLine', name: 't1' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns compacted result payload', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'alice' } });
    mockGetData
      .mockResolvedValueOnce({
        kind: 'file',
        version: 1,
        path: 'data/backtests/tests/alice/TrendLine/t1.json',
      })
      .mockResolvedValueOnce({ options: { start: 1000, end: 2000 } })
      .mockResolvedValueOnce({ amount: 110 });
    mockReadPersistedBacktestOrderLog.mockResolvedValue([
      { timestamp: 1000, amount: 100 },
    ]);
    mockGetTimeline.mockReturnValue([1000, 2000]);
    mockCompactOrderLog.mockReturnValue([
      [1000, 100],
      [2000, 110],
    ]);

    const res = await GET({} as Request, {
      params: Promise.resolve({ strategy: 'TrendLine', name: 't1' }),
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      result: {
        test: { options: { start: 1000, end: 2000 } },
        orderLog: [
          [1000, 100],
          [2000, 110],
        ],
        stat: { amount: 110 },
      },
    });
  });

  it('returns 404 when redis does not contain a file ref', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'alice' } });
    mockGetData
      .mockResolvedValueOnce([{ timestamp: 1000, amount: 100 }])
      .mockResolvedValueOnce({ options: { start: 1000, end: 2000 } })
      .mockResolvedValueOnce({ amount: 110 });

    const res = await GET({} as Request, {
      params: Promise.resolve({ strategy: 'TrendLine', name: 't1' }),
    });

    expect(mockReadPersistedBacktestOrderLog).not.toHaveBeenCalled();
    expect(res.status).toBe(404);
  });

  it('returns 404 when file ref exists but artifact is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'alice' } });
    mockGetData
      .mockResolvedValueOnce({
        kind: 'file',
        version: 1,
        path: 'data/backtests/tests/alice/TrendLine/t1.json',
      })
      .mockResolvedValueOnce({ options: { start: 1000, end: 2000 } })
      .mockResolvedValueOnce({ amount: 110 });
    mockReadPersistedBacktestOrderLog.mockResolvedValue(null);

    const res = await GET({} as Request, {
      params: Promise.resolve({ strategy: 'TrendLine', name: 't1' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 500 on unexpected error', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'alice' } });
    mockGetData.mockRejectedValue(new Error('db down'));

    const res = await GET({} as Request, {
      params: Promise.resolve({ strategy: 'TrendLine', name: 't1' }),
    });

    expect(res.status).toBe(500);
  });
});
