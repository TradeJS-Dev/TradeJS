import {
  buildRuntimeLineage,
  resetRuntimeLineageCachesForTests,
  runtimeLineageKey,
  runtimeLineagesMatch,
} from '../lib/runtimeLineage';
import { buildAiTrainLineage } from '../lib/aiTrainResearch';

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

  it('keeps logic lineage stable when only MAX_LOSS_VALUE changes', async () => {
    const smallRisk = await buildRuntimeLineage({
      projectRoot: process.cwd(),
      strategyName: 'DoubleTap',
      compositionId: 'DoubleTap_release_1',
      config: {
        strategyConfig: {
          MAX_LOSS_VALUE: 1,
          DOUBLE_TAP_WINDOW: 40,
        },
      },
    });
    const largeRisk = await buildRuntimeLineage({
      projectRoot: process.cwd(),
      strategyName: 'DoubleTap',
      compositionId: 'DoubleTap_release_1',
      config: {
        strategyConfig: {
          MAX_LOSS_VALUE: 10,
          DOUBLE_TAP_WINDOW: 40,
        },
      },
    });

    expect(smallRisk.maxLossValue).toBe(1);
    expect(largeRisk.maxLossValue).toBe(10);
    expect(smallRisk.configFingerprint).toBe(largeRisk.configFingerprint);
    expect(runtimeLineageKey(smallRisk)).toBe(runtimeLineageKey(largeRisk));
    expect(runtimeLineagesMatch(smallRisk, largeRisk)).toBe(true);
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

  it('uses the same deterministic gate fingerprint as AI research', async () => {
    const runtime = await buildRuntimeLineage({
      projectRoot: process.cwd(),
      strategyName: 'DoubleTap',
      config: { strategyConfig: { MAX_LOSS_VALUE: 10 } },
    });
    const research = await buildAiTrainLineage({
      projectRoot: process.cwd(),
      strategyName: 'DoubleTap',
      configIds: ['fixture'],
      runContext: { mode: 'local-deterministic' },
    });

    expect(runtime.gateFingerprint).toBe(research.gateFingerprint);
    expect(research.gateFingerprintFiles).toEqual(
      expect.arrayContaining([
        'packages/strategies/src/shared/localAiGate.ts',
        'packages/core/src/utils/strategyHelpers/signalBuilders.ts',
      ]),
    );
  });
});
