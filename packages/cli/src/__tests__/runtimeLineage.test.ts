import {
  buildRuntimeLineage,
  resetRuntimeLineageCachesForTests,
} from '../lib/runtimeLineage';

describe('runtime lineage', () => {
  afterEach(() => {
    resetRuntimeLineageCachesForTests();
  });

  it('stores the configured MAX_LOSS_VALUE for runtime history', async () => {
    const lineage = await buildRuntimeLineage({
      projectRoot: process.cwd(),
      strategyName: 'LiquidityTails',
      config: {
        strategyConfig: {
          MAX_LOSS_VALUE: '12.5',
        },
      },
    });

    expect(lineage.maxLossValue).toBe(12.5);
  });

  it('stores null when MAX_LOSS_VALUE is unavailable', async () => {
    const lineage = await buildRuntimeLineage({
      projectRoot: process.cwd(),
      strategyName: 'LiquidityTails',
      config: { strategyConfig: {} },
    });

    expect(lineage.maxLossValue).toBeNull();
  });
});
