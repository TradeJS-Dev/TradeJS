import {
  shouldBackfillBinanceMarketContextForReplay,
  shouldBackfillBinanceMarketContextForSignals,
} from '../lib/binanceMarketContextBackfill';

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
