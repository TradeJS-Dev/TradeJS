import {
  adaptiveMomentumRibbonAiAdapter,
  adaptiveMomentumRibbonMlAdapter,
  maStrategyAiAdapter,
  maStrategyMlAdapter,
  volumeDivergenceAiAdapter,
  volumeDivergenceMlAdapter,
} from '@tradejs/strategies';

describe('strategy adapters', () => {
  it('maps AI runtime for AMR and MaStrategy configs', () => {
    expect(
      adaptiveMomentumRibbonAiAdapter.mapEntryRuntimeFromConfig?.({
        AI_ENABLED: false,
        MIN_AI_QUALITY: 5,
      } as any),
    ).toEqual({
      enabled: false,
      minQuality: 5,
    });

    expect(
      maStrategyAiAdapter.mapEntryRuntimeFromConfig?.({
        AI_ENABLED: true,
        MIN_AI_QUALITY: 3,
      } as any),
    ).toEqual({
      enabled: true,
      minQuality: 3,
    });
  });

  it('maps ML runtime for AMR and MaStrategy configs', () => {
    expect(
      adaptiveMomentumRibbonMlAdapter.mapEntryRuntimeFromConfig?.({
        ML_ENABLED: false,
        ML_THRESHOLD: 0.42,
      } as any),
    ).toEqual({
      enabled: false,
      mlThreshold: 0.42,
    });

    expect(
      maStrategyMlAdapter.mapEntryRuntimeFromConfig?.({
        ML_ENABLED: true,
        ML_THRESHOLD: 0.25,
      } as any),
    ).toEqual({
      enabled: true,
      mlThreshold: 0.25,
    });
  });

  it('builds volume divergence AI prompt addon and runtime config mapping', () => {
    const addon = volumeDivergenceAiAdapter.buildSystemPromptAddon?.({
      signal: {
        signalId: 's1',
        symbol: 'BTCUSDT',
        interval: '15' as any,
        strategy: 'VolumeDivergence',
        direction: 'LONG',
        timestamp: 1,
        figures: {},
        prices: {
          currentPrice: 1,
          takeProfitPrice: 2,
          stopLossPrice: 0.5,
          riskRatio: 2,
        },
        indicators: {},
      },
    });
    expect(addon).toContain('Дополнение для VolumeDivergence');
    expect(addon).toContain('Bullish divergence');

    expect(
      volumeDivergenceAiAdapter.mapEntryRuntimeFromConfig?.({
        AI_ENABLED: true,
        MIN_AI_QUALITY: 4,
      } as any),
    ).toEqual({
      enabled: true,
      minQuality: 4,
    });
  });

  it('normalizes volume divergence ML strategy config and keeps explicit config if provided', () => {
    expect(volumeDivergenceMlAdapter.normalizeStrategyConfig?.(undefined)).toBe(
      undefined,
    );

    const normalized = volumeDivergenceMlAdapter.normalizeStrategyConfig?.({
      NORMALIZATION_LENGTH: 20,
      PIVOT_LOOKBACK_LEFT: 5,
      PIVOT_LOOKBACK_RIGHT: 6,
      MAX_BARS_BETWEEN_PIVOTS: 100,
      MIN_BARS_BETWEEN_PIVOTS: 3,
      BULLISH: { enable: true },
      BEARISH: { enable: false },
    } as any);

    expect(normalized).toEqual(
      expect.objectContaining({
        VOLUME_DIVERGENCE_CONFIG: {
          normalizationLength: 20,
          pivotLookbackLeft: 5,
          pivotLookbackRight: 6,
          maxBarsBetweenPivots: 100,
          minBarsBetweenPivots: 3,
          bullish: { enable: true },
          bearish: { enable: false },
        },
      }),
    );

    const explicit = { from: 'explicit' };
    const kept = volumeDivergenceMlAdapter.normalizeStrategyConfig?.({
      ML_ENABLED: true,
      VOLUME_DIVERGENCE_CONFIG: explicit,
    } as any);
    expect(kept?.VOLUME_DIVERGENCE_CONFIG).toBe(explicit);
  });

  it('includes normalized strategy config in volume divergence ML runtime options', () => {
    const runtime = volumeDivergenceMlAdapter.mapEntryRuntimeFromConfig?.({
      ML_ENABLED: true,
      ML_THRESHOLD: 0.7,
      NORMALIZATION_LENGTH: 14,
      PIVOT_LOOKBACK_LEFT: 2,
      PIVOT_LOOKBACK_RIGHT: 3,
      MAX_BARS_BETWEEN_PIVOTS: 40,
      MIN_BARS_BETWEEN_PIVOTS: 1,
      BULLISH: { enable: true },
      BEARISH: { enable: true },
    } as any);

    expect(runtime).toEqual(
      expect.objectContaining({
        enabled: true,
        mlThreshold: 0.7,
      }),
    );

    expect(runtime?.strategyConfig?.VOLUME_DIVERGENCE_CONFIG).toEqual({
      normalizationLength: 14,
      pivotLookbackLeft: 2,
      pivotLookbackRight: 3,
      maxBarsBetweenPivots: 40,
      minBarsBetweenPivots: 1,
      bullish: { enable: true },
      bearish: { enable: true },
    });
  });
});
