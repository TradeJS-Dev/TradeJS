import {
  choosePortfolioEntries,
  validatePortfolioSelection,
} from '../portfolioSelection';

it('collects all tickers before allowing the selected entry to submit', async () => {
  const filled: string[] = [];
  await choosePortfolioEntries(
    [
      async (offer) => {
        if (await offer('SOL')) filled.push('SOL');
      },
      async (offer) => {
        if (await offer('ETH')) filled.push('ETH');
      },
    ],
    async (offers) => {
      expect(offers.map(({ entry }) => entry)).toEqual(['SOL', 'ETH']);
      expect(filled).toEqual([]);
      await offers.find(({ entry }) => entry === 'ETH')!.submit();
    },
  );
  expect(filled).toEqual(['ETH']);
});

it('rejects a delayed candidate with a structural block', () => {
  expect(() =>
    validatePortfolioSelection(
      {
        closedAt: 900_000,
        market: { candle: () => undefined },
        candidates: [
          {
            id: 'blocked',
            strategy: 'Child',
            symbol: 'ETHUSDT',
            direction: 'LONG',
            stop: 90,
            targets: [120],
            gate: {
              approved: false,
              reason: 'AI_QUALITY_BELOW_MIN (2 < 4)',
              rawQuality: 2,
              explicitHardBlock: true,
            },
          },
        ],
      },
      {
        ranked: [],
        pending: [{ candidateId: 'blocked', confirmAt: 1_800_000 }],
      },
      900_000,
    ),
  ).toThrow('Invalid delayed portfolio entry');
});
