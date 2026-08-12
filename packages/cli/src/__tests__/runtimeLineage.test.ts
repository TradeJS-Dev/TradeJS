import {
  buildRuntimeLineage,
  resetRuntimeLineageCachesForTests,
  runtimeLineageKey,
} from '../lib/runtimeLineage';

describe('runtime lineage', () => {
  afterEach(() => {
    resetRuntimeLineageCachesForTests();
  });

  it('stores the configured MAX_LOSS_VALUE for runtime history', async () => {
    const lineage = await buildRuntimeLineage({
      projectRoot: process.cwd(),
      strategyName: 'LiquidityTails',
      compositionId: 'LiquidityTails_release_1',
      config: {
        strategyConfig: {
          MAX_LOSS_VALUE: '12.5',
        },
      },
    });

    expect(lineage.maxLossValue).toBe(12.5);
    expect(lineage.compositionId).toBe('LiquidityTails_release_1');
  });

  it('treats two release compositions as different runtime lineages', async () => {
    const first = await buildRuntimeLineage({
      projectRoot: process.cwd(),
      strategyName: 'LiquidityTails',
      compositionId: 'release-a',
      config: { strategyConfig: { MAX_LOSS_VALUE: 10 } },
    });
    const second = { ...first, compositionId: 'release-b' };

    expect(runtimeLineageKey(first)).not.toBe(runtimeLineageKey(second));
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
