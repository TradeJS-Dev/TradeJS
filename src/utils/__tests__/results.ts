import { ConnectorStat } from '@types';
import { getTopResults } from '../results';

describe('getTopResults', () => {
  const base: ConnectorStat = {
    amount: 110,
    orders: 10,
    wins: 8,
    losses: 2,
    ws: 80,
    minAmount: 90,
    orderLog: [],
  };

  const make = (overrides: Partial<ConnectorStat> = {}): ConnectorStat => ({
    ...base,
    ...overrides,
  });

  it('returns top N results sorted by score', () => {
    const results: ConnectorStat[] = [
      make({ ws: 90, amount: 120 }), // higher score
      make({ ws: 80, amount: 110 }), // medium score
      make({ ws: 70, amount: 105 }), // lower score
    ];

    const top = getTopResults(results, 2);
    expect(top.length).toBe(2);
    expect(top[0].ws).toBe(90);
    expect(top[1].ws).toBe(80);
  });

  it('penalizes entries with orders === 0', () => {
    const results: ConnectorStat[] = [
      make({ ws: 95, amount: 130, orders: 0 }), // looks good but should be penalized
      make({ ws: 70, amount: 100, orders: 10 }), // valid
    ];

    const top = getTopResults(results, 1);
    expect(top[0].orders).toBe(10);
  });

  it('penalizes entries with minAmount < 85', () => {
    const results: ConnectorStat[] = [
      make({ minAmount: 80, ws: 95, amount: 130 }), // should be penalized
      make({ minAmount: 90, ws: 70, amount: 110 }), // valid
    ];

    const top = getTopResults(results, 1);
    expect(top[0].minAmount).toBe(90);
  });

  it('returns all if limit is greater than list', () => {
    const results: ConnectorStat[] = [make({ ws: 90 }), make({ ws: 85 })];

    const top = getTopResults(results, 10);
    expect(top.length).toBe(2);
  });

  it('does not mutate original array', () => {
    const original = [make({ ws: 90 }), make({ ws: 70 })];
    const copy = [...original];

    getTopResults(original, 1);
    expect(original).toEqual(copy);
  });
});
