import {
  findRepairableContinuityGap,
  parseContinuityUniverse,
  resolveContinuityUniverses,
} from '../continuity';

const candle = (timestamp: number) => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open: 1,
  high: 1,
  low: 1,
  close: 1,
  volume: 1,
  turnover: 1,
});

describe('continuity universes', () => {
  it('runs every universe supported by a connector by default', () => {
    expect(parseContinuityUniverse(undefined)).toBe('all');
    expect(resolveContinuityUniverses('all', ['crypto', 'tradfi'])).toEqual([
      'crypto',
      'tradfi',
    ]);
  });

  it('filters an explicitly requested universe by connector capabilities', () => {
    expect(resolveContinuityUniverses('tradfi', ['crypto', 'tradfi'])).toEqual([
      'tradfi',
    ]);
    expect(resolveContinuityUniverses('tradfi', ['crypto'])).toEqual([]);
    expect(() => parseContinuityUniverse('stocks')).toThrow(
      'Unknown market universe: stocks',
    );
  });
});

describe('findRepairableContinuityGap', () => {
  const expectedMs = 15 * 60_000;
  const data = [candle(0), candle(expectedMs), candle(expectedMs * 3)];

  it('reports gaps for continuous crypto markets', () => {
    expect(findRepairableContinuityGap(data, expectedMs, 'crypto')).toEqual({
      prevTs: expectedMs,
      ts: expectedMs * 3,
      diffSeconds: 30 * 60,
    });
  });

  it('does not treat TradFi market-session closures as corrupt data', () => {
    expect(findRepairableContinuityGap(data, expectedMs, 'tradfi')).toBeNull();
  });
});
