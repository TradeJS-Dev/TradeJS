const mockAuth = jest.fn();
const mockDelKey = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

jest.mock('@app/auth', () => ({
  auth: () => mockAuth(),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    log: jest.fn(),
  },
}));

jest.mock('@tradejs/infra/redis', () => ({
  delKey: (...args: unknown[]) => mockDelKey(...args),
  redisKeys: {
    testConfig: (u: string, s: string, n: string) => `config:${u}:${s}:${n}`,
    testStat: (u: string, s: string, n: string) => `stat:${u}:${s}:${n}`,
    testOrders: (u: string, s: string, n: string) => `orders:${u}:${s}:${n}`,
  },
}));

import { DELETE } from '../test/[strategy]/[name]/route';

describe('backtest delete route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when params are missing', async () => {
    const res = await DELETE({} as Request, {
      params: Promise.resolve({ strategy: '', name: '' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 when user is unauthorized', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await DELETE({} as Request, {
      params: Promise.resolve({ strategy: 'TrendLine', name: 't1' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 404 when no keys were deleted', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'alice' } });
    mockDelKey.mockResolvedValue(false);

    const res = await DELETE({} as Request, {
      params: Promise.resolve({ strategy: 'TrendLine', name: 't1' }),
    });

    expect(mockDelKey).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(404);
  });

  it('deletes test keys and returns 200', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'alice' } });
    mockDelKey
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const res = await DELETE({} as Request, {
      params: Promise.resolve({ strategy: 'TrendLine', name: 't1' }),
    });

    expect(mockDelKey).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, removedKeys: 2 });
  });

  it('returns 500 on unexpected error', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'alice' } });
    mockDelKey.mockRejectedValue(new Error('redis down'));

    const res = await DELETE({} as Request, {
      params: Promise.resolve({ strategy: 'TrendLine', name: 't1' }),
    });

    expect(res.status).toBe(500);
  });
});
