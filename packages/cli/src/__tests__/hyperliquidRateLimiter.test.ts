import { HyperliquidInfoRateLimiter } from '../lib/hyperliquidRateLimiter';

describe('HyperliquidInfoRateLimiter', () => {
  it('shares one rolling weight budget across concurrent callers', async () => {
    let nowMs = 0;
    const wait = jest.fn(async (ms: number) => {
      nowMs += ms;
    });
    const limiter = new HyperliquidInfoRateLimiter(100, () => nowMs, wait);

    await Promise.all([limiter.reserve(60), limiter.reserve(40)]);
    await limiter.reserve(1);

    expect(wait).toHaveBeenCalledWith(60_000);
    expect(nowMs).toBe(60_000);
  });
});
