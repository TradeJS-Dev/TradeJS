import { buildMlPayload } from '../mlPayload';

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
  it('moves candles and btcCandles into signal.indicators', () => {
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
        indicators: { maFast: [1, 2] },
      } as any,
      context: {
        strategyConfig: {
          TRENDLINE: { minTouches: 4 },
        },
      },
      candles,
      btcCandles,
    });

    expect(payload.candles).toBeUndefined();
    expect(payload.btcCandles).toBeUndefined();
    expect(payload.signal.indicators.candles).toEqual(candles);
    expect(payload.signal.indicators.btcCandles).toEqual(btcCandles);
    expect(payload.signal.indicators.candles15m).toEqual(candles);
    expect(payload.signal.indicators.btcCandles15m).toEqual(btcCandles);
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
});
