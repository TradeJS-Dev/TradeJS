import {
  buildBreadthBackfillChunks,
  shouldBackfillBinanceMarketContextForReplay,
  shouldBackfillBinanceMarketContextForSignals,
} from '../lib/binanceMarketContextBackfill';

describe('buildBreadthBackfillChunks', () => {
  it('splits long breadth backfills into bounded windows with warmup', () => {
    const day = 86_400_000;
    const chunks = buildBreadthBackfillChunks({
      startMs: 1_000,
      endMs: 1_000 + day * 5 - 1,
      intervalMs: 900_000,
      chunkDays: 2,
    });

    expect(chunks).toEqual([
      {
        startMs: 1_000,
        endMs: 1_000 + day * 2 - 1,
        fetchStartMs: 1_000,
      },
      {
        startMs: 1_000 + day * 2,
        endMs: 1_000 + day * 4 - 1,
        fetchStartMs: 1_000,
      },
      {
        startMs: 1_000 + day * 4,
        endMs: 1_000 + day * 5 - 1,
        fetchStartMs: 1_000 + day * 2,
      },
    ]);
  });
});

describe('shouldBackfillBinanceMarketContextForReplay', () => {
  const originalEnabled = process.env.BINANCE_MARKET_CONTEXT_BACKFILL_ENABLED;

  beforeEach(() => {
    delete process.env.BINANCE_MARKET_CONTEXT_BACKFILL_ENABLED;
  });

  afterAll(() => {
    if (originalEnabled === undefined) {
      delete process.env.BINANCE_MARKET_CONTEXT_BACKFILL_ENABLED;
    } else {
      process.env.BINANCE_MARKET_CONTEXT_BACKFILL_ENABLED = originalEnabled;
    }
  });

  it('uses the same cache-only default as signals', () => {
    expect(
      shouldBackfillBinanceMarketContextForReplay({ cacheOnly: false }),
    ).toBe(shouldBackfillBinanceMarketContextForSignals({ cacheOnly: false }));

    expect(
      shouldBackfillBinanceMarketContextForReplay({ cacheOnly: true }),
    ).toBe(shouldBackfillBinanceMarketContextForSignals({ cacheOnly: true }));
  });

  it('can be disabled explicitly by env flag', () => {
    process.env.BINANCE_MARKET_CONTEXT_BACKFILL_ENABLED = 'false';

    expect(
      shouldBackfillBinanceMarketContextForReplay({ cacheOnly: false }),
    ).toBe(false);
  });
});
