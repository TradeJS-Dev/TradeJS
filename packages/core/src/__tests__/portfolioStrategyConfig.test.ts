import {
  definePortfolioStrategy,
  defineStrategyPlugin,
} from '@tradejs/core/config';

it('registers a composite strategy as one plugin entry', () => {
  const portfolio = definePortfolioStrategy({
    manifest: { name: 'Composite' },
    defaults: { INTERVAL: '15' },
    parseConfig: () => ({ INTERVAL: '15' }),
    resolveChildren: () => [],
    selectEntries: () => ({ ranked: [], pending: [] }),
    confirmEntry: () => null,
    execution: { maxPositions: 3, feeRate: 0.00055, slippageBps: 2 },
  });
  expect(
    defineStrategyPlugin({ strategyEntries: [portfolio] }).strategyEntries,
  ).toEqual([
    expect.objectContaining({
      kind: 'portfolio',
      manifest: { name: 'Composite' },
    }),
  ]);
});
