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

  it('keeps portable logic lineage stable across local and runtime bindings', async () => {
    const local = await buildRuntimeLineage({
      projectRoot: process.cwd(),
      strategyName: 'DoubleTap',
      compositionId: 'DoubleTap_release_1',
      config: {
        configId: 'DoubleTap:ai',
        strategyConfig: {
          ENABLE: true,
          ACCOUNT_ID: 'local-research-account',
          DEPLOYMENT_ID: 'local-research-deployment',
          API_KEY: 'local-key-must-not-affect-evidence',
          API_SECRET: 'local-secret-must-not-affect-evidence',
          BYBIT_API_KEY: 'local-bybit-key-must-not-affect-evidence',
          BYBIT_API_SECRET: 'local-bybit-secret-must-not-affect-evidence',
          MAX_LOSS_VALUE: 10,
          AI_ENABLED: true,
          AI_MODE: 'gate',
          DOUBLE_TAP_WINDOW: 40,
        },
      },
    });
    const runtime = await buildRuntimeLineage({
      projectRoot: process.cwd(),
      strategyName: 'DoubleTap',
      compositionId: 'DoubleTap_release_1',
      config: {
        configId: 'users:root:strategies:DoubleTap:config',
        strategyConfig: {
          ENABLE: true,
          ACCOUNT_ID: 'bybit-production',
          DEPLOYMENT_ID: 'doubletap-production',
          API_KEY: 'runtime-key-must-not-affect-evidence',
          API_SECRET: 'runtime-secret-must-not-affect-evidence',
          BYBIT_API_KEY: 'runtime-bybit-key-must-not-affect-evidence',
          BYBIT_API_SECRET: 'runtime-bybit-secret-must-not-affect-evidence',
          MAX_LOSS_VALUE: 1,
          AI_ENABLED: true,
          AI_MODE: 'gate',
          DOUBLE_TAP_WINDOW: 40,
        },
      },
    });

    expect(local.configFingerprint).toBe(runtime.configFingerprint);
    expect(runtimeLineagesMatch(local, runtime)).toBe(true);
    expect(local.maxLossValue).toBe(10);
    expect(runtime.maxLossValue).toBe(1);
  });

  it('changes portable logic lineage when gate semantics change', async () => {
    const gate = await buildRuntimeLineage({
      projectRoot: process.cwd(),
      strategyName: 'DoubleTap',
      compositionId: 'DoubleTap_release_1',
      config: {
        strategyConfig: { AI_ENABLED: true, AI_MODE: 'gate' },
      },
    });
    const llm = await buildRuntimeLineage({
      projectRoot: process.cwd(),
      strategyName: 'DoubleTap',
      compositionId: 'DoubleTap_release_1',
      config: {
        strategyConfig: { AI_ENABLED: true, AI_MODE: 'llm' },
      },
    });

    expect(gate.configFingerprint).not.toBe(llm.configFingerprint);
    expect(runtimeLineagesMatch(gate, llm)).toBe(false);
  });

  it('changes portable lineage when strategy activation changes', async () => {
    const enabled = await buildRuntimeLineage({
      projectRoot: process.cwd(),
      strategyName: 'DoubleTap',
      compositionId: 'DoubleTap_release_1',
      config: { strategyConfig: { ENABLE: true, AI_MODE: 'gate' } },
    });
    const disabled = await buildRuntimeLineage({
      projectRoot: process.cwd(),
      strategyName: 'DoubleTap',
      compositionId: 'DoubleTap_release_1',
      config: { strategyConfig: { ENABLE: false, AI_MODE: 'gate' } },
    });

    expect(runtimeLineagesMatch(enabled, disabled)).toBe(false);
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

  it('binds versioned lineage to exact strategy and runtime packages', async () => {
    const lineage = await buildRuntimeLineage({
      projectRoot: process.cwd(),
      strategyName: 'DoubleTap',
      version: 5,
      strategyPackageVersion: '3.0.1',
      runtimePackageVersion: '3.2.0',
      config: { strategyConfig: { MAX_LOSS_VALUE: 1 } },
    });

    expect(runtimeLineageKey(lineage)).toBe('v2:5:3.0.1:3.2.0');
    expect(
      runtimeLineagesMatch(lineage, {
        ...lineage,
        strategyPackageVersion: '3.0.2',
      }),
    ).toBe(false);
    expect(
      runtimeLineagesMatch(lineage, {
        ...lineage,
        maxLossValue: 10,
      }),
    ).toBe(true);
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
        '@tradejs/strategy-double-tap',
        '@tradejs/strategy-kit/ai-gate',
        '@tradejs/core/strategies',
      ]),
    );
  });
});
