const mockGetHyperliquidWhaleFlowAggregate = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock('@tradejs/infra/timescale', () => ({
  getHyperliquidWhaleFlowAggregate: (...args: unknown[]) =>
    mockGetHyperliquidWhaleFlowAggregate(...args),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: { warn: (...args: unknown[]) => mockLoggerWarn(...args) },
}));

import {
  enrichSignalWithHyperliquidWhaleContext,
  resetHyperliquidWhaleContextRuntimeState,
} from '../strategyHelpers/hyperliquidWhaleContext';
import {
  getHyperliquidPerpUniverseSnapshot,
  getHyperliquidWhaleRegistrySnapshot,
} from '../hyperliquidWhaleUniverse';

const timestamp = Date.UTC(2026, 0, 1, 12, 0, 0);
const decisionTimeMs = timestamp + 15 * 60_000;

const makeSignal = () =>
  ({
    signalId: 's1',
    symbol: 'BTCUSDT',
    strategy: 'TrendLine',
    interval: '15',
    direction: 'LONG',
    timestamp,
    prices: {
      currentPrice: 100,
      takeProfitPrice: 110,
      stopLossPrice: 95,
      riskRatio: 2,
    },
    indicators: {},
    additionalIndicators: {
      baseContext: {
        raw: {},
        regime: {},
        structure: {},
        participation: {},
        relative: { benchmark: {}, execution: {} },
        mtf: {
          candles: { m15: [], h1: [], h4: [], d1: [] },
          benchmarkCandles: { m15: [], h1: [], h4: [], d1: [] },
        },
      },
    },
  }) as any;

describe('strategyHelpers/hyperliquidWhaleContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.HYPERLIQUID_WHALE_CONTEXT_ENABLED;
    resetHyperliquidWhaleContextRuntimeState();
    const universe = getHyperliquidPerpUniverseSnapshot();
    const whales = getHyperliquidWhaleRegistrySnapshot();
    mockGetHyperliquidWhaleFlowAggregate.mockResolvedValue({
      symbol: 'BTC',
      interval: '15m',
      asOfTs: new Date(decisionTimeMs - 60_000),
      windowEndTs: new Date(decisionTimeMs),
      trades: 4,
      whaleSides: 5,
      uniqueWhales: 3,
      buyNotionalUsd: 800_000,
      sellNotionalUsd: 200_000,
      netNotionalUsd: 600_000,
      buySharePct: 0.8,
      universeFingerprint: universe.fingerprint,
      whaleRegistryFingerprint: whales.fingerprint,
      source: 'hyperliquid_trades',
      ageMs: 0,
      stale: false,
    });
  });

  it('reads only through the signal candle decision time and refreshes gate features', async () => {
    const signal = makeSignal();
    await expect(
      enrichSignalWithHyperliquidWhaleContext({ signal, env: 'BACKTEST' }),
    ).resolves.toBe(true);

    const universe = getHyperliquidPerpUniverseSnapshot();
    const whales = getHyperliquidWhaleRegistrySnapshot();
    expect(mockGetHyperliquidWhaleFlowAggregate).toHaveBeenCalledWith({
      symbol: 'BTC',
      interval: '15m',
      decisionTimeMs,
      maxAgeMs: 30 * 60_000,
      universeFingerprint: universe.fingerprint,
      whaleRegistryFingerprint: whales.fingerprint,
    });
    expect(
      signal.additionalIndicators.baseContext.participation.hyperliquidWhales,
    ).toMatchObject({
      source: 'hyperliquid_trades',
      windowEndTs: decisionTimeMs,
      netNotionalUsd: 600_000,
      buySharePct: 0.8,
    });
    expect(signal.additionalIndicators.baseContext.gateFeatures).toMatchObject({
      confirmations: { items: ['hyperliquid_whales_aligned'] },
      participation: {
        hyperliquidWhaleFlowAligned: true,
        hyperliquidWhaleBuySharePct: 0.8,
      },
    });
  });

  it('coalesces repeated lookups for the same replay candle', async () => {
    await enrichSignalWithHyperliquidWhaleContext({
      signal: makeSignal(),
      env: 'BACKTEST',
    });
    await enrichSignalWithHyperliquidWhaleContext({
      signal: makeSignal(),
      env: 'BACKTEST',
    });
    expect(mockGetHyperliquidWhaleFlowAggregate).toHaveBeenCalledTimes(1);
  });

  it('does not attach context outside the fixed top-30 universe', async () => {
    const signal = makeSignal();
    signal.symbol = 'UNKNOWNUSDT';
    await expect(
      enrichSignalWithHyperliquidWhaleContext({ signal, env: 'BACKTEST' }),
    ).resolves.toBe(false);
    expect(mockGetHyperliquidWhaleFlowAggregate).not.toHaveBeenCalled();
  });
});
