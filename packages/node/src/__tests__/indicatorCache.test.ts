const mockBuildIndicatorCacheSnapshots = jest.fn();
const mockGetIndicatorCacheCoverage = jest.fn();
const mockUpsertIndicatorCacheRows = jest.fn();

jest.mock('@tradejs/core/indicators', () => ({
  buildIndicatorCacheSnapshots: (...args: unknown[]) =>
    mockBuildIndicatorCacheSnapshots(...args),
}));

jest.mock('@tradejs/infra/timescale', () => ({
  getIndicatorCacheCoverage: (...args: unknown[]) =>
    mockGetIndicatorCacheCoverage(...args),
  upsertIndicatorCacheRows: (...args: unknown[]) =>
    mockUpsertIndicatorCacheRows(...args),
}));

import {
  buildIndicatorCacheParamsHash,
  ensureIndicatorCacheCoverage,
} from '../indicatorCache';

const candle = (timestamp: number) => ({
  timestamp,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 1,
  turnover: 1,
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

  it('skips materialization when full cache coverage already exists', async () => {
    mockGetIndicatorCacheCoverage.mockResolvedValue({
      min: 1_000,
      max: 2_000,
      count: 2,
    });

    const result = await ensureIndicatorCacheCoverage({
      provider: 'ByBit',
      symbol: 'ETHUSDT',
      interval: 15,
      periods: { maFast: 14 },
      data: [candle(1_000), candle(2_000)] as any,
      btcData: [candle(1_000), candle(2_000)] as any,
    });

    expect(result.cached).toBe(true);
    expect(mockBuildIndicatorCacheSnapshots).not.toHaveBeenCalled();
    expect(mockUpsertIndicatorCacheRows).not.toHaveBeenCalled();
  });

  it('materializes and stores snapshots when cache coverage is incomplete', async () => {
    mockGetIndicatorCacheCoverage.mockResolvedValue({
      min: undefined,
      max: undefined,
      count: 0,
    });
    mockBuildIndicatorCacheSnapshots.mockReturnValue([
      {
        timestamp: 1_000,
        ready: false,
        indicatorValues: {},
        baseContext: null,
      },
      {
        timestamp: 2_000,
        ready: true,
        indicatorValues: { maFast: 100 },
        baseContext: { raw: { trend: { maFast: 100 } } },
      },
    ]);

    const result = await ensureIndicatorCacheCoverage({
      provider: 'ByBit',
      symbol: 'ETHUSDT',
      interval: 15,
      periods: { maFast: 14 },
      data: [candle(1_000), candle(2_000)] as any,
      btcData: [candle(1_000), candle(2_000)] as any,
      btcBinanceData: [candle(1_000), candle(2_000)] as any,
      btcCoinbaseData: [candle(1_000), candle(2_000)] as any,
    });

    expect(result.cached).toBe(false);
    expect(mockBuildIndicatorCacheSnapshots).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      expect.objectContaining({
        includeMlPayload: false,
        periods: { maFast: 14 },
      }),
    );
    expect(mockUpsertIndicatorCacheRows).toHaveBeenCalledWith([
      expect.objectContaining({
        provider: 'ByBit',
        symbol: 'ETHUSDT',
        interval: 15,
        ts: new Date(1_000),
        snapshot: expect.objectContaining({ timestamp: 1_000 }),
      }),
      expect.objectContaining({
        provider: 'ByBit',
        symbol: 'ETHUSDT',
        interval: 15,
        ts: new Date(2_000),
        snapshot: expect.objectContaining({ timestamp: 2_000 }),
      }),
    ]);
  });
});
