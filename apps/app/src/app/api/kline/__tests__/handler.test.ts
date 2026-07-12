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

jest.mock('#app/lib/currentUser', () => ({
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

import { POST } from '../handler';

const makeCandle = (timestamp: number, close: number) => ({
  timestamp,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: close * 10,
});

const makeRequest = (body: Record<string, unknown>, universe?: string) =>
  ({
    json: async () => body,
    nextUrl: new URL(
      `http://localhost/api/kline/bybit/BTCUSDT/15${
        universe ? `?universe=${universe}` : ''
      }`,
    ),
  }) as unknown as import('next/server').NextRequest;

describe('kline route handler', () => {
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

  it('reuses cached BTCUSDT raw history across different symbols', async () => {
    const klineMock = jest.fn(async ({ symbol }: { symbol: string }) => [
      makeCandle(900_000, symbol === 'BTCUSDT' ? 100 : 200),
      makeCandle(1_800_000, symbol === 'BTCUSDT' ? 101 : 201),
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
        symbol: 'SOLUSDT',
        interval: '15',
      }),
    });

    expect(
      klineMock.mock.calls.filter(([params]) => params.symbol === 'BTCUSDT')
        .length,
    ).toBe(1);
    expect(
      klineMock.mock.calls.filter(([params]) => params.symbol === 'ETHUSDT')
        .length,
    ).toBe(1);
    expect(
      klineMock.mock.calls.filter(([params]) => params.symbol === 'SOLUSDT')
        .length,
    ).toBe(1);
  });

  it('passes explicit TradFi universe and does not request BTC reference data', async () => {
    const klineMock = jest.fn(async ({ symbol }: { symbol: string }) => [
      makeCandle(900_000, symbol === 'AAPLUSDT' ? 200 : 100),
      makeCandle(1_800_000, symbol === 'AAPLUSDT' ? 201 : 101),
    ]);
    const connectorCreator = jest.fn(async () => ({ kline: klineMock }));
    mockGetConnectorCreatorByProvider.mockResolvedValue(connectorCreator);

    const response = await POST(
      makeRequest({ start: 900_000, end: 1_800_000 }, 'tradfi'),
      {
        params: Promise.resolve({
          provider: 'bybit',
          symbol: 'AAPLUSDT',
          interval: '15',
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(connectorCreator).toHaveBeenCalledWith({
      userName: 'root',
      universe: 'tradfi',
    });
    expect(klineMock).toHaveBeenCalledTimes(1);
    expect(klineMock).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'AAPLUSDT' }),
    );
    expect(mockCreateIndicators).toHaveBeenCalledWith(
      expect.any(Array),
      [],
      expect.objectContaining({ includeMlPayload: false }),
    );
  });

  it('rejects invalid and connector-unsupported universes with status 400', async () => {
    const invalid = await POST(makeRequest({ end: 1_800_000 }, 'stocks'), {
      params: Promise.resolve({
        provider: 'bybit',
        symbol: 'AAPLUSDT',
        interval: '15',
      }),
    });
    expect(invalid).toEqual({
      status: 400,
      body: { error: 'Unknown market universe: stocks' },
    });

    mockGetConnectorCreatorByProvider.mockResolvedValue(async () => {
      throw new Error('Unsupported market universe: tradfi');
    });
    const unsupported = await POST(
      makeRequest({ start: 900_000, end: 1_800_000 }, 'tradfi'),
      {
        params: Promise.resolve({
          provider: 'coinbase',
          symbol: 'AAPLUSDT',
          interval: '15',
        }),
      },
    );
    expect(unsupported).toEqual({
      status: 400,
      body: { error: 'Unsupported market universe: tradfi' },
    });
  });

  it('expires enriched cache entries after ttl and refetches data', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(10_000);

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
        symbol: 'BTCUSDT',
        interval: '15',
      }),
    });

    nowSpy.mockReturnValue(50_001);

    await POST(makeRequest({ start: 900_000, end: 1_800_000 }), {
      params: Promise.resolve({
        provider: 'bybit',
        symbol: 'BTCUSDT',
        interval: '15',
      }),
    });

    expect(klineMock).toHaveBeenCalledTimes(2);
    expect(mockCreateIndicators).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it('retries plugin registry initialization after a failed attempt', async () => {
    mockEnsureIndicatorPluginsLoaded
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const klineMock = jest
      .fn()
      .mockResolvedValue([
        makeCandle(900_000, 100),
        makeCandle(1_800_000, 101),
      ]);
    mockGetConnectorCreatorByProvider.mockResolvedValue(() => ({
      kline: klineMock,
    }));

    const failed = await POST(makeRequest({ start: 900_000, end: 1_800_000 }), {
      params: Promise.resolve({
        provider: 'bybit',
        symbol: 'BTCUSDT',
        interval: '15',
      }),
    });
    const succeeded = await POST(
      makeRequest({ start: 900_000, end: 1_800_000 }),
      {
        params: Promise.resolve({
          provider: 'bybit',
          symbol: 'BTCUSDT',
          interval: '15',
        }),
      },
    );

    expect(failed.status).toBe(500);
    expect(succeeded.status).toBe(200);
    expect(mockEnsureIndicatorPluginsLoaded).toHaveBeenCalledTimes(2);
  });
});
