const mockBuildIndicatorCacheSnapshots = jest.fn();
const mockGetIndicatorCacheRange = jest.fn();
const mockUpsertIndicatorCacheRows = jest.fn();

jest.mock('@tradejs/core/indicators', () => ({
  buildIndicatorCacheSnapshots: (...args: unknown[]) =>
    mockBuildIndicatorCacheSnapshots(...args),
}));

jest.mock('@tradejs/infra/timescale', () => ({
  getIndicatorCacheRange: (...args: unknown[]) =>
    mockGetIndicatorCacheRange(...args),
  upsertIndicatorCacheRows: (...args: unknown[]) =>
    mockUpsertIndicatorCacheRows(...args),
}));

import {
  buildIndicatorCacheParamsHash,
  ensureIndicatorCacheCoverage,
  materializeIndicatorCachePlan,
  planIndicatorCacheRestore,
} from '../indicatorCache';

const candle = (timestamp: number, close = 100) => ({
  timestamp,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 1,
  turnover: close,
});

const runtimeState = (seed: number) =>
  ({
    seed,
  }) as any;

const cacheRow = (timestamp: number, close = 100, btcClose = 200) => ({
  timestamp,
  candleSignature: [
    timestamp,
    close,
    close + 1,
    close - 1,
    close,
    1,
    close,
  ].join(':'),
  btcCandleSignature: [
    timestamp,
    btcClose,
    btcClose + 1,
    btcClose - 1,
    btcClose,
    1,
    btcClose,
  ].join(':'),
  ready: true,
  indicatorValues: {},
  baseContext: null,
  runtimeState: runtimeState(timestamp),
});

describe('indicatorCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns stable params hash for the same inputs', () => {
    expect(
      buildIndicatorCacheParamsHash({
        provider: 'ByBit',
        interval: 15,
        periods: { maFast: 14, maSlow: 50 },
        btcProvider: 'ByBit',
        btcBinanceProvider: 'Binance',
        btcCoinbaseProvider: 'Coinbase',
      }),
    ).toBe(
      buildIndicatorCacheParamsHash({
        provider: 'ByBit',
        interval: 15,
        periods: { maFast: 14, maSlow: 50 },
        btcProvider: 'ByBit',
        btcBinanceProvider: 'Binance',
        btcCoinbaseProvider: 'Coinbase',
      }),
    );
  });

  it('reuses the longest valid cached prefix and replays only appended candles', async () => {
    const data = [candle(1_000, 100), candle(2_000, 101), candle(3_000, 102)];
    const btcData = [
      candle(1_000, 200),
      candle(2_000, 201),
      candle(3_000, 202),
    ];
    mockGetIndicatorCacheRange.mockResolvedValue([
      { snapshot: cacheRow(1_000, 100, 200) },
      { snapshot: cacheRow(2_000, 101, 201) },
    ]);

    const plan = await planIndicatorCacheRestore({
      provider: 'ByBit',
      symbol: 'ETHUSDT',
      interval: 15,
      periods: { maFast: 14 },
      data: data as any,
      btcData: btcData as any,
    });

    expect(plan.cached).toBe(false);
    expect(plan.replayStartIndex).toBe(2);
    expect(plan.restoreState).toEqual(runtimeState(2_000));
  });

  it('invalidates cache from the first changed candle and keeps the last valid runtime state', async () => {
    const data = [candle(1_000, 100), candle(2_000, 555), candle(3_000, 102)];
    const btcData = [
      candle(1_000, 200),
      candle(2_000, 201),
      candle(3_000, 202),
    ];
    mockGetIndicatorCacheRange.mockResolvedValue([
      { snapshot: cacheRow(1_000, 100, 200) },
      { snapshot: cacheRow(2_000, 101, 201) },
      { snapshot: cacheRow(3_000, 102, 202) },
    ]);

    const plan = await planIndicatorCacheRestore({
      provider: 'ByBit',
      symbol: 'ETHUSDT',
      interval: 15,
      periods: { maFast: 14 },
      data: data as any,
      btcData: btcData as any,
    });

    expect(plan.cached).toBe(false);
    expect(plan.replayStartIndex).toBe(1);
    expect(plan.restoreState).toEqual(runtimeState(1_000));
  });

  it('marks the range as cached only when every candle signature still matches', async () => {
    const data = [candle(1_000, 100), candle(2_000, 101)];
    const btcData = [candle(1_000, 200), candle(2_000, 201)];
    mockGetIndicatorCacheRange.mockResolvedValue([
      { snapshot: cacheRow(1_000, 100, 200) },
      { snapshot: cacheRow(2_000, 101, 201) },
    ]);

    const plan = await planIndicatorCacheRestore({
      provider: 'ByBit',
      symbol: 'ETHUSDT',
      interval: 15,
      periods: { maFast: 14 },
      data: data as any,
      btcData: btcData as any,
    });

    expect(plan.cached).toBe(true);
    expect(plan.replayStartIndex).toBe(2);
  });

  it('materializes only the replay suffix and passes the restored controller state', async () => {
    mockBuildIndicatorCacheSnapshots.mockReturnValue([
      {
        timestamp: 3_000,
        candleSignature: 'coin-3',
        btcCandleSignature: 'btc-3',
        ready: true,
        indicatorValues: {},
        baseContext: null,
        runtimeState: runtimeState(3_000),
      },
    ]);

    const data = [candle(1_000, 100), candle(2_000, 101), candle(3_000, 102)];
    const btcData = [
      candle(1_000, 200),
      candle(2_000, 201),
      candle(3_000, 202),
    ];
    const restored = runtimeState(2_000);

    await materializeIndicatorCachePlan({
      provider: 'ByBit',
      symbol: 'ETHUSDT',
      interval: 15,
      periods: { maFast: 14 },
      data: data as any,
      btcData: btcData as any,
      paramsHash: 'hash',
      restoreState: restored,
      replayStartIndex: 2,
    });

    expect(mockBuildIndicatorCacheSnapshots).toHaveBeenCalledWith(
      [data[2]],
      [btcData[2]],
      expect.objectContaining({
        includeMlPayload: false,
        periods: { maFast: 14 },
        initialRuntimeState: restored,
      }),
    );
    expect(mockUpsertIndicatorCacheRows).toHaveBeenCalledWith([
      expect.objectContaining({
        provider: 'ByBit',
        symbol: 'ETHUSDT',
        interval: 15,
        paramsHash: 'hash',
        snapshot: expect.objectContaining({ timestamp: 3_000 }),
      }),
    ]);
  });

  it('delegates coverage materialization to restore planning so revised candles are recomputed', async () => {
    const data = [candle(1_000, 100), candle(2_000, 555), candle(3_000, 102)];
    const btcData = [
      candle(1_000, 200),
      candle(2_000, 201),
      candle(3_000, 202),
    ];
    mockGetIndicatorCacheRange.mockResolvedValue([
      { snapshot: cacheRow(1_000, 100, 200) },
      { snapshot: cacheRow(2_000, 101, 201) },
    ]);
    mockBuildIndicatorCacheSnapshots.mockReturnValue([
      {
        timestamp: 2_000,
        candleSignature: 'coin-2',
        btcCandleSignature: 'btc-2',
        ready: true,
        indicatorValues: {},
        baseContext: null,
        runtimeState: runtimeState(2_000),
      },
      {
        timestamp: 3_000,
        candleSignature: 'coin-3',
        btcCandleSignature: 'btc-3',
        ready: true,
        indicatorValues: {},
        baseContext: null,
        runtimeState: runtimeState(3_000),
      },
    ]);

    const result = await ensureIndicatorCacheCoverage({
      provider: 'ByBit',
      symbol: 'ETHUSDT',
      interval: 15,
      periods: { maFast: 14 },
      data: data as any,
      btcData: btcData as any,
    });

    expect(result.cached).toBe(false);
    expect(mockBuildIndicatorCacheSnapshots).toHaveBeenCalledWith(
      data.slice(1),
      btcData.slice(1),
      expect.objectContaining({
        includeMlPayload: false,
        periods: { maFast: 14 },
        initialRuntimeState: runtimeState(1_000),
      }),
    );
  });
});
