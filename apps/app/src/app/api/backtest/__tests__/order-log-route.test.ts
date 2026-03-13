const mockAuth = jest.fn();
const mockGetData = jest.fn();

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

jest.mock('@tradejs/infra', () => {
  const actual = jest.requireActual('@tradejs/infra');
  return {
    ...actual,
    logger: {
      ...actual.logger,
      log: jest.fn(),
    },
    getData: (...args: unknown[]) => mockGetData(...args),
    redisKeys: {
      ...actual.redisKeys,
      testOrders: (u: string, s: string, n: string) => `orders:${u}:${s}:${n}`,
    },
  };
});

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
    mockGetData.mockResolvedValue([{ timestamp: 1000, amount: 100 }]);

    const res = await GET({} as Request, {
      params: Promise.resolve({ strategy: 'TrendLine', name: 't1' }),
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      orderLog: [{ timestamp: 1000, amount: 100 }],
    });
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
