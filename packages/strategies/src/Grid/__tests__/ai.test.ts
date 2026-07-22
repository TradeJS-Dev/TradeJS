/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { gridAiAdapter } from '../adapters/ai';

const buildGridContext = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  action: 'open',
  level: 1,
  levelsFilled: 0,
  positionQty: 0,
  projectedQty: 2,
  projectedAveragePrice: 100,
  stopLossPrice: 95,
  takeProfitPrice: 107,
  entryDirection: 'SHORT',
  regimeDirection: 'SHORT',
  volatilityShock: false,
  atrPct: 1.2,
  slowSlopeAtr: -0.7,
  trendStrengthAtr: 2.1,
  candleRangeAtr: 0.8,
  stepDistance: 4,
  ...overrides,
});

const buildBaseContext = ({
  venueSpread = 0,
  benchmarkLiquidations15m = 0,
  benchmarkStale = false,
  bnbDirectionAligned = false,
  bnbPriceOiDivergenceType = 'none',
  bnbStale = false,
}: {
  venueSpread?: number;
  benchmarkLiquidations15m?: number;
  benchmarkStale?: boolean;
  bnbDirectionAligned?: boolean;
  bnbPriceOiDivergenceType?: string;
  bnbStale?: boolean;
} = {}) =>
  ({
    regime: { trend: { bias: 'bear' } },
    relative: { execution: { venueSpread } },
    derivatives: {
      intervals: {
        '15m': {
          stale: benchmarkStale,
          liqTotal: benchmarkLiquidations15m,
        },
      },
      referenceContexts: {
        BNBUSDT: {
          intervals: { '15m': { stale: bnbStale } },
          summary: {
            directionAligned: bnbDirectionAligned,
            priceOiDivergenceType: bnbPriceOiDivergenceType,
          },
        },
      },
    },
  }) as any;

const buildPayload = ({
  gridContext = buildGridContext(),
  baseContext = buildBaseContext(),
}: {
  gridContext?: Record<string, unknown>;
  baseContext?: unknown;
} = {}) =>
  gridAiAdapter.buildPayload?.({
    signal: {
      strategy: 'Grid',
      additionalIndicators: { gridContext },
    } as any,
    basePayload: {
      strategy: 'Grid',
      additionalIndicators: { baseContext },
    } as any,
  }) as any;

const postProcess = (payload: any, analysis: Record<string, unknown> = {}) =>
  gridAiAdapter.postProcessAnalysis?.({
    signal: {} as any,
    payload,
    analysis: {
      direction: 'LONG',
      quality: 5,
      approved: true,
      ...analysis,
    } as any,
  });

describe('Grid AI adapter', () => {
  it('copies Grid context and exposes causal gate features without dropping shared context', () => {
    const gridContext = buildGridContext();
    const payload = buildPayload({
      gridContext,
      baseContext: buildBaseContext({
        venueSpread: -0.0012,
        benchmarkLiquidations15m: 2,
      }),
    });

    expect(payload.additionalIndicators.baseContext).toEqual(
      expect.objectContaining({
        regime: { trend: { bias: 'bear' } },
        gridGateFeatures: expect.objectContaining({
          signalDirection: 'SHORT',
          venueSpread: -0.0012,
          benchmarkLiquidations15m: 2,
          liquidationDislocationPocket: true,
        }),
      }),
    );
    expect(payload.additionalIndicators.gridContext).toEqual(
      expect.objectContaining({
        ...gridContext,
        deterministicQuality: 5,
        approvalAllowedNow: true,
      }),
    );
  });

  it('renders Grid risk fields, gate decision, and non-martingale constraints in the prompt', () => {
    const prompt = gridAiAdapter.buildHumanPromptAddon?.({
      signal: {} as any,
      payload: buildPayload({
        gridContext: buildGridContext({
          action: 'increase',
          level: 3,
          levelsFilled: 2,
          positionQty: 2,
          projectedQty: 3,
          projectedAveragePrice: 96,
        }),
        baseContext: buildBaseContext({
          venueSpread: -0.0012,
          benchmarkLiquidations15m: 2,
          bnbDirectionAligned: true,
          bnbPriceOiDivergenceType: 'price_up_oi_up',
        }),
      }),
    });

    expect(prompt).toContain('action=increase');
    expect(prompt).toContain('level=3');
    expect(prompt).toContain('regimeDirection=SHORT');
    expect(prompt).toContain('projectedAveragePrice=96');
    expect(prompt).toContain('bnbExpansionConfirmation=true');
    expect(prompt).toContain('deterministicQuality=5');
    expect(prompt).toContain('non-martingale directional grid');
    expect(prompt).toContain('MAX_LOSS_VALUE');
  });

  it('uses safe rejection defaults for malformed optional context', () => {
    const payload = gridAiAdapter.buildPayload?.({
      signal: { additionalIndicators: [] } as any,
      basePayload: { additionalIndicators: [] } as any,
    }) as any;
    const prompt = gridAiAdapter.buildHumanPromptAddon?.({
      signal: {} as any,
      payload: { additionalIndicators: { gridContext: [] } } as any,
    });

    expect(payload.additionalIndicators.gridContext).toEqual(
      expect.objectContaining({
        signalDirection: null,
        deterministicQuality: 2,
        approvalAllowedNow: false,
      }),
    );
    expect(postProcess(payload)).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 2,
        approved: false,
      }),
    );
    expect(prompt).toContain('action=n/a');
    expect(prompt).toContain('takeProfitPrice=n/a');
  });

  it('assigns q5 at the inclusive liquidation-dislocation boundaries', () => {
    const result = postProcess(
      buildPayload({
        baseContext: buildBaseContext({
          venueSpread: -0.0012,
          benchmarkLiquidations15m: 2,
        }),
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        direction: 'SHORT',
        quality: 5,
        approved: true,
        rejectReason: undefined,
      }),
    );
  });

  it.each([
    { venueSpread: -0.001199, benchmarkLiquidations15m: 2 },
    { venueSpread: -0.0012, benchmarkLiquidations15m: 1.999 },
  ])(
    'keeps near-miss liquidation dislocation outside q4+',
    ({ venueSpread, benchmarkLiquidations15m }) => {
      const result = postProcess(
        buildPayload({
          baseContext: buildBaseContext({
            venueSpread,
            benchmarkLiquidations15m,
          }),
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          approved: false,
          rejectReason: 'validated_market_pocket_missing',
        }),
      );
    },
  );

  it('does not promote direction-aligned BNB expansion without the validated liquidation pocket', () => {
    const result = postProcess(
      buildPayload({
        baseContext: buildBaseContext({
          bnbDirectionAligned: true,
          bnbPriceOiDivergenceType: 'price_up_oi_up',
        }),
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 3,
        approved: false,
      }),
    );
  });

  it.each([
    { bnbDirectionAligned: false, bnbStale: false },
    { bnbDirectionAligned: true, bnbStale: true },
  ])(
    'rejects misaligned or stale BNB expansion context',
    ({ bnbDirectionAligned, bnbStale }) => {
      const result = postProcess(
        buildPayload({
          baseContext: buildBaseContext({
            bnbDirectionAligned,
            bnbPriceOiDivergenceType: 'price_up_oi_up',
            bnbStale,
          }),
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          approved: false,
        }),
      );
    },
  );

  it.each([
    {
      gridContext: buildGridContext({ regimeDirection: 'LONG' }),
      blockReason: 'signal_regime_direction_mismatch',
    },
    {
      gridContext: buildGridContext({ volatilityShock: true }),
      blockReason: 'volatility_shock',
    },
  ])(
    'hard-blocks invalid Grid structure even inside a q5 market pocket',
    ({ gridContext, blockReason }) => {
      const payload = buildPayload({
        gridContext,
        baseContext: buildBaseContext({
          venueSpread: -0.0012,
          benchmarkLiquidations15m: 2,
        }),
      });
      const result = postProcess(payload);

      expect(payload.additionalIndicators.gridContext).toEqual(
        expect.objectContaining({
          deterministicQuality: 2,
          approvalAllowedNow: false,
          structuralHardBlockReasons: expect.arrayContaining([blockReason]),
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 2,
          approved: false,
        }),
      );
    },
  );

  it('allows a structurally valid non-martingale increase through the same q5 gate', () => {
    const result = postProcess(
      buildPayload({
        gridContext: buildGridContext({
          action: 'increase',
          level: 2,
          levelsFilled: 1,
          positionQty: 2,
          projectedQty: 3,
        }),
        baseContext: buildBaseContext({
          venueSpread: -0.0012,
          benchmarkLiquidations15m: 2,
        }),
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        direction: 'SHORT',
        quality: 5,
        approved: true,
      }),
    );
  });

  it('rejects an increase whose projected quantity does not grow', () => {
    const result = postProcess(
      buildPayload({
        gridContext: buildGridContext({
          action: 'increase',
          level: 2,
          levelsFilled: 1,
          positionQty: 2,
          projectedQty: 2,
        }),
        baseContext: buildBaseContext({
          venueSpread: -0.0012,
          benchmarkLiquidations15m: 2,
        }),
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 2,
        approved: false,
        rejectReason: 'invalid_increase_level_state',
      }),
    );
  });

  it('maps runtime AI switches from Grid config', () => {
    expect(
      gridAiAdapter.mapEntryRuntimeFromConfig?.({
        ...DEFAULT_CONFIG,
        AI_ENABLED: true,
        AI_MODE: 'gate',
        MIN_AI_QUALITY: 5,
      } as any),
    ).toEqual(
      expect.objectContaining({
        enabled: true,
        mode: 'gate',
        minQuality: 5,
      }),
    );
  });
});
