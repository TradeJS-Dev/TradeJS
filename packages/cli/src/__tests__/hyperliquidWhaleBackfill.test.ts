const mockHasHyperliquidWhaleBackfillCoverage = jest.fn();
const mockGetHyperliquidWhaleWalletCoverage = jest.fn();
const mockUpsertHyperliquidWhaleWalletCoverage = jest.fn();
const mockUpsertHyperliquidWhaleTradeEvents = jest.fn();
const mockRebuildHyperliquidWhaleFlowRows = jest.fn();
const mockRebuildHyperliquidWhaleCoverageRows = jest.fn();

jest.mock('progress', () =>
  jest
    .fn()
    .mockImplementation((_format: string, options: { total: number }) => ({
      total: options.total,
      tick: jest.fn(),
    })),
);

jest.mock('@tradejs/infra/timescale', () => ({
  hasHyperliquidWhaleBackfillCoverage: (...args: unknown[]) =>
    mockHasHyperliquidWhaleBackfillCoverage(...args),
  getHyperliquidWhaleWalletCoverage: (...args: unknown[]) =>
    mockGetHyperliquidWhaleWalletCoverage(...args),
  upsertHyperliquidWhaleWalletCoverage: (...args: unknown[]) =>
    mockUpsertHyperliquidWhaleWalletCoverage(...args),
  upsertHyperliquidWhaleTradeEvents: (...args: unknown[]) =>
    mockUpsertHyperliquidWhaleTradeEvents(...args),
  rebuildHyperliquidWhaleFlowRows: (...args: unknown[]) =>
    mockRebuildHyperliquidWhaleFlowRows(...args),
  rebuildHyperliquidWhaleCoverageRows: (...args: unknown[]) =>
    mockRebuildHyperliquidWhaleCoverageRows(...args),
}));

const addresses = [
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333',
];

jest.mock('@tradejs/node/strategies', () => ({
  getHyperliquidPerpUniverseSnapshot: () => ({
    fingerprint: 'universe-v1',
    symbols: ['BTC'],
  }),
  getHyperliquidWhaleRegistrySnapshot: () => ({
    fingerprint: 'whales-v1',
    addresses,
  }),
}));

import {
  backfillHyperliquidWhaleContext,
  fetchHyperliquidUserFillsByTime,
} from '../lib/hyperliquidWhaleBackfill';
import { HyperliquidInfoRateLimiter } from '../lib/hyperliquidRateLimiter';
import ProgressBar from 'progress';

describe('hyperliquidWhaleBackfill', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasHyperliquidWhaleBackfillCoverage.mockResolvedValue(false);
    mockGetHyperliquidWhaleWalletCoverage.mockResolvedValue(null);
    mockUpsertHyperliquidWhaleWalletCoverage.mockResolvedValue(undefined);
    mockUpsertHyperliquidWhaleTradeEvents.mockResolvedValue(undefined);
    mockRebuildHyperliquidWhaleFlowRows.mockResolvedValue(12);
    mockRebuildHyperliquidWhaleCoverageRows.mockResolvedValue(20);
  });

  it('uses the public info endpoint without credentials and aggregateByTime', async () => {
    const limiter = { reserve: jest.fn().mockResolvedValue(undefined) };
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          coin: 'BTC',
          px: '100',
          sz: '1',
          time: 10,
          tid: 1,
          side: 'B',
          startPosition: '0',
          dir: 'Open Long',
          closedPnl: '0',
        },
      ],
      text: async () => '',
    });
    const result = await fetchHyperliquidUserFillsByTime({
      address: addresses[0],
      startTime: 1,
      endTime: 100,
      fetchImpl: fetchImpl as typeof fetch,
      rateLimiter: limiter as unknown as HyperliquidInfoRateLimiter,
    });
    expect(result).toMatchObject({ truncated: false, coveredFromMs: 1 });
    expect(result.fills).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.hyperliquid.xyz/info',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"aggregateByTime":true'),
      }),
    );
    expect(limiter.reserve).toHaveBeenCalledTimes(2);
  });

  it('returns and preserves the available 10000 fills when history is truncated', async () => {
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
              startPosition: '0',
            })),
          text: async () => '',
        };
      });
    const result = await fetchHyperliquidUserFillsByTime({
      address: addresses[0],
      startTime: 1,
      endTime: 1_000_000,
      fetchImpl: fetchImpl as typeof fetch,
      rateLimiter: {
        reserve: jest.fn().mockResolvedValue(undefined),
      } as unknown as HyperliquidInfoRateLimiter,
    });
    expect(result).toMatchObject({ truncated: true, coveredFromMs: 60_000 });
    expect(result.fills).toHaveLength(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('continues remaining wallets, stores truncated fills, and materializes coverage', async () => {
    const pageByAddress = new Map<string, number>();
    const fetchImpl = jest
      .fn()
      .mockImplementation(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as {
          user: string;
          startTime: number;
        };
        if (body.user === addresses[2]) {
          return {
            ok: false,
            status: 503,
            json: async () => ({}),
            text: async () => 'unavailable',
          };
        }
        const page = pageByAddress.get(body.user) ?? 0;
        pageByAddress.set(body.user, page + 1);
        const count = body.user === addresses[0] ? 2_000 : 1;
        return {
          ok: true,
          status: 200,
          json: async () =>
            Array.from({ length: count }, (_, index) => ({
              coin: 'BTC',
              px: '100',
              sz: '1',
              time: body.startTime + index,
              tid: `${body.user}-${page}-${index}`,
              side: 'B',
              startPosition: '0',
            })),
          text: async () => '',
        };
      });
    const result = await backfillHyperliquidWhaleContext({
      startMs: 1,
      endMs: 1_000_000,
      cacheOnly: false,
      strict: false,
      concurrency: 2,
      fetchImpl: fetchImpl as typeof fetch,
      wait: async () => undefined,
    });

    expect(result).toMatchObject({
      complete: false,
      walletsProcessed: 3,
      completeWallets: 1,
      truncatedWallets: 1,
      failedWallets: 1,
      fills: 10_001,
      coverageBuckets: 20,
    });
    expect(mockUpsertHyperliquidWhaleTradeEvents).toHaveBeenCalledTimes(2);
    expect(mockUpsertHyperliquidWhaleTradeEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          buyerStartPosition: 0,
          buyerEndPosition: 1,
          buyerPositionAction: 'open',
        }),
      ]),
    );
    expect(mockUpsertHyperliquidWhaleWalletCoverage).toHaveBeenCalledWith(
      expect.objectContaining({
        address: addresses[0],
        status: 'truncated',
        fillsCount: 10_000,
      }),
    );
    expect(mockUpsertHyperliquidWhaleWalletCoverage).toHaveBeenCalledWith(
      expect.objectContaining({ address: addresses[2], status: 'failed' }),
    );
    expect(mockRebuildHyperliquidWhaleFlowRows).toHaveBeenCalled();
    expect(mockRebuildHyperliquidWhaleCoverageRows).toHaveBeenCalledWith(
      expect.objectContaining({ expectedWhales: 3 }),
    );
  });

  it('reuses complete/truncated wallet coverage without requesting those wallets again', async () => {
    mockGetHyperliquidWhaleWalletCoverage.mockResolvedValue({
      status: 'truncated',
    });
    const fetchImpl = jest.fn();
    const result = await backfillHyperliquidWhaleContext({
      startMs: 1,
      endMs: 1_000_000,
      cacheOnly: false,
      strict: false,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result).toMatchObject({
      walletsCached: 3,
      truncatedWallets: 3,
      failedWallets: 0,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mockRebuildHyperliquidWhaleCoverageRows).toHaveBeenCalled();
  });

  it('renders coverage rebuild progress after each completed chunk', async () => {
    mockGetHyperliquidWhaleWalletCoverage.mockResolvedValue({
      status: 'truncated',
    });
    mockRebuildHyperliquidWhaleCoverageRows.mockImplementation(
      async (params: {
        onProgress?: (progress: {
          chunkIndex: number;
          totalChunks: number;
          completedBuckets: number;
          totalBuckets: number;
          rows: number;
        }) => void;
      }) => {
        params.onProgress?.({
          chunkIndex: 1,
          totalChunks: 2,
          completedBuckets: 1,
          totalBuckets: 2,
          rows: 1,
        });
        params.onProgress?.({
          chunkIndex: 2,
          totalChunks: 2,
          completedBuckets: 2,
          totalBuckets: 2,
          rows: 2,
        });
        return 2;
      },
    );

    await backfillHyperliquidWhaleContext({
      startMs: 0,
      endMs: 120_000,
      cacheOnly: false,
      strict: false,
    });

    expect(ProgressBar).toHaveBeenCalledWith(
      expect.stringContaining('Hyperliquid coverage'),
      { total: 2, width: 24 },
    );
    const progressBarMock = ProgressBar as unknown as jest.Mock;
    const progressBar = progressBarMock.mock.results[
      progressBarMock.mock.results.length - 1
    ].value as { tick: jest.Mock };
    expect(progressBar.tick).toHaveBeenNthCalledWith(1, 1, {
      rows: 1,
      chunk: '1/2',
    });
    expect(progressBar.tick).toHaveBeenNthCalledWith(2, 1, {
      rows: 2,
      chunk: '2/2',
    });
  });
});
