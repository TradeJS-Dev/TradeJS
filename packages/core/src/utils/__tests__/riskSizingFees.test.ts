import { getDirectionalTpSlPrices } from '../strategyHelpers/market';

describe('directional order sizing', () => {
  it.each([['LONG'], ['SHORT']] as const)(
    'includes both decimal fee legs for %s',
    (direction) => {
      const plan = getDirectionalTpSlPrices({
        price: 100,
        direction,
        takeProfitDelta: 20,
        stopLossDelta: 10,
        maxLossValue: 10,
        feePercent: 0.001,
      });
      // LONG: risk 10 + fees 0.10 + 0.09. SHORT: 10 + 0.10 + 0.11.
      expect(plan.qty).toBeCloseTo(
        direction === 'LONG' ? 0.9813542688910697 : 0.9794319294809012,
        10,
      );
    },
  );
});
