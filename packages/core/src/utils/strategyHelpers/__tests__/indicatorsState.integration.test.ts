import {
  createStrategyIndicatorsState,
  releaseStrategyIndicatorsReplayCache,
} from '../indicators';

const INTERVAL_15M_MS = 15 * 60_000;

const makeCandle = (timestamp: number, close: number) => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 1000,
  turnover: close * 1000,
});

describe('strategy indicators state snapshot integration', () => {
  it('keeps bounded reads and snapshots equal in backtest, replay, and runtime', () => {
    const data = Array.from({ length: 260 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 100 + index * 0.5),
    );
    const btcData = Array.from({ length: 260 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 20_000 + index),
    );
    const periods = {
      maFast: 3,
      maMedium: 4,
      maSlow: 5,
      obvSma: 3,
      atr: 3,
      atrPctShort: 3,
      atrPctLong: 3,
      bb: 3,
      bbStd: 2,
      macdFast: 3,
      macdSlow: 4,
      macdSignal: 2,
    };
    const current = data.at(-1)!;
    const currentBtc = btcData.at(-1)!;
    const replayKey = 'indicator-mode-parity';

    const runMode = (env: 'BACKTEST' | 'PARITY' | 'CRON') => {
      const modeData = data.slice(0, -1);
      const modeBtcData = btcData.slice(0, -1);
      const state = createStrategyIndicatorsState({
        env,
        data: modeData as any,
        btcData: modeBtcData as any,
        periods,
        ...(env === 'PARITY' ? { sharedReplayKey: replayKey } : {}),
      });

      modeData.push(current);
      modeBtcData.push(currentBtc);
      state.setCurrentBar(current as any, currentBtc as any);
      state.onBar();

      const latest = state.latestSnapshot!() as Record<string, any>;
      const full = state.snapshot() as Record<string, any>;
      return {
        maFast: state.latestNumbers('maFast', 2),
        maSlow: state.latestNumbers('maSlow', 2),
        latestMaFast: latest.maFast,
        fullMaFast: full.maFast.slice(-2),
        latestBaseContext: JSON.parse(JSON.stringify(latest.baseContext)),
        fullBaseContext: JSON.parse(JSON.stringify(full.baseContext)),
      };
    };

    try {
      const backtest = runMode('BACKTEST');
      expect(runMode('PARITY')).toEqual(backtest);
      expect(runMode('CRON')).toEqual(backtest);
      expect(backtest.maFast).toEqual(backtest.fullMaFast);
      expect(backtest.latestBaseContext).toEqual(backtest.fullBaseContext);
    } finally {
      releaseStrategyIndicatorsReplayCache(replayKey);
    }
  });

  it('keeps lazy snapshot fields stable after the next bar is applied', () => {
    const data = Array.from({ length: 140 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 100 + index),
    );
    const btcData = Array.from({ length: 140 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 20_000 + index),
    );

    const state = createStrategyIndicatorsState({
      env: 'BACKTEST',
      data: data as any,
      btcData: btcData as any,
      periods: {
        maFast: 3,
        maMedium: 3,
        maSlow: 3,
        obvSma: 3,
        atr: 3,
        atrPctShort: 3,
        atrPctLong: 3,
        bb: 3,
        bbStd: 2,
        macdFast: 3,
        macdSlow: 4,
        macdSignal: 2,
      },
    });

    const first = state.snapshot() as Record<string, any>;

    state.next(
      makeCandle(140 * INTERVAL_15M_MS, 500),
      makeCandle(140 * INTERVAL_15M_MS, 25_000),
    );

    const second = state.snapshot() as Record<string, any>;

    expect(first.candles15m).toHaveLength(50);
    expect(first.candles15m[first.candles15m.length - 1].timestamp).toBe(
      139 * INTERVAL_15M_MS,
    );
    expect(second.candles15m[second.candles15m.length - 1].timestamp).toBe(
      140 * INTERVAL_15M_MS,
    );
    expect(first.candles15m).not.toBe(second.candles15m);
    expect(first.btcCandles15m[first.btcCandles15m.length - 1].timestamp).toBe(
      139 * INTERVAL_15M_MS,
    );
    expect(
      second.btcCandles15m[second.btcCandles15m.length - 1].timestamp,
    ).toBe(140 * INTERVAL_15M_MS);
  });

  it('keeps spread materialization compatible with signal payload usage', () => {
    const data = Array.from({ length: 160 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 100 + index),
    );
    const btcData = Array.from({ length: 160 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 20_000 + index),
    );

    const state = createStrategyIndicatorsState({
      env: 'BACKTEST',
      data: data as any,
      btcData: btcData as any,
      periods: {
        maFast: 3,
        maMedium: 3,
        maSlow: 3,
        obvSma: 3,
        atr: 3,
        atrPctShort: 3,
        atrPctLong: 3,
        bb: 3,
        bbStd: 2,
        macdFast: 3,
        macdSlow: 4,
        macdSignal: 2,
      },
    });

    const snapshot = state.snapshot() as Record<string, any>;
    const spread = { ...snapshot };

    expect(Array.isArray(spread.maFast)).toBe(true);
    expect(Array.isArray(spread.btcMaFast)).toBe(true);
    expect(Array.isArray(spread.candles15m)).toBe(true);
    expect(Array.isArray(spread.btcCandles15m)).toBe(true);
    expect(Array.isArray(spread.maFast1h)).toBe(true);
    expect(Array.isArray(spread.btcMaFast1h)).toBe(true);
  });

  it('builds a compact snapshot with bounded series and full baseContext', () => {
    const data = Array.from({ length: 160 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 100 + index),
    );
    const btcData = Array.from({ length: 160 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 20_000 + index),
    );

    const state = createStrategyIndicatorsState({
      env: 'BACKTEST',
      data: data as any,
      btcData: btcData as any,
      periods: {
        maFast: 3,
        maMedium: 3,
        maSlow: 3,
        obvSma: 3,
        atr: 3,
        atrPctShort: 3,
        atrPctLong: 3,
        bb: 3,
        bbStd: 2,
        macdFast: 3,
        macdSlow: 4,
        macdSignal: 2,
      },
    });

    const compact = state.snapshot({
      compact: true,
      limit: 5,
    }) as Record<string, any>;

    expect(compact.maFast).toHaveLength(5);
    expect(compact.candles15m).toHaveLength(5);
    expect(compact.btcCandles15m).toHaveLength(5);
    expect(compact.maFast.at(-1)).toBeCloseTo(
      (state.snapshot() as Record<string, any>).maFast.at(-1),
    );
    expect(compact.baseContext).toBeTruthy();
    expect(compact.baseContext.raw.trend.maFast).toBeDefined();
  });

  it('keeps next current snapshot equal after snapshot synced current candle', () => {
    const data = Array.from({ length: 160 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 100 + index),
    );
    const btcData = Array.from({ length: 160 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 20_000 + index),
    );
    const periods = {
      maFast: 3,
      maMedium: 3,
      maSlow: 3,
      obvSma: 3,
      atr: 3,
      atrPctShort: 3,
      atrPctLong: 3,
      bb: 3,
      bbStd: 2,
      macdFast: 3,
      macdSlow: 4,
      macdSignal: 2,
    };
    const current = data.at(-1)!;
    const currentBtc = btcData.at(-1)!;

    const prefixState = createStrategyIndicatorsState({
      env: 'BACKTEST',
      data: data.slice(0, -1) as any,
      btcData: btcData.slice(0, -1) as any,
      periods,
    });
    const expected = prefixState.next(
      current as any,
      currentBtc as any,
    ) as Record<string, any> | null;

    const syncedState = createStrategyIndicatorsState({
      env: 'BACKTEST',
      data: data as any,
      btcData: btcData as any,
      periods,
    });
    syncedState.snapshot();
    const actual = syncedState.next(
      current as any,
      currentBtc as any,
    ) as Record<string, any> | null;

    expect(actual).toBeTruthy();
    expect(expected).toBeTruthy();
    expect(actual?.candle.timestamp).toBe(current.timestamp);
    expect(actual?.maFast).toBeCloseTo(expected?.maFast);
    expect(actual?.atr).toBeCloseTo(expected?.atr);
    expect(actual?.bbUpper).toBeCloseTo(expected?.bbUpper);
    expect(actual?.baseContext.raw.trend.maFast).toBeCloseTo(
      expected?.baseContext.raw.trend.maFast,
    );
    expect(actual?.baseContext.raw.volatility.atr).toBeCloseTo(
      expected?.baseContext.raw.volatility.atr,
    );
  });
});
