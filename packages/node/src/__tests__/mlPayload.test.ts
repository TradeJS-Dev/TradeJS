import { buildMlPayload } from '../mlPayload';
import {
  registerStrategyEntries,
  resetStrategyRegistryCache,
} from '../strategy/manifests';
import { strategyEntries } from '@tradejs/strategies';

const makeCandle = (timestamp: number) => ({
  timestamp,
  open: 1,
  high: 1,
  low: 1,
  close: 1,
  volume: 1,
  turnover: 1,
});

describe('buildMlPayload', () => {
  beforeEach(() => {
    resetStrategyRegistryCache();
    registerStrategyEntries(strategyEntries);
  });

  afterAll(() => {
    resetStrategyRegistryCache();
  });

  it('keeps signal.indicators as source of truth for candles', () => {
    const candles15m = [makeCandle(1), makeCandle(2)];
    const btcCandles15m = [makeCandle(1), makeCandle(2)];
    const payload = buildMlPayload({
      signal: {
        signalId: 's1',
        symbol: 'ETHUSDT',
        strategy: 'TrendLine',
        interval: '15' as any,
        direction: 'LONG',
        timestamp: 2,
        figures: {},
        prices: {
          currentPrice: 1,
          takeProfitPrice: 1,
          stopLossPrice: 1,
          riskRatio: 1,
        },
        indicators: {
          maFast: [1, 2],
          candles15m,
          btcCandles15m,
        },
      } as any,
      context: {
        strategyConfig: {
          TRENDLINE: { minTouches: 4 },
        },
      },
    });

    expect(payload.signal.indicators.candles15m).toEqual(candles15m);
    expect(payload.signal.indicators.btcCandles15m).toEqual(btcCandles15m);
    expect(payload.context?.strategyConfig?.TRENDLINE_CONFIG).toEqual({
      minTouches: 4,
    });
  });

  it('keeps candles from signal.indicators when explicit arrays are not passed', () => {
    const candles = [makeCandle(1), makeCandle(2)];
    const btcCandles = [makeCandle(1), makeCandle(2)];
    const payload = buildMlPayload({
      signal: {
        signalId: 's1',
        symbol: 'ETHUSDT',
        strategy: 'TrendLine',
        interval: '15' as any,
        direction: 'LONG',
        timestamp: 2,
        figures: {},
        prices: {
          currentPrice: 1,
          takeProfitPrice: 1,
          stopLossPrice: 1,
          riskRatio: 1,
        },
        indicators: { candles15m: candles, btcCandles15m: btcCandles },
      } as any,
    });

    expect(payload.signal.indicators.candles15m).toEqual(candles);
    expect(payload.signal.indicators.btcCandles15m).toEqual(btcCandles);
  });

  it('keeps indicator arrays by reference and only clones indicators container', () => {
    const maFast = [1, 2];
    const candles15m = [makeCandle(1), makeCandle(2)];
    const signal = {
      signalId: 's2',
      symbol: 'ETHUSDT',
      strategy: 'TrendLine',
      interval: '15' as any,
      direction: 'LONG',
      timestamp: 2,
      figures: {},
      prices: {
        currentPrice: 1,
        takeProfitPrice: 1,
        stopLossPrice: 1,
        riskRatio: 1,
      },
      indicators: { maFast, candles15m },
    };
    const payload = buildMlPayload({
      signal: signal as any,
    });

    expect(payload.signal.indicators).not.toBe(signal.indicators);
    expect(payload.signal.indicators.maFast).toBe(maFast);
    expect(payload.signal.indicators.candles15m).toBe(candles15m);
  });

  it('applies TrendLine ML adapter normalization for additionalIndicators', () => {
    const payload = buildMlPayload({
      signal: {
        signalId: 's3',
        symbol: 'ETHUSDT',
        strategy: 'TrendLine',
        interval: '15' as any,
        direction: 'LONG',
        timestamp: 2,
        figures: {},
        prices: {
          currentPrice: 1,
          takeProfitPrice: 1,
          stopLossPrice: 1,
          riskRatio: 1,
        },
        indicators: {},
        additionalIndicators: {
          touches: 4,
          distance: 1.23,
        },
      } as any,
    });

    expect(payload.signal.indicators.touches).toBe(4);
    expect(payload.signal.indicators.distance).toBe(1.23);
  });

  it('does not inject TrendLine config aliases for other strategies', () => {
    const payload = buildMlPayload({
      signal: {
        signalId: 's4',
        symbol: 'ETHUSDT',
        strategy: 'Breakout',
        interval: '15' as any,
        direction: 'LONG',
        timestamp: 2,
        figures: {},
        prices: {
          currentPrice: 1,
          takeProfitPrice: 1,
          stopLossPrice: 1,
          riskRatio: 1,
        },
        indicators: {},
      } as any,
      context: {
        strategyConfig: {
          BREAKOUT: { enabled: true },
        },
      },
    });

    expect(payload.context?.strategyConfig?.TRENDLINE_CONFIG).toBeUndefined();
    expect(payload.context?.strategyConfig?.BREAKOUT).toEqual({
      enabled: true,
    });
  });
});
