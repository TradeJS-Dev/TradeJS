const mockEnrichSignalWithBinanceMarketContext = jest.fn();
const mockEnrichSignalWithCoinMarketCapContext = jest.fn();
const mockEnrichSignalWithDerivativesContext = jest.fn();
const mockEnrichSignalWithHyperliquidWhaleContext = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
}));

jest.mock('../strategyHelpers/binanceMarketContext', () => ({
  enrichSignalWithBinanceMarketContext: (params: unknown) =>
    mockEnrichSignalWithBinanceMarketContext(params),
}));

jest.mock('../strategyHelpers/coinMarketCapContext', () => ({
  enrichSignalWithCoinMarketCapContext: (params: unknown) =>
    mockEnrichSignalWithCoinMarketCapContext(params),
}));

jest.mock('../strategyHelpers/derivativesContext', () => ({
  enrichSignalWithDerivativesContext: (params: unknown) =>
    mockEnrichSignalWithDerivativesContext(params),
}));

jest.mock('../strategyHelpers/hyperliquidWhaleContext', () => ({
  enrichSignalWithHyperliquidWhaleContext: (params: unknown) =>
    mockEnrichSignalWithHyperliquidWhaleContext(params),
}));

import {
  enrichSignalWithMarketContextStages,
  resolveMarketContextStageTimeoutMs,
} from '../strategyHelpers/marketContextStages';

const signal = { signalId: 'signal-1' } as any;

describe('strategyHelpers/marketContextStages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.MARKET_CONTEXT_STAGE_TIMEOUT_MS;
    delete process.env.BINANCE_MARKET_CONTEXT_STAGE_TIMEOUT_MS;
    delete process.env.COINMARKETCAP_CONTEXT_STAGE_TIMEOUT_MS;
    delete process.env.DERIVATIVES_CONTEXT_STAGE_TIMEOUT_MS;
    delete process.env.HYPERLIQUID_WHALE_CONTEXT_STAGE_TIMEOUT_MS;
    mockEnrichSignalWithBinanceMarketContext.mockResolvedValue(true);
    mockEnrichSignalWithCoinMarketCapContext.mockResolvedValue(false);
    mockEnrichSignalWithDerivativesContext.mockResolvedValue(true);
    mockEnrichSignalWithHyperliquidWhaleContext.mockResolvedValue(true);
  });

  it('runs each context source as a separately observable stage', async () => {
    const started: string[] = [];
    const completed: string[] = [];

    await expect(
      enrichSignalWithMarketContextStages({
        signal,
        env: 'BACKTEST',
        onStageStart: (stage) => started.push(stage),
        onStageComplete: ({ stage }) => completed.push(stage),
      }),
    ).resolves.toEqual([
      expect.objectContaining({ stage: 'binance', status: 'available' }),
      expect.objectContaining({ stage: 'coinmarketcap', status: 'absent' }),
      expect.objectContaining({ stage: 'derivatives', status: 'available' }),
      expect.objectContaining({
        stage: 'hyperliquidWhales',
        status: 'available',
      }),
    ]);

    expect(started).toEqual([
      'binance',
      'coinmarketcap',
      'derivatives',
      'hyperliquidWhales',
    ]);
    expect(completed).toEqual(started);
  });

  it('aborts a timed-out stage and continues with the next source', async () => {
    process.env.BINANCE_MARKET_CONTEXT_STAGE_TIMEOUT_MS = '5';
    mockEnrichSignalWithBinanceMarketContext.mockImplementation(
      ({ abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise((_, reject) => {
          abortSignal.addEventListener(
            'abort',
            () => reject(new Error('cancelled query')),
            { once: true },
          );
        }),
    );

    const result = await enrichSignalWithMarketContextStages({
      signal,
      env: 'BACKTEST',
      includeHyperliquidWhales: false,
    });

    expect(result).toEqual([
      expect.objectContaining({ stage: 'binance', status: 'timed_out' }),
      expect.objectContaining({ stage: 'coinmarketcap', status: 'absent' }),
      expect.objectContaining({ stage: 'derivatives', status: 'available' }),
    ]);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Market context stage timed out: %s after %sms',
      'binance',
      expect.any(Number),
    );
  });

  it('does not hide a source failure when no cancellation occurred', async () => {
    mockEnrichSignalWithBinanceMarketContext.mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(
      enrichSignalWithMarketContextStages({
        signal,
        env: 'BACKTEST',
        includeHyperliquidWhales: false,
      }),
    ).rejects.toThrow('database unavailable');
  });

  it('classifies a lower-level SQL timeout and continues with other sources', async () => {
    const timeoutError = new Error('query timeout');
    timeoutError.name = 'TimescaleQueryTimeoutError';
    mockEnrichSignalWithBinanceMarketContext.mockRejectedValue(timeoutError);

    await expect(
      enrichSignalWithMarketContextStages({
        signal,
        env: 'BACKTEST',
        includeHyperliquidWhales: false,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ stage: 'binance', status: 'timed_out' }),
      expect.objectContaining({ stage: 'coinmarketcap', status: 'absent' }),
      expect.objectContaining({ stage: 'derivatives', status: 'available' }),
    ]);
    expect(mockEnrichSignalWithCoinMarketCapContext).toHaveBeenCalledTimes(1);
    expect(mockEnrichSignalWithDerivativesContext).toHaveBeenCalledTimes(1);
  });

  it('stops before starting another source after parent cancellation', async () => {
    const controller = new AbortController();
    mockEnrichSignalWithBinanceMarketContext.mockImplementation(
      ({ abortSignal }: { abortSignal: AbortSignal }) => {
        if (abortSignal.aborted) {
          return Promise.reject(new Error('parent cancelled'));
        }
        return new Promise((_, reject) => {
          abortSignal.addEventListener(
            'abort',
            () => reject(new Error('parent cancelled')),
            { once: true },
          );
        });
      },
    );

    const result = await enrichSignalWithMarketContextStages({
      signal,
      env: 'BACKTEST',
      abortSignal: controller.signal,
      onStageStart: () => controller.abort(),
    });

    expect(result).toEqual([
      expect.objectContaining({ stage: 'binance', status: 'timed_out' }),
    ]);
    expect(mockEnrichSignalWithCoinMarketCapContext).not.toHaveBeenCalled();
    expect(mockEnrichSignalWithDerivativesContext).not.toHaveBeenCalled();
    expect(mockEnrichSignalWithHyperliquidWhaleContext).not.toHaveBeenCalled();
  });

  it('does not start any stage when the parent is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      enrichSignalWithMarketContextStages({
        signal,
        env: 'BACKTEST',
        abortSignal: controller.signal,
      }),
    ).resolves.toEqual([]);
    expect(mockEnrichSignalWithBinanceMarketContext).not.toHaveBeenCalled();
  });

  it('forwards shared inputs and a cancellable stage signal to each source', async () => {
    await enrichSignalWithMarketContextStages({
      signal,
      env: 'PARITY',
      coinMarketCapEnabled: false,
      includeHyperliquidWhales: false,
    });

    expect(mockEnrichSignalWithBinanceMarketContext).toHaveBeenCalledWith({
      signal,
      env: 'PARITY',
      abortSignal: expect.any(AbortSignal),
    });
    expect(mockEnrichSignalWithCoinMarketCapContext).toHaveBeenCalledWith({
      signal,
      env: 'PARITY',
      enabled: false,
      abortSignal: expect.any(AbortSignal),
    });
    expect(mockEnrichSignalWithDerivativesContext).toHaveBeenCalledWith({
      signal,
      env: 'PARITY',
      abortSignal: expect.any(AbortSignal),
    });
  });

  it('uses the source-specific timeout before the shared fallback', () => {
    process.env.MARKET_CONTEXT_STAGE_TIMEOUT_MS = '200';
    process.env.DERIVATIVES_CONTEXT_STAGE_TIMEOUT_MS = '75';

    expect(resolveMarketContextStageTimeoutMs('binance')).toBe(200);
    expect(resolveMarketContextStageTimeoutMs('derivatives')).toBe(75);
  });
});
