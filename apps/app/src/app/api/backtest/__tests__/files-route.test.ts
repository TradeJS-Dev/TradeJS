const mockAuth = jest.fn();
const mockGetData = jest.fn();
const mockGetKeys = jest.fn();
const mockSetData = jest.fn();

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
  getData: (...args: unknown[]) => mockGetData(...args),
  getKeys: (...args: unknown[]) => mockGetKeys(...args),
  setData: (...args: unknown[]) => mockSetData(...args),
  redisKeys: {
    tests: (u: string) => `users:${u}:tests:`,
    testStat: (u: string, s: string, n: string) => `stat:${u}:${s}:${n}`,
    testSummaries: (u: string) => `summaries:${u}`,
  },
}));

jest.mock('@tradejs/core/backtest', () => ({
  parseTestName: (value: string) => {
    const [symbol, testId] = value.split('__');
    return { symbol, testId };
  },
}));

import { GET } from '../files/route';

describe('backtest files route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetData.mockResolvedValue(undefined);
  });

  it('returns indexed summaries without scanning old test keys', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'alice' } });
    mockGetData.mockResolvedValueOnce([
      { value: 'BTCUSDT__1', label: 'BTCUSDT_1', data: { strategyName: 'TL' } },
    ]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          value: 'BTCUSDT__1',
          label: 'BTCUSDT_1',
          data: { strategyName: 'TL' },
        },
      ],
    });
    expect(mockGetKeys).not.toHaveBeenCalled();
    expect(mockSetData).not.toHaveBeenCalled();
  });

  it('builds and persists the summaries index from legacy keys when index is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'alice' } });
    mockGetData.mockImplementation(async (key: string) => {
      if (key === 'summaries:alice') {
        return null;
      }
      if (key === 'stat:alice:TrendLine:BTCUSDT__1') {
        return { netProfit: 42 };
      }
      return null;
    });
    mockGetKeys.mockResolvedValue([
      'users:alice:tests:TrendLine:BTCUSDT__1:config',
      'users:alice:tests:TrendLine:BTCUSDT__1:orders',
    ]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          value: 'BTCUSDT__1',
          label: 'BTCUSDT_1',
          description: '42$',
          data: {
            netProfit: 42,
            strategyName: 'TrendLine',
          },
        },
      ],
    });
    expect(mockSetData).toHaveBeenCalledWith(
      'summaries:alice',
      [
        {
          value: 'BTCUSDT__1',
          label: 'BTCUSDT_1',
          description: '42$',
          data: {
            netProfit: 42,
            strategyName: 'TrendLine',
          },
        },
      ],
      { expire: 0 },
    );
  });
});
