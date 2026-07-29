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
  solOiChangePct1h = null,
  solStale = false,
  targetPocUpVolumeShare = null,
}: {
  solOiChangePct1h?: number | null;
  solStale?: boolean;
  targetPocUpVolumeShare?: number | null;
} = {}) =>
  ({
    regime: { trend: { bias: 'bear' } },
    participation: {
      volumeStructure: {
        pocUpVolumeShare: targetPocUpVolumeShare,
      },
    },
    derivatives: {
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
        targetPocUpVolumeShare: 0.45,
      }),
    });

    expect(payload.additionalIndicators.baseContext).toEqual(
      expect.objectContaining({
        regime: { trend: { bias: 'bear' } },
        gridGateFeatures: expect.objectContaining({
          signalDirection: 'SHORT',
          solOiChangePct1h: 0.3,
          shortSolOiExpansionPocket: true,
          targetPocUpVolumeShare: 0.45,
          shortSolTargetParticipationPocket: true,
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
          targetPocUpVolumeShare: 0.45,
        }),
      }),
    });

    expect(prompt).toContain('action=increase');
    expect(prompt).toContain('level=3');
    expect(prompt).toContain('regimeDirection=SHORT');
    expect(prompt).toContain('projectedAveragePrice=96');
    expect(prompt).toContain('shortSolOiExpansionPocket=true');
    expect(prompt).toContain('targetPocUpVolumeShare=0.45');
    expect(prompt).toContain('shortSolTargetParticipationPocket=true');
    expect(prompt).toContain('deterministicQuality=5');
    expect(prompt).toContain('approvalAllowedNow=true');
    expect(prompt).toContain('only executable market pocket is SHORT');
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

  it('assigns q5 at the inclusive SHORT SOL and target POC boundaries', () => {
    const result = postProcess(
      buildPayload({
        baseContext: buildBaseContext({
          solOiChangePct1h: 0.3,
          targetPocUpVolumeShare: 0.45,
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
    {
      targetPocUpVolumeShare: 0.45,
      approvalAllowedNow: true,
      deterministicQuality: 5,
    },
    {
      targetPocUpVolumeShare: 0.4499,
      approvalAllowedNow: false,
      deterministicQuality: 3,
    },
    {
      targetPocUpVolumeShare: null,
      approvalAllowedNow: false,
      deterministicQuality: 3,
    },
  ])(
    'enforces the rounded target POC confirmation boundary',
    ({ targetPocUpVolumeShare, approvalAllowedNow, deterministicQuality }) => {
      const payload = buildPayload({
        baseContext: buildBaseContext({
          solOiChangePct1h: 0.3,
          targetPocUpVolumeShare,
        }),
      });
      const result = postProcess(payload);

      expect(payload.additionalIndicators.gridContext).toEqual(
        expect.objectContaining({
          deterministicQuality,
          approvalAllowedNow,
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          direction: approvalAllowedNow ? 'SHORT' : null,
          quality: deterministicQuality,
          approved: approvalAllowedNow,
        }),
      );
    },
  );

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
            targetPocUpVolumeShare: 0.45,
          }),
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          approved: false,
          rejectReason: 'target_confirmed_sol_pocket_missing',
        }),
      );
    },
  );

  it('does not promote LONG from the SHORT-only target-confirmed SOL pocket', () => {
    const result = postProcess(
      buildPayload({
        gridContext: buildGridContext({
          entryDirection: 'LONG',
          regimeDirection: 'LONG',
        }),
        baseContext: buildBaseContext({
          solOiChangePct1h: 1,
          targetPocUpVolumeShare: 1,
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
          targetPocUpVolumeShare: 0.45,
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
          targetPocUpVolumeShare: 0.45,
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
          targetPocUpVolumeShare: 0.45,
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
