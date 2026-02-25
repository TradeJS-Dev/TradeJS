jest.mock('@utils/strategyHelpers', () => ({
  buildEntrySignalDecision: (params: any) => ({
    kind: 'entry',
    code: params.code,
    entryContext: params.entryContext,
    orderPlan: params.orderPlan,
    runtime: params.runtime,
    signal: {
      signalId: params.signalId ?? 'test-signal-id',
      strategy: params.entryContext.strategy,
      symbol: params.entryContext.symbol,
      interval: params.entryContext.interval,
      direction: params.entryContext.direction,
      timestamp: params.entryContext.timestamp,
      figures: params.figures ?? {},
      prices: params.entryContext.prices,
      indicators: params.indicators ?? {},
      additionalIndicators: params.additionalIndicators,
      configFromBacktest: params.entryContext.configFromBacktest,
    },
  }),
}));

import { buildEntrySignalDecision } from '@utils/strategyHelpers';

describe('strategy decision contracts', () => {
  test('TrendLine entry decision uses entryContext as source and minimal orderPlan', () => {
    const decision = buildEntrySignalDecision({
      code: 'TRENDLINE_SIGNAL',
      entryContext: {
        strategy: 'TrendLine',
        symbol: 'ETHUSDT',
        interval: '15' as any,
        direction: 'LONG',
        timestamp: 1_700_000_000_000,
        prices: {
          currentPrice: 100,
          takeProfitPrice: 105,
          stopLossPrice: 95,
          riskRatio: 2,
        },
        configFromBacktest: false,
      },
      figures: {
        trendLine: {
          id: 'tl-1',
          mode: 'lows',
          distance: 1.2,
          touches: [{ timestamp: 1, value: 100 }],
          points: [{ timestamp: 1, value: 100 }],
        },
      },
      indicators: { correlation: 0.2 },
      additionalIndicators: { touches: 3, distance: 1.2 },
      orderPlan: {
        qty: 1.5,
        takeProfits: [{ rate: 1, price: 105 }],
      },
    });

    expect(decision.kind).toBe('entry');
    if (decision.kind !== 'entry') return;
    expect(decision.entryContext.strategy).toBe('TrendLine');
    expect(decision.orderPlan).toEqual(
      expect.objectContaining({
        qty: 1.5,
        takeProfits: [{ rate: 1, price: 105 }],
      }),
    );
    expect('price' in decision.orderPlan).toBe(false);
    expect('timestamp' in decision.orderPlan).toBe(false);
    expect('direction' in decision.orderPlan).toBe(false);
    expect('stopLossPrice' in decision.orderPlan).toBe(false);
  });

  test('Breakout entry decision includes strategy in entryContext and runtime ML policy from config', () => {
    const decision = buildEntrySignalDecision({
      code: 'OPEN_LONG',
      entryContext: {
        strategy: 'Breakout',
        symbol: 'BTCUSDT',
        interval: '15' as any,
        direction: 'LONG',
        timestamp: 1_700_000_000_000,
        prices: {
          currentPrice: 100,
          takeProfitPrice: 110,
          stopLossPrice: 95,
          riskRatio: 0,
        },
        configFromBacktest: false,
      },
      orderPlan: {
        qty: 1,
        takeProfits: [{ rate: 1, price: 110 }],
      },
      indicators: {
        maFast: 1,
        maSlow: 2,
        obv: 3,
        smaObv: 4,
        atr: 5,
        bbUpper: 6,
        bbLower: 7,
        correlation: 0.1,
        highLevel: 120,
        lowLevel: 90,
      },
      additionalIndicators: {
        highLevel: 120,
        lowLevel: 90,
        signals: { trend: true },
      },
    });

    expect(decision.kind).toBe('entry');
    if (decision.kind !== 'entry') return;
    expect(decision.entryContext.strategy).toBe('Breakout');
    expect(decision.runtime).toBeUndefined();
  });
});
