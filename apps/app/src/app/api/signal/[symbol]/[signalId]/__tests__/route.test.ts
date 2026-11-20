const mockGetCurrentUserName = jest.fn();
const mockGetData = jest.fn();
const mockGetHashJsonField = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

jest.mock('#app/lib/currentUser', () => ({
  getCurrentUserName: (...args: unknown[]) => mockGetCurrentUserName(...args),
}));

jest.mock('@tradejs/infra/redis', () => ({
  getData: (...args: unknown[]) => mockGetData(...args),
  getHashJsonField: (...args: unknown[]) => mockGetHashJsonField(...args),
  redisKeys: {
    runtimeSignalBucket: (user: string, day: string, strategy: string) =>
      `${user}:${day}:${strategy}`,
    storeSignal: (symbol: string, signalId: string) =>
      `store:signals:${symbol}:${signalId}`,
  },
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: { log: jest.fn() },
}));

import { GET } from '../route';

const context = (symbol: string, signalId: string) => ({
  params: Promise.resolve({ symbol, signalId }),
});

describe('/api/signal route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserName.mockResolvedValue('root');
    mockGetHashJsonField.mockResolvedValue(null);
    mockGetData.mockImplementation(
      async (_key: string, fallback: unknown) => fallback,
    );
  });

  it('returns null when the requested signal has not been persisted yet', async () => {
    const response = await GET(
      {} as Request,
      context('BTCUSDT', 'missing-signal'),
    );

    expect(mockGetData).toHaveBeenCalledWith(
      'store:signals:BTCUSDT:missing-signal',
      null,
    );
    expect(response).toEqual({
      status: 200,
      body: { signal: null },
    });
  });
});

it('hides a persisted signal absent from the authenticated user index', async () => {
  mockGetData.mockResolvedValue({
    signalId: 'id',
    symbol: 'BTCUSDT',
    timestamp: 1700000000000,
    strategy: 'Trend',
  });
  mockGetHashJsonField.mockResolvedValue(null);
  expect(await GET({} as Request, context('BTCUSDT', 'id'))).toEqual({
    status: 200,
    body: { signal: null },
  });
});
it('returns an indexed signal and rejects a mismatched symbol reference', async () => {
  const signal = {
    signalId: 'id',
    symbol: 'BTCUSDT',
    timestamp: 1700000000000,
    strategy: 'Trend',
  };
  mockGetCurrentUserName.mockResolvedValue('root');
  mockGetData.mockResolvedValue(signal);
  mockGetHashJsonField.mockResolvedValue({ symbol: 'BTCUSDT' });
  expect(await GET({} as Request, context('BTCUSDT', 'id'))).toEqual({
    status: 200,
    body: { signal },
  });
  mockGetHashJsonField.mockResolvedValue({ symbol: 'ETHUSDT' });
  expect(await GET({} as Request, context('BTCUSDT', 'id'))).toEqual({
    status: 200,
    body: { signal: null },
  });
});
