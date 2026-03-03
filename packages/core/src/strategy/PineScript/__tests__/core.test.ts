/** @jest-environment node */

import { createPineScriptCore } from '../core';
import { config as DEFAULT_CONFIG } from '../config';

const makeCandle = (timestamp: number, open: number, close: number) => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open,
  close,
  high: Math.max(open, close) + 0.8,
  low: Math.min(open, close) - 0.8,
  volume: 1_000,
  turnover: close * 1_000,
});

const makeCandles = ({ bullishLast }: { bullishLast: boolean }) => {
  const start = 1_700_000_000_000;
  const candles = Array.from({ length: 80 }, (_, index) => {
    const base = 100 + Math.sin(index / 5) * 2;
    const isLast = index === 79;
    const open = isLast ? (bullishLast ? base - 0.5 : base + 0.5) : base - 0.1;
    const close = isLast ? (bullishLast ? base + 0.5 : base - 0.5) : base + 0.1;
    return makeCandle(start + index * 60_000, open, close);
  });
  return candles;
};

const makeStrategyApi = (marketData: any, currentPosition: any = null) =>
  ({
    skip: (code: string) => ({ kind: 'skip', code }),
    getMarketData: jest.fn(async () => marketData),
    getCurrentPosition: jest.fn(async () => currentPosition),
    isCurrentPositionExists: jest.fn(async () =>
      Boolean(currentPosition && currentPosition.qty > 0),
    ),
    getDirectionalTpSlPrices: jest.fn(({ price, direction }) => ({
      stopLossPrice: direction === 'LONG' ? price * 0.99 : price * 1.01,
      takeProfitPrice: direction === 'LONG' ? price * 1.02 : price * 0.98,
      riskRatio: 2.1,
      qty: 1,
    })),
    createLastTradeController: jest.fn(() => ({
      isInCooldown: () => false,
      markTrade: jest.fn(),
      getLastTradeTimestamp: () => null,
    })),
    entry: (params: any) => ({
      kind: 'entry',
      code: params.code,
      entryContext: {
        strategy: 'PineScript',
        symbol: 'TESTUSDT',
        interval: '15',
        direction: params.direction,
        timestamp: params.timestamp,
        prices: params.prices,
        isConfigFromBacktest: false,
      },
      orderPlan: params.orderPlan,
      runtime: params.runtime,
      signal: {
        signalId: params.signalId ?? 'pine-test-signal',
        strategy: 'PineScript',
        symbol: 'TESTUSDT',
        interval: '15',
        direction: params.direction,
        timestamp: params.timestamp,
        figures: params.figures ?? {},
        prices: params.prices,
        indicators: params.indicators ?? {},
        additionalIndicators: params.additionalIndicators,
        isConfigFromBacktest: false,
      },
    }),
  }) as any;

const makeIndicatorsState = () =>
  ({
    setCurrentBar: jest.fn(),
    next: jest.fn(),
    onBar: jest.fn(),
    ensureInitializedWithCurrentBar: jest.fn(),
    snapshot: jest.fn(() => ({ correlation: [0.1] })),
    latestNumber: jest.fn(() => 0.1),
    isInitialized: jest.fn(() => true),
  }) as any;

describe('createPineScriptCore', () => {
  it('returns entry decision for bullish pine signal', async () => {
    const candles = makeCandles({ bullishLast: true });
    const marketData = {
      fullData: candles,
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
    };

    const core = await createPineScriptCore({
      userName: 'root',
      symbol: 'TESTUSDT',
      config: {
        ...DEFAULT_CONFIG,
        PINE_SCRIPT: `//@version=5
indicator("Entry Long")
plot(ta.sma(close, 5), "fast")
plot(ta.sma(close, 15), "slow")
plot(close > open ? 1 : 0, "entryLong")
plot(close < open ? 1 : 0, "entryShort")
`,
      } as any,
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles.slice(0, -1),
      btcData: candles.slice(0, -1),
      strategyApi: makeStrategyApi(marketData),
      indicatorsState: makeIndicatorsState(),
    });

    const decision = await core(
      candles[candles.length - 1],
      candles[candles.length - 1],
    );

    expect(decision.kind).toBe('entry');
    if (decision.kind !== 'entry') {
      return;
    }
    expect(decision.entryContext.direction).toBe('LONG');
    expect(decision.code).toBe('PINE_ENTRY_LONG');
    expect(decision.orderPlan.qty).toBe(1);
  });

  it('returns exit decision when opposite pine signal appears on open position', async () => {
    const candles = makeCandles({ bullishLast: false });
    const marketData = {
      fullData: candles,
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
    };

    const core = await createPineScriptCore({
      userName: 'root',
      symbol: 'TESTUSDT',
      config: {
        ...DEFAULT_CONFIG,
        PINE_SCRIPT: `//@version=5
indicator("Entry Short")
plot(close > open ? 1 : 0, "entryLong")
plot(close < open ? 1 : 0, "entryShort")
`,
      } as any,
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles.slice(0, -1),
      btcData: candles.slice(0, -1),
      strategyApi: makeStrategyApi(marketData, {
        direction: 'LONG',
        qty: 1,
      }),
      indicatorsState: makeIndicatorsState(),
    });

    const decision = await core(
      candles[candles.length - 1],
      candles[candles.length - 1],
    );

    expect(decision).toEqual({
      kind: 'exit',
      code: 'CLOSE_BY_PINE_SIGNAL',
      closePlan: {
        price: marketData.currentPrice,
        timestamp: marketData.timestamp,
        direction: 'LONG',
      },
    });
  });

  it('returns skip NO_SIGNAL when pine script has no entry signal', async () => {
    const candles = makeCandles({ bullishLast: true });
    const marketData = {
      fullData: candles,
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
    };

    const core = await createPineScriptCore({
      userName: 'root',
      symbol: 'TESTUSDT',
      config: {
        ...DEFAULT_CONFIG,
        PINE_SCRIPT: `//@version=5
indicator("No Signal")
plot(0, "entryLong")
plot(0, "entryShort")
`,
      } as any,
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles.slice(0, -1),
      btcData: candles.slice(0, -1),
      strategyApi: makeStrategyApi(marketData),
      indicatorsState: makeIndicatorsState(),
    });

    const decision = await core(
      candles[candles.length - 1],
      candles[candles.length - 1],
    );
    expect(decision).toEqual({
      kind: 'skip',
      code: 'NO_SIGNAL',
    });
  });
});
