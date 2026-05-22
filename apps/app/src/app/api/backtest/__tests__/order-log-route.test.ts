const mockAuth = jest.fn();
const mockGetData = jest.fn();
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
  },
}));

import { GET } from '../order-log/[strategy]/[name]/route';

describe('backtest order-log route', () => {
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

  it('returns order log for authorized user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'alice' } });
    mockGetData.mockResolvedValue({
      kind: 'file',
      version: 1,
      path: 'data/backtests/tests/alice/TrendLine/t1.json',
    });
    mockReadPersistedBacktestOrderLog.mockResolvedValue([
      { timestamp: 1000, amount: 100 },
    ]);

    const res = await GET({} as Request, {
      params: Promise.resolve({ strategy: 'TrendLine', name: 't1' }),
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      orderLog: [{ timestamp: 1000, amount: 100 }],
    });
  });

  it('returns 404 when redis does not contain a file ref', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'alice' } });
    mockGetData.mockResolvedValue([{ timestamp: 2000, amount: 200 }]);

    const res = await GET({} as Request, {
      params: Promise.resolve({ strategy: 'TrendLine', name: 't1' }),
    });

    expect(mockReadPersistedBacktestOrderLog).not.toHaveBeenCalled();
    expect(res.status).toBe(404);
  });

  it('returns 404 when file ref exists but artifact is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'alice' } });
    mockGetData.mockResolvedValue({
      kind: 'file',
      version: 1,
      path: 'data/backtests/tests/alice/TrendLine/t1.json',
    });
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
