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
    delete process.env.HYPERLIQUID_WHALE_MIN_COVERAGE_PCT;
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
      coveredWhales: 90,
      expectedWhales: 100,
      coveragePct: 0.9,
      buyNotionalUsd: 800_000,
      sellNotionalUsd: 200_000,
      netNotionalUsd: 600_000,
      buySharePct: 0.8,
      positionAwareWhaleSides: 5,
      positionAwarePct: 1,
      longEntryWhales: 3,
      shortEntryWhales: 1,
      longExitWhales: 1,
      shortExitWhales: 0,
      longEntryNotionalUsd: 700_000,
      shortEntryNotionalUsd: 100_000,
      longExitNotionalUsd: 100_000,
      shortExitNotionalUsd: 0,
      entryNetNotionalUsd: 600_000,
      entryLongSharePct: 0.875,
      universeFingerprint: universe.fingerprint,
      whaleRegistryFingerprint: whales.fingerprint,
      source: 'hyperliquid_user_fills',
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
      source: 'hyperliquid_user_fills',
      windowEndTs: decisionTimeMs,
      netNotionalUsd: 600_000,
      buySharePct: 0.8,
      entryNetNotionalUsd: 600_000,
      entryLongSharePct: 0.875,
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

  it('attaches partial coverage for diagnostics but marks it unusable by the gate', async () => {
    mockGetHyperliquidWhaleFlowAggregate.mockResolvedValueOnce({
      ...(await mockGetHyperliquidWhaleFlowAggregate()),
      coveragePct: 0.79,
      coveredWhales: 79,
    });
    const signal = makeSignal();
    await expect(
      enrichSignalWithHyperliquidWhaleContext({ signal, env: 'BACKTEST' }),
    ).resolves.toBe(true);

    expect(
      signal.additionalIndicators.baseContext.participation.hyperliquidWhales,
    ).toMatchObject({ coveragePct: 0.79, coverageSufficient: false });
    expect(
      signal.additionalIndicators.baseContext.gateFeatures?.participation,
    ).toMatchObject({
      hyperliquidWhaleCoverageSufficient: false,
      hyperliquidWhaleFlowAligned: null,
      hyperliquidWhaleNotionalUsd: null,
    });
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
