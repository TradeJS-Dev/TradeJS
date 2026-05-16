import {
  createRuntimeOrderLinkPrefix,
  normalizeStrategyOrderLinkKey,
  parseStrategyOrderLinkKey,
} from '../trade';

describe('trade orderLinkId helpers', () => {
  it('normalizes strategy name into a stable compact key', () => {
    expect(normalizeStrategyOrderLinkKey('TrendShift')).toBe(
      normalizeStrategyOrderLinkKey('trendshift'),
    );
    expect(normalizeStrategyOrderLinkKey('Trend Shift')).not.toBeNull();
  });

  it('extracts strategy key from runtime orderLinkId', () => {
    const prefix = createRuntimeOrderLinkPrefix('TrendShift');

    expect(parseStrategyOrderLinkKey(`${prefix}abc123def456`)).toBe(
      normalizeStrategyOrderLinkKey('TrendShift'),
    );
    expect(parseStrategyOrderLinkKey('tjs-legacy-id')).toBeNull();
  });
});
