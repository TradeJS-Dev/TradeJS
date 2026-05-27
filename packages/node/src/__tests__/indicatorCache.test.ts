const mockCreateIndicators = jest.fn();
const mockDeleteIndicatorCacheObsoleteVersions = jest.fn();
const mockGetIndicatorCacheRange = jest.fn();
const mockGetLatestIndicatorCacheCheckpointAtOrBefore = jest.fn();
const mockUpsertIndicatorCacheCoverageRows = jest.fn();
const mockUpsertIndicatorCacheCheckpointRows = jest.fn();

jest.mock('@tradejs/core/indicators', () => ({
  createIndicators: (...args: unknown[]) => mockCreateIndicators(...args),
}));

jest.mock('@tradejs/infra/timescale', () => ({
  deleteIndicatorCacheObsoleteVersions: (...args: unknown[]) =>
    mockDeleteIndicatorCacheObsoleteVersions(...args),
  getIndicatorCacheRange: (...args: unknown[]) =>
    mockGetIndicatorCacheRange(...args),
  getLatestIndicatorCacheCheckpointAtOrBefore: (...args: unknown[]) =>
    mockGetLatestIndicatorCacheCheckpointAtOrBefore(...args),
  upsertIndicatorCacheCoverageRows: (...args: unknown[]) =>
    mockUpsertIndicatorCacheCoverageRows(...args),
  upsertIndicatorCacheCheckpointRows: (...args: unknown[]) =>
    mockUpsertIndicatorCacheCheckpointRows(...args),
}));

import {
  buildIndicatorCacheParamsHash,
  ensureIndicatorCacheCoverage,
  materializeIndicatorCachePlan,
  planIndicatorCacheRestore,
  resetIndicatorCacheInMemoryState,
  resolveIndicatorCacheRuntimeState,
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
  runtimeState: runtimeState(timestamp),
});

describe('indicatorCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetIndicatorCacheInMemoryState();
    mockDeleteIndicatorCacheObsoleteVersions.mockResolvedValue(undefined);
    mockCreateIndicators.mockImplementation(() => {
      let lastTimestamp = 0;
      return {
        next: (nextCandle: { timestamp: number }) => {
          lastTimestamp = nextCandle.timestamp;
          return {};
        },
        checkpointRuntimeState: () => runtimeState(lastTimestamp),
      };
    });
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
    mockGetLatestIndicatorCacheCheckpointAtOrBefore.mockResolvedValue({
      snapshot: {
        timestamp: 2_000,
        runtimeState: runtimeState(2_000),
      },
    });

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
    expect(mockDeleteIndicatorCacheObsoleteVersions).not.toHaveBeenCalled();
  });

  it('replays from the restored checkpoint rather than from uncaptured cached coverage', async () => {
    const data = [
      candle(1_000, 100),
      candle(2_000, 101),
      candle(3_000, 102),
      candle(4_000, 103),
    ];
    const btcData = [
      candle(1_000, 200),
      candle(2_000, 201),
      candle(3_000, 202),
      candle(4_000, 203),
    ];
    mockGetIndicatorCacheRange.mockResolvedValue([
      { snapshot: cacheRow(1_000, 100, 200) },
      { snapshot: cacheRow(2_000, 101, 201) },
      { snapshot: cacheRow(3_000, 102, 202) },
    ]);
    mockGetLatestIndicatorCacheCheckpointAtOrBefore.mockResolvedValue({
      snapshot: {
        timestamp: 1_000,
        runtimeState: runtimeState(1_000),
      },
    });

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
    mockGetLatestIndicatorCacheCheckpointAtOrBefore.mockResolvedValue({
      snapshot: {
        timestamp: 1_000,
        runtimeState: runtimeState(1_000),
      },
    });

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
    mockGetLatestIndicatorCacheCheckpointAtOrBefore.mockResolvedValue({
      snapshot: {
        timestamp: 2_000,
        runtimeState: runtimeState(2_000),
      },
    });

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
    const data = [candle(1_000, 100), candle(2_000, 101), candle(3_000, 102)];
    const btcData = [
      candle(1_000, 200),
      candle(2_000, 201),
      candle(3_000, 202),
    ];
    const restored = runtimeState(2_000);
    const baseContextBackend = jest.fn();

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
      cached: false,
      baseContextBackend,
    });

    expect(mockCreateIndicators).toHaveBeenCalledWith(
      [],
      [],
      expect.objectContaining({
        includeMlPayload: false,
        runtimeOnly: true,
        periods: { maFast: 14 },
        initialRuntimeState: restored,
        baseContextBackend,
      }),
    );
    expect(mockUpsertIndicatorCacheCoverageRows).toHaveBeenCalledWith([
      expect.objectContaining({
        provider: 'ByBit',
        symbol: 'ETHUSDT',
        interval: 15,
        paramsHash: 'hash',
        snapshot: expect.objectContaining({
          timestamp: 3_000,
          candleSignature: cacheRow(3_000, 102, 202).candleSignature,
          btcCandleSignature: cacheRow(3_000, 102, 202).btcCandleSignature,
          ready: true,
        }),
      }),
    ]);
    expect(mockUpsertIndicatorCacheCheckpointRows).toHaveBeenCalledWith([
      expect.objectContaining({
        provider: 'ByBit',
        symbol: 'ETHUSDT',
        interval: 15,
        paramsHash: 'hash',
        snapshot: expect.objectContaining({
          timestamp: 3_000,
          runtimeState: runtimeState(3_000),
        }),
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
    mockGetLatestIndicatorCacheCheckpointAtOrBefore.mockResolvedValue({
      snapshot: {
        timestamp: 1_000,
        runtimeState: runtimeState(1_000),
      },
    });
    const result = await ensureIndicatorCacheCoverage({
      provider: 'ByBit',
      symbol: 'ETHUSDT',
      interval: 15,
      periods: { maFast: 14 },
      data: data as any,
      btcData: btcData as any,
    });

    expect(result.cached).toBe(false);
    expect(mockCreateIndicators).toHaveBeenCalledWith(
      [],
      [],
      expect.objectContaining({
        includeMlPayload: false,
        runtimeOnly: true,
        periods: { maFast: 14 },
        initialRuntimeState: runtimeState(1_000),
      }),
    );
  });

  it('skips rematerialization when full lightweight coverage already exists', async () => {
    await materializeIndicatorCachePlan({
      provider: 'ByBit',
      symbol: 'ETHUSDT',
      interval: 15,
      periods: { maFast: 14 },
      data: [candle(1_000, 100), candle(2_000, 101)] as any,
      btcData: [candle(1_000, 200), candle(2_000, 201)] as any,
      paramsHash: 'hash',
      restoreState: runtimeState(2_000),
      replayStartIndex: 2,
      cached: true,
    });

    expect(mockCreateIndicators).not.toHaveBeenCalled();
    expect(mockUpsertIndicatorCacheCoverageRows).not.toHaveBeenCalled();
    expect(mockUpsertIndicatorCacheCheckpointRows).not.toHaveBeenCalled();
  });

  it('resolves a replay suffix to an in-memory runtime checkpoint without cache writes', () => {
    const data = [candle(1_000, 100), candle(2_000, 101), candle(3_000, 102)];
    const btcData = [
      candle(1_000, 200),
      candle(2_000, 201),
      candle(3_000, 202),
    ];
    const baseContextBackend = jest.fn();

    const result = resolveIndicatorCacheRuntimeState({
      provider: 'ByBit',
      symbol: 'ETHUSDT',
      interval: 15,
      periods: { maFast: 14 },
      data: data as any,
      btcData: btcData as any,
      paramsHash: 'hash',
      version: 'v-test',
      restoreState: runtimeState(1_000),
      replayStartIndex: 1,
      cached: false,
      baseContextBackend,
    });

    expect(result).toEqual(
      expect.objectContaining({
        cached: true,
        replayStartIndex: 3,
        restoreState: runtimeState(3_000),
      }),
    );
    expect(mockCreateIndicators).toHaveBeenCalledWith(
      [],
      [],
      expect.objectContaining({
        includeMlPayload: false,
        runtimeOnly: true,
        periods: { maFast: 14 },
        initialRuntimeState: runtimeState(1_000),
        baseContextBackend,
      }),
    );
    expect(mockUpsertIndicatorCacheCoverageRows).not.toHaveBeenCalled();
    expect(mockUpsertIndicatorCacheCheckpointRows).not.toHaveBeenCalled();
  });

  it('reuses runtime checkpoints for equivalent candle ranges with different array instances', () => {
    const data = [candle(1_000, 100), candle(2_000, 101), candle(3_000, 102)];
    const btcData = [
      candle(1_000, 200),
      candle(2_000, 201),
      candle(3_000, 202),
    ];

    const first = resolveIndicatorCacheRuntimeState({
      provider: 'ByBit',
      symbol: 'ETHUSDT',
      interval: 15,
      periods: { maFast: 14 },
      data: data as any,
      btcData: btcData as any,
      paramsHash: 'hash',
      version: 'v-test',
      restoreState: runtimeState(1_000),
      replayStartIndex: 1,
      cached: false,
    });
    const second = resolveIndicatorCacheRuntimeState({
      provider: 'ByBit',
      symbol: 'ETHUSDT',
      interval: 15,
      periods: { maFast: 14 },
      data: data.slice() as any,
      btcData: btcData.slice() as any,
      paramsHash: 'hash',
      version: 'v-test',
      restoreState: runtimeState(1_000),
      replayStartIndex: 1,
      cached: false,
    });

    expect(first).toEqual(second);
    expect(mockCreateIndicators).toHaveBeenCalledTimes(1);
  });
});
