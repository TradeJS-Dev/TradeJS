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
  solOiChangePct1h = null,
  solStale = false,
  bnbDirectionAligned = false,
  bnbStale = false,
}: {
  venueSpread?: number;
  benchmarkLiquidations15m?: number;
  benchmarkStale?: boolean;
  solOiChangePct1h?: number | null;
  solStale?: boolean;
  bnbDirectionAligned?: boolean;
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
        SOLUSDT: {
          intervals: {
            '15m': {
              stale: solStale,
              oiChangePct1h: solOiChangePct1h,
            },
          },
          summary: {},
        },
        BNBUSDT: {
          intervals: { '15m': { stale: bnbStale } },
          summary: {
            directionAligned: bnbDirectionAligned,
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
        solOiChangePct1h: 0.3,
      }),
    });

    expect(payload.additionalIndicators.baseContext).toEqual(
      expect.objectContaining({
        regime: { trend: { bias: 'bear' } },
        gridGateFeatures: expect.objectContaining({
          signalDirection: 'SHORT',
          solOiChangePct1h: 0.3,
          shortSolOiExpansionPocket: true,
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
          solOiChangePct1h: 0.3,
          bnbDirectionAligned: true,
        }),
      }),
    });

    expect(prompt).toContain('action=increase');
    expect(prompt).toContain('level=3');
    expect(prompt).toContain('regimeDirection=SHORT');
    expect(prompt).toContain('projectedAveragePrice=96');
    expect(prompt).toContain('shortSolOiExpansionPocket=true');
    expect(prompt).toContain('shortBnbDirectionAlignmentPocket=true');
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

  it('assigns q5 at the inclusive SHORT SOL OI-growth boundary', () => {
    const result = postProcess(
      buildPayload({
        baseContext: buildBaseContext({
          solOiChangePct1h: 0.3,
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
    { solOiChangePct1h: 0.2999, solStale: false },
    { solOiChangePct1h: 0.3, solStale: true },
    { solOiChangePct1h: null, solStale: false },
  ])(
    'keeps missing, stale, or near-miss SOL expansion outside q5',
    ({ solOiChangePct1h, solStale }) => {
      const result = postProcess(
        buildPayload({
          baseContext: buildBaseContext({
            solOiChangePct1h,
            solStale,
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

  it('assigns q4 to a fresh direction-aligned BNB context for SHORT', () => {
    const result = postProcess(
      buildPayload({
        baseContext: buildBaseContext({
          bnbDirectionAligned: true,
        }),
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        direction: 'SHORT',
        quality: 4,
        approved: true,
      }),
    );
  });

  it.each([
    { bnbDirectionAligned: false, bnbStale: false },
    { bnbDirectionAligned: true, bnbStale: true },
  ])(
    'rejects misaligned or stale BNB context',
    ({ bnbDirectionAligned, bnbStale }) => {
      const result = postProcess(
        buildPayload({
          baseContext: buildBaseContext({
            bnbDirectionAligned,
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

  it('keeps the legacy liquidation-dislocation pocket only for LONG', () => {
    const marketContext = buildBaseContext({
      venueSpread: -0.0012,
      benchmarkLiquidations15m: 2,
    });
    const longResult = postProcess(
      buildPayload({
        gridContext: buildGridContext({
          entryDirection: 'LONG',
          regimeDirection: 'LONG',
        }),
        baseContext: marketContext,
      }),
    );
    const shortResult = postProcess(
      buildPayload({ baseContext: marketContext }),
    );

    expect(longResult).toEqual(
      expect.objectContaining({
        direction: 'LONG',
        quality: 5,
        approved: true,
      }),
    );
    expect(shortResult).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 3,
        approved: false,
      }),
    );
  });

  it('does not promote LONG from the SHORT-only SOL and BNB pockets', () => {
    const result = postProcess(
      buildPayload({
        gridContext: buildGridContext({
          entryDirection: 'LONG',
          regimeDirection: 'LONG',
        }),
        baseContext: buildBaseContext({
          solOiChangePct1h: 1,
          bnbDirectionAligned: true,
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
          solOiChangePct1h: 0.3,
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
          solOiChangePct1h: 0.3,
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
          solOiChangePct1h: 0.3,
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
