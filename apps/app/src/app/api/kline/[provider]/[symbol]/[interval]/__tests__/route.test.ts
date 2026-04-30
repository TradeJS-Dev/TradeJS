const mockGetCurrentUserName = jest.fn();
const mockGetConnectorCreatorByProvider = jest.fn();
const mockEnsureIndicatorPluginsLoaded = jest.fn();
const mockGetRegisteredIndicatorEntries = jest.fn();
const mockCreateIndicators = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

jest.mock('@app/lib/currentUser', () => ({
  getCurrentUserName: () => mockGetCurrentUserName(),
}));

jest.mock('@tradejs/node/connectors', () => ({
  getConnectorCreatorByProvider: (...args: unknown[]) =>
    mockGetConnectorCreatorByProvider(...args),
}));

jest.mock('@tradejs/node/registry', () => ({
  ensureIndicatorPluginsLoaded: (...args: unknown[]) =>
    mockEnsureIndicatorPluginsLoaded(...args),
}));

jest.mock('@tradejs/core/indicators', () => ({
  getRegisteredIndicatorEntries: (...args: unknown[]) =>
    mockGetRegisteredIndicatorEntries(...args),
  createIndicators: (...args: unknown[]) => mockCreateIndicators(...args),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    log: jest.fn(),
  },
}));

import { POST } from '../route';

const makeCandle = (timestamp: number, close: number) => ({
  timestamp,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: close * 10,
});

const makeRequest = (body: Record<string, unknown>) =>
  ({
    json: async () => body,
  }) as Request;

describe('/api/kline route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete (global as any).__tradejsKlineRawCache__;
    delete (global as any).__tradejsKlineBtcRawCache__;
    delete (global as any).__tradejsKlineEnrichedCache__;
    delete (global as any).__tradejsKlineInflightRequests__;
    delete (global as any).__tradejsPluginRegistrySnapshotPromise__;

    mockGetCurrentUserName.mockResolvedValue('root');
    mockEnsureIndicatorPluginsLoaded.mockResolvedValue(undefined);
    mockGetRegisteredIndicatorEntries.mockReturnValue([
      {
        historyKey: 'pluginLine',
        indicator: { id: 'pluginLine' },
      },
    ]);
    mockCreateIndicators.mockReturnValue({
      result: () => ({
        pluginLine: [10, 20],
      }),
    });
  });

  it('loads plugin registry only once across requests', async () => {
    const klineMock = jest
      .fn()
      .mockResolvedValue([
        makeCandle(900_000, 100),
        makeCandle(1_800_000, 101),
      ]);
    mockGetConnectorCreatorByProvider.mockResolvedValue(() => ({
      kline: klineMock,
    }));

    await POST(makeRequest({ start: 900_000, end: 1_800_000 }), {
      params: Promise.resolve({
        provider: 'bybit',
        symbol: 'ETHUSDT',
        interval: '15',
      }),
    });
    await POST(makeRequest({ start: 900_000, end: 1_800_000 }), {
      params: Promise.resolve({
        provider: 'bybit',
        symbol: 'BTCUSDT',
        interval: '15',
      }),
    });

    expect(mockEnsureIndicatorPluginsLoaded).toHaveBeenCalledTimes(1);
    expect(mockGetRegisteredIndicatorEntries).toHaveBeenCalledTimes(1);
  });

  it('returns enriched cache hits without refetching raw data or recomputing indicators', async () => {
    const klineMock = jest
      .fn()
      .mockResolvedValue([
        makeCandle(900_000, 100),
        makeCandle(1_800_000, 101),
      ]);
    mockGetConnectorCreatorByProvider.mockResolvedValue(() => ({
      kline: klineMock,
    }));

    const first = await POST(makeRequest({ start: 900_000, end: 1_800_000 }), {
      params: Promise.resolve({
        provider: 'bybit',
        symbol: 'BTCUSDT',
        interval: '15',
      }),
    });
    const second = await POST(makeRequest({ start: 900_000, end: 1_800_000 }), {
      params: Promise.resolve({
        provider: 'bybit',
        symbol: 'BTCUSDT',
        interval: '15',
      }),
    });

    expect(klineMock).toHaveBeenCalledTimes(1);
    expect(mockCreateIndicators).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it('coalesces concurrent identical requests into one connector fetch', async () => {
    let resolveKline: ((value: unknown) => void) | null = null;
    const klineMock = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveKline = resolve;
        }),
    );
    mockGetConnectorCreatorByProvider.mockReturnValue(() => ({
      kline: klineMock,
    }));

    const firstPromise = POST(makeRequest({ start: 900_000, end: 1_800_000 }), {
      params: Promise.resolve({
        provider: 'bybit',
        symbol: 'BTCUSDT',
        interval: '15',
      }),
    });
    const secondPromise = POST(
      makeRequest({ start: 900_000, end: 1_800_000 }),
      {
        params: Promise.resolve({
          provider: 'bybit',
          symbol: 'BTCUSDT',
          interval: '15',
        }),
      },
    );

    for (let index = 0; index < 10 && !resolveKline; index += 1) {
      await Promise.resolve();
    }

    expect(klineMock).toHaveBeenCalledTimes(1);

    resolveKline?.([makeCandle(900_000, 100), makeCandle(1_800_000, 101)]);

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first).toEqual(second);
    expect(mockCreateIndicators).toHaveBeenCalledTimes(1);
  });
});
