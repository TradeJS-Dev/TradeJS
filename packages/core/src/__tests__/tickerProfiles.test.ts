import {
  buildTickerProfileSnapshot,
  isTickerProfileSnapshot,
  tickerProfileMonth,
} from '../tickerProfiles';
import type { Candle } from '@tradejs/types';
const asOf = Date.UTC(2026, 9, 1),
  HOUR = 3_600_000;
const history = (scale = 1, quote = 100): Candle[] =>
  Array.from({ length: 721 }, (_, i) => {
    const close = 100 * Math.exp(scale * Math.sin(i / 10));
    return {
      timestamp: asOf - (721 - i) * HOUR,
      open: close,
      high: close,
      low: close,
      close,
      volume: 10,
      turnover: quote,
    };
  });
const input = () => ({
  asOf,
  provider: 'bybit',
  universeId: 'usdt-v1',
  membership: 'frozen-list' as const,
  candlesBySymbol: {
    BTCUSDT: history(0.1, 100),
    ETHUSDT: history(-0.1, 200),
    SOLUSDT: history(0.2, 300),
  },
});
describe('monthly ticker profiles', () => {
  it('uses quote turnover, aligned log returns and common universe terciles', () => {
    const s = buildTickerProfileSnapshot(input()),
      sol = s.profiles.find((p) => p.symbol === 'SOLUSDT');
    expect(isTickerProfileSnapshot(s)).toBe(true);
    expect(sol).toMatchObject({
      dailyTurnoverUSDT: 7200,
      hours: 720,
      returnHours: 720,
      turnoverSource: 'quote',
      moneyGroup: 'high',
      volatilityGroup: 'high',
      btcCorrelationGroup: 'strong',
      ethCorrelationGroup: 'weak',
    });
    expect(sol?.correlationBTC).toBeCloseTo(1, 12);
    expect(sol?.correlationETH).toBeCloseTo(-1, 12);
    expect(s.validUntil).toBe(Date.UTC(2026, 10, 1));
  });
  it('cannot change past features using the unclosed boundary candle or future history', () => {
    const a = input(),
      baseline = buildTickerProfileSnapshot(a);
    for (const candles of Object.values(a.candlesBySymbol))
      candles.push({
        ...candles[0],
        timestamp: asOf,
        close: 1e8,
        turnover: 1e15,
      });
    expect(buildTickerProfileSnapshot(a)).toEqual(baseline);
    expect(tickerProfileMonth(asOf - 1)).toBe(Date.UTC(2026, 8, 1));
  });
  it('keeps missing coverage unknown and does not bridge a missing hour', () => {
    const a = input();
    a.candlesBySymbol.SOLUSDT = a.candlesBySymbol.SOLUSDT.slice(300);
    const sol = buildTickerProfileSnapshot(a).profiles.find(
      (p) => p.symbol === 'SOLUSDT',
    );
    expect(sol).toMatchObject({
      moneyGroup: 'unknown',
      volatilityGroup: 'unknown',
      correlationBTC: null,
      dailyTurnoverUSDT: null,
    });
    const b = input();
    b.candlesBySymbol.SOLUSDT.splice(100, 1);
    expect(
      buildTickerProfileSnapshot(b).profiles.find((p) => p.symbol === 'SOLUSDT')
        ?.returnHours,
    ).toBe(718);
  });
  it('labels estimated and mixed turnover, and handles constant-price correlations', () => {
    const a = input();
    a.candlesBySymbol.BTCUSDT = history(0).map((c) => ({
      ...c,
      turnover: Number.NaN,
    }));
    a.candlesBySymbol.ETHUSDT[100].turnover = Number.NaN;
    const s = buildTickerProfileSnapshot(a);
    expect(s.profiles.find((p) => p.symbol === 'BTCUSDT')).toMatchObject({
      turnoverSource: 'estimated',
      dailyTurnoverUSDT: 24000,
      correlationBTC: null,
      dailyVolatilityPct: 0,
    });
    expect(s.profiles.find((p) => p.symbol === 'ETHUSDT')?.turnoverSource).toBe(
      'mixed',
    );
  });
  it('rejects ambiguous order, wrong intervals, non-USDT membership and malformed persisted data', () => {
    const a = input();
    a.candlesBySymbol.BTCUSDT.reverse();
    expect(() => buildTickerProfileSnapshot(a)).toThrow('unordered');
    expect(() =>
      buildTickerProfileSnapshot({ ...input(), asOf: asOf + 1 }),
    ).toThrow('boundary');
    expect(() =>
      buildTickerProfileSnapshot({
        ...input(),
        candlesBySymbol: { BTCUSDC: history() },
      }),
    ).toThrow('USDT');
    expect(
      isTickerProfileSnapshot({
        ...buildTickerProfileSnapshot(input()),
        validUntil: asOf,
      }),
    ).toBe(false);
    const s = buildTickerProfileSnapshot(input());
    s.profiles[0].correlationBTC = 2;
    expect(isTickerProfileSnapshot(s)).toBe(false);
  });
});
