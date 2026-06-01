const mockBackfillDerivativesContextForBacktest = jest.fn();
const mockBackfillDerivativesContextForSignals = jest.fn();
const mockShouldBackfillDerivativesContextForBacktest = jest.fn();
const mockShouldBackfillDerivativesContextForSignals = jest.fn();
const mockBackfillBinanceMarketContextForBacktest = jest.fn();
const mockBackfillBinanceMarketContextForReplay = jest.fn();
const mockBackfillBinanceMarketContextForSignals = jest.fn();
const mockShouldBackfillBinanceMarketContextForBacktest = jest.fn();
const mockShouldBackfillBinanceMarketContextForReplay = jest.fn();
const mockShouldBackfillBinanceMarketContextForSignals = jest.fn();

jest.mock('../lib/derivativesContextBackfill', () => ({
  backfillDerivativesContextForBacktest: (...args: unknown[]) =>
    mockBackfillDerivativesContextForBacktest(...args),
  backfillDerivativesContextForSignals: (...args: unknown[]) =>
    mockBackfillDerivativesContextForSignals(...args),
  shouldBackfillDerivativesContextForBacktest: (...args: unknown[]) =>
    mockShouldBackfillDerivativesContextForBacktest(...args),
  shouldBackfillDerivativesContextForSignals: (...args: unknown[]) =>
    mockShouldBackfillDerivativesContextForSignals(...args),
}));

jest.mock('../lib/binanceMarketContextBackfill', () => ({
  backfillBinanceMarketContextForBacktest: (...args: unknown[]) =>
    mockBackfillBinanceMarketContextForBacktest(...args),
  backfillBinanceMarketContextForReplay: (...args: unknown[]) =>
    mockBackfillBinanceMarketContextForReplay(...args),
  backfillBinanceMarketContextForSignals: (...args: unknown[]) =>
    mockBackfillBinanceMarketContextForSignals(...args),
  shouldBackfillBinanceMarketContextForBacktest: (...args: unknown[]) =>
    mockShouldBackfillBinanceMarketContextForBacktest(...args),
  shouldBackfillBinanceMarketContextForReplay: (...args: unknown[]) =>
    mockShouldBackfillBinanceMarketContextForReplay(...args),
  shouldBackfillBinanceMarketContextForSignals: (...args: unknown[]) =>
    mockShouldBackfillBinanceMarketContextForSignals(...args),
}));

import { prepareMarketContextForRun } from '../lib/marketContextPrepare';

describe('prepareMarketContextForRun', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBackfillDerivativesContextForBacktest.mockResolvedValue({});
    mockBackfillDerivativesContextForSignals.mockResolvedValue({});
    mockBackfillBinanceMarketContextForBacktest.mockResolvedValue({});
    mockBackfillBinanceMarketContextForReplay.mockResolvedValue({});
    mockBackfillBinanceMarketContextForSignals.mockResolvedValue({});
    mockShouldBackfillDerivativesContextForBacktest.mockReturnValue(false);
    mockShouldBackfillDerivativesContextForSignals.mockReturnValue(false);
    mockShouldBackfillBinanceMarketContextForBacktest.mockReturnValue(false);
    mockShouldBackfillBinanceMarketContextForReplay.mockReturnValue(false);
    mockShouldBackfillBinanceMarketContextForSignals.mockReturnValue(false);
  });

  it('routes backtest context through AI/ML-aware backfill policies', async () => {
    mockShouldBackfillDerivativesContextForBacktest.mockReturnValue(true);
    mockShouldBackfillBinanceMarketContextForBacktest.mockReturnValue(true);

    await prepareMarketContextForRun({
      mode: 'backtest',
      userName: 'root',
      projectRoot: '/repo',
      symbols: ['BTCUSDT'],
      interval: '15',
      startMs: 1_000,
      endMs: 2_000,
      preloadStartMs: 500,
      cacheOnly: false,
      aiEnabled: true,
      mlEnabled: false,
      log: jest.fn(),
    });

    expect(
      mockShouldBackfillDerivativesContextForBacktest,
    ).toHaveBeenCalledWith({
      aiEnabled: true,
      cacheOnly: false,
      mlEnabled: false,
    });
    expect(mockBackfillDerivativesContextForBacktest).toHaveBeenCalledWith({
      userName: 'root',
      symbols: ['BTCUSDT'],
      startMs: 1_000,
      endMs: 2_000,
      preloadStartMs: 500,
    });
    expect(mockBackfillBinanceMarketContextForBacktest).toHaveBeenCalledWith({
      userName: 'root',
      projectRoot: '/repo',
      symbols: ['BTCUSDT'],
      interval: '15',
      startMs: 1_000,
      endMs: 2_000,
      preloadStartMs: 500,
    });
  });

  it('routes signals context through live-mode policies', async () => {
    mockShouldBackfillDerivativesContextForSignals.mockReturnValue(true);
    mockShouldBackfillBinanceMarketContextForSignals.mockReturnValue(true);

    await prepareMarketContextForRun({
      mode: 'signals',
      userName: 'root',
      projectRoot: '/repo',
      symbols: ['ETHUSDT'],
      interval: '15',
      startMs: 1_000,
      endMs: 1_000,
      preloadStartMs: 0,
      cacheOnly: false,
      log: jest.fn(),
    });

    expect(mockBackfillDerivativesContextForSignals).toHaveBeenCalled();
    expect(mockBackfillBinanceMarketContextForSignals).toHaveBeenCalled();
    expect(mockBackfillDerivativesContextForBacktest).not.toHaveBeenCalled();
  });

  it('routes replay and parity binance context through replay policy', async () => {
    mockShouldBackfillBinanceMarketContextForReplay.mockReturnValue(true);

    await prepareMarketContextForRun({
      mode: 'parity',
      userName: 'root',
      projectRoot: '/repo',
      symbols: ['SOLUSDT'],
      interval: '15',
      startMs: 1_000,
      endMs: 2_000,
      cacheOnly: false,
      aiEnabled: false,
      mlEnabled: false,
      log: jest.fn(),
    });

    expect(
      mockShouldBackfillBinanceMarketContextForReplay,
    ).toHaveBeenCalledWith({
      cacheOnly: false,
    });
    expect(mockBackfillBinanceMarketContextForReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        symbols: ['SOLUSDT'],
      }),
    );
  });
});
