const mockHasHyperliquidWhaleBackfillCoverage = jest.fn();
const mockGetHyperliquidWhaleBackfillFailure = jest.fn();
const mockUpsertHyperliquidWhaleBackfillFailure = jest.fn();
const mockUpsertHyperliquidWhaleTradeEvents = jest.fn();
const mockRebuildHyperliquidWhaleFlowRows = jest.fn();
const mockUpsertHyperliquidWhaleBackfillCoverage = jest.fn();

jest.mock('@tradejs/infra/timescale', () => ({
  hasHyperliquidWhaleBackfillCoverage: (...args: unknown[]) =>
    mockHasHyperliquidWhaleBackfillCoverage(...args),
  getHyperliquidWhaleBackfillFailure: (...args: unknown[]) =>
    mockGetHyperliquidWhaleBackfillFailure(...args),
  upsertHyperliquidWhaleBackfillFailure: (...args: unknown[]) =>
    mockUpsertHyperliquidWhaleBackfillFailure(...args),
  upsertHyperliquidWhaleTradeEvents: (...args: unknown[]) =>
    mockUpsertHyperliquidWhaleTradeEvents(...args),
  rebuildHyperliquidWhaleFlowRows: (...args: unknown[]) =>
    mockRebuildHyperliquidWhaleFlowRows(...args),
  upsertHyperliquidWhaleBackfillCoverage: (...args: unknown[]) =>
    mockUpsertHyperliquidWhaleBackfillCoverage(...args),
}));

jest.mock('@tradejs/node/strategies', () => ({
  getHyperliquidPerpUniverseSnapshot: () => ({
    fingerprint: 'universe-v1',
    symbols: ['BTC'],
  }),
  getHyperliquidWhaleRegistrySnapshot: () => ({
    fingerprint: 'whales-v1',
    addresses: ['0x1111111111111111111111111111111111111111'],
  }),
}));

import {
  backfillHyperliquidWhaleContext,
  fetchHyperliquidUserFillsByTime,
} from '../lib/hyperliquidWhaleBackfill';

describe('hyperliquidWhaleBackfill', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasHyperliquidWhaleBackfillCoverage.mockResolvedValue(false);
    mockGetHyperliquidWhaleBackfillFailure.mockResolvedValue(null);
    mockUpsertHyperliquidWhaleBackfillFailure.mockResolvedValue(undefined);
    mockUpsertHyperliquidWhaleTradeEvents.mockResolvedValue(undefined);
    mockRebuildHyperliquidWhaleFlowRows.mockResolvedValue(0);
    mockUpsertHyperliquidWhaleBackfillCoverage.mockResolvedValue(undefined);
  });

  it('uses the public info endpoint without credentials and applies adaptive pacing', async () => {
    const wait = jest.fn().mockResolvedValue(undefined);
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { coin: 'BTC', px: '100', sz: '1', time: 10, tid: 1, side: 'B' },
      ],
      text: async () => '',
    });
    const rows = await fetchHyperliquidUserFillsByTime({
      address: '0x1111111111111111111111111111111111111111',
      startTime: 1,
      endTime: 100,
      fetchImpl: fetchImpl as typeof fetch,
      wait,
    });
    expect(rows).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.hyperliquid.xyz/info',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"type":"userFillsByTime"'),
      }),
    );
    expect(wait).toHaveBeenCalledWith(expect.any(Number));
  });

  it('fails closed instead of marking truncated history as complete', async () => {
    const fetchImpl = jest
      .fn()
      .mockImplementation(async (_url: string, init: { body: string }) => {
        const startTime = Number(JSON.parse(init.body).startTime);
        return {
          ok: true,
          status: 200,
          json: async () =>
            Array.from({ length: 2_000 }, (_, index) => ({
              coin: 'BTC',
              px: '100',
              sz: '1',
              time: startTime + index,
              tid: startTime + index,
              side: 'B',
            })),
          text: async () => '',
        };
      });
    await expect(
      fetchHyperliquidUserFillsByTime({
        address: '0x1111111111111111111111111111111111111111',
        startTime: 1,
        endTime: 1_000_000,
        fetchImpl: fetchImpl as typeof fetch,
        wait: async () => undefined,
      }),
    ).rejects.toThrow('use an S3 node_fills export');
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('keeps an automatic backtest running and caches an unavailable REST range', async () => {
    const fetchImpl = jest
      .fn()
      .mockImplementation(async (_url: string, init: { body: string }) => {
        const startTime = Number(JSON.parse(init.body).startTime);
        return {
          ok: true,
          status: 200,
          json: async () =>
            Array.from({ length: 2_000 }, (_, index) => ({
              coin: 'BTC',
              px: '100',
              sz: '1',
              time: startTime + index,
              tid: startTime + index,
              side: 'B',
            })),
          text: async () => '',
        };
      });
    const log = jest.fn();
    const result = await backfillHyperliquidWhaleContext({
      startMs: 1,
      endMs: 1_000_000,
      cacheOnly: false,
      strict: false,
      fetchImpl: fetchImpl as typeof fetch,
      wait: async () => undefined,
      log,
    });

    expect(result).toMatchObject({
      complete: false,
      failureCached: false,
      buckets: 0,
    });
    expect(mockUpsertHyperliquidWhaleBackfillFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        universeFingerprint: 'universe-v1',
        whaleRegistryFingerprint: 'whales-v1',
      }),
    );
    expect(mockRebuildHyperliquidWhaleFlowRows).not.toHaveBeenCalled();
    expect(mockUpsertHyperliquidWhaleBackfillCoverage).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('continuing without incomplete context'),
    );
  });

  it('skips a previously failed automatic range without another API request', async () => {
    mockGetHyperliquidWhaleBackfillFailure.mockResolvedValue({
      reason: 'history limit',
      failedAt: new Date(1_000),
    });
    const fetchImpl = jest.fn();
    const result = await backfillHyperliquidWhaleContext({
      startMs: 1,
      endMs: 1_000_000,
      cacheOnly: false,
      strict: false,
      fetchImpl: fetchImpl as typeof fetch,
      wait: async () => undefined,
    });

    expect(result).toMatchObject({
      complete: false,
      failureCached: true,
      skippedReason: 'history limit',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
