import { createHash } from 'node:crypto';

const mockCreateIndicators = jest.fn();
const mockDeleteIndicatorCacheObsoleteVersions = jest.fn();
const mockGetIndicatorCacheManifest = jest.fn();
const mockGetIndicatorCacheRange = jest.fn();
const mockGetLatestIndicatorCacheCheckpointAtOrBefore = jest.fn();
const mockUpsertIndicatorCacheCoverageRows = jest.fn();
const mockUpsertIndicatorCacheCheckpointRows = jest.fn();
const mockUpsertIndicatorCacheManifest = jest.fn();

jest.mock('@tradejs/core/indicators', () => ({
  createIndicators: (...args: unknown[]) => mockCreateIndicators(...args),
}));

jest.mock('@tradejs/infra/timescale', () => ({
  deleteIndicatorCacheObsoleteVersions: (...args: unknown[]) =>
    mockDeleteIndicatorCacheObsoleteVersions(...args),
  getIndicatorCacheManifest: (...args: unknown[]) =>
    mockGetIndicatorCacheManifest(...args),
  getIndicatorCacheRange: (...args: unknown[]) =>
    mockGetIndicatorCacheRange(...args),
  getLatestIndicatorCacheCheckpointAtOrBefore: (...args: unknown[]) =>
    mockGetLatestIndicatorCacheCheckpointAtOrBefore(...args),
  upsertIndicatorCacheCoverageRows: (...args: unknown[]) =>
    mockUpsertIndicatorCacheCoverageRows(...args),
  upsertIndicatorCacheCheckpointRows: (...args: unknown[]) =>
    mockUpsertIndicatorCacheCheckpointRows(...args),
  upsertIndicatorCacheManifest: (...args: unknown[]) =>
    mockUpsertIndicatorCacheManifest(...args),
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

const candleSignature = (nextCandle: ReturnType<typeof candle> | undefined) =>
  nextCandle == null
    ? null
    : `${nextCandle.timestamp}:${nextCandle.open}:${nextCandle.high}:${nextCandle.low}:${nextCandle.close}:${nextCandle.volume}:${nextCandle.turnover}`;

const rangeDigest = (candles: Array<ReturnType<typeof candle>> | undefined) => {
  if (!candles?.length) return 'empty';
  const hash = createHash('sha1');
  hash.update(String(candles.length));
  for (const nextCandle of candles) {
    hash.update('|');
    hash.update(candleSignature(nextCandle) ?? 'null');
  }
  return hash.digest('hex');
};

const manifestDigest = (params: {
  data: Array<ReturnType<typeof candle>>;
  btcData: Array<ReturnType<typeof candle>>;
  btcBinanceData?: Array<ReturnType<typeof candle>>;
  btcCoinbaseData?: Array<ReturnType<typeof candle>>;
}) =>
  createHash('sha1')
    .update(
      [
        rangeDigest(params.data),
        rangeDigest(params.btcData),
        rangeDigest(params.btcBinanceData),
        rangeDigest(params.btcCoinbaseData),
      ].join(':'),
    )
    .digest('hex');

describe('indicatorCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetIndicatorCacheInMemoryState();
    mockDeleteIndicatorCacheObsoleteVersions.mockResolvedValue(undefined);
    mockGetIndicatorCacheManifest.mockResolvedValue(null);
    mockUpsertIndicatorCacheManifest.mockResolvedValue(undefined);
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
    expect(
      buildIndicatorCacheParamsHash({
        provider: 'ByBit',
        interval: 15,
        periods: { maFast: 14, maSlow: 50 },
        btcProvider: 'ByBit',
      }),
    ).not.toBe(
      buildIndicatorCacheParamsHash({
        provider: 'ByBit',
        interval: 15,
        periods: { maFast: 14, maSlow: 50 },
        btcProvider: 'ByBit',
        baseContextBackend: jest.fn(),
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

  it('uses a matching manifest as a full-range fast path without reading coverage rows', async () => {
    const data = [candle(1_000, 100), candle(2_000, 101)];
    const btcData = [candle(1_000, 200), candle(2_000, 201)];
    mockGetIndicatorCacheManifest.mockResolvedValue({
      rangeDigest: manifestDigest({ data, btcData }),
      lastCheckpointTs: new Date(2_000),
    });
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
    expect(plan.restoreState).toEqual(runtimeState(2_000));
    expect(mockGetIndicatorCacheRange).not.toHaveBeenCalled();
    expect(
      mockGetLatestIndicatorCacheCheckpointAtOrBefore,
    ).toHaveBeenCalledWith(expect.objectContaining({ tsMs: 2_000 }));
  });

  it('falls back to coverage comparison when the manifest digest is stale', async () => {
    const data = [candle(1_000, 100), candle(2_000, 101)];
    const btcData = [candle(1_000, 200), candle(2_000, 201)];
    mockGetIndicatorCacheManifest.mockResolvedValue({
      rangeDigest: 'stale',
      lastCheckpointTs: new Date(2_000),
    });
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
    expect(mockGetIndicatorCacheRange).toHaveBeenCalled();
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
    expect(mockUpsertIndicatorCacheManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'ByBit',
        symbol: 'ETHUSDT',
        interval: 15,
        paramsHash: 'hash',
        startTs: new Date(1_000),
        endTs: new Date(3_000),
        rowCount: 3,
        lastCheckpointTs: new Date(3_000),
      }),
    );
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
    expect(mockUpsertIndicatorCacheManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        startTs: new Date(1_000),
        endTs: new Date(2_000),
        rowCount: 2,
      }),
    );
  });

  it('does not rewrite manifest rows when restore plan already came from manifest', async () => {
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
      manifestCached: true,
    });

    expect(mockCreateIndicators).not.toHaveBeenCalled();
    expect(mockUpsertIndicatorCacheCoverageRows).not.toHaveBeenCalled();
    expect(mockUpsertIndicatorCacheCheckpointRows).not.toHaveBeenCalled();
    expect(mockUpsertIndicatorCacheManifest).not.toHaveBeenCalled();
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
