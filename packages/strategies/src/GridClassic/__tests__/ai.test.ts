/** @jest-environment node */

import { gridClassicAiAdapter } from '../adapters/ai';

const buildContext = (overrides: Record<string, unknown> = {}) => ({
  direction: 'LONG',
  gridLevel: 1,
  filledLevels: 0,
  remainingLevels: 1,
  rangeReady: true,
  rangeDetected: true,
  rangeQualityAccepted: true,
  breakoutDirection: null,
  volatilityShock: false,
  entrySignalStage: 'confirmed',
  longRejection: true,
  longCloseInside: true,
  shortRejection: false,
  shortCloseInside: false,
  targetDistanceBps: 150,
  netRiskRatio: 1.1,
  widthAtr: 8,
  containmentRatio: 0.9,
  ...overrides,
});

const buildPayload = (context = buildContext()) =>
  gridClassicAiAdapter.buildPayload!({
    signal: {
      strategy: 'GridClassic',
      direction: context.direction,
      additionalIndicators: { gridClassicContext: context },
    } as any,
    basePayload: {
      strategy: 'GridClassic',
      additionalIndicators: {
        baseContext: { raw: {} },
      },
    } as any,
  }) as any;

const postProcess = (payload: any) =>
  gridClassicAiAdapter.postProcessAnalysis!({
    signal: {} as any,
    payload,
    analysis: {
      direction: 'SHORT',
      quality: 5,
      approved: true,
    } as any,
  });

describe('GridClassic AI adapter', () => {
  it('preserves strategy-specific range and grid context for future exports', () => {
    const context = buildContext();
    const payload = buildPayload(context);

    expect(payload.additionalIndicators.gridClassicContext).toEqual(
      expect.objectContaining({
        ...context,
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );
    expect(payload.additionalIndicators.baseContext).toEqual(
      expect.objectContaining({
        raw: {},
        gridClassicGateFeatures: expect.objectContaining({
          signalDirection: 'LONG',
          action: 'open',
          rejectionConfirmed: true,
        }),
      }),
    );
  });

  it('keeps structurally valid entries at observation-only q3', () => {
    expect(postProcess(buildPayload())).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 3,
        approved: false,
        rejectReason: 'validated_market_pocket_missing',
      }),
    );
  });

  it('keeps a structurally valid scale-in at observation-only q3', () => {
    const payload = buildPayload(
      buildContext({
        gridLevel: 2,
        filledLevels: 1,
        remainingLevels: 0,
        entrySignalStage: 'none',
        longRejection: false,
        longCloseInside: false,
      }),
    );

    expect(postProcess(payload)).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 3,
        approved: false,
        rejectReason: 'validated_market_pocket_missing',
      }),
    );
  });

  it.each([
    ['volatility shock', { volatilityShock: true }, 'volatility_shock'],
    ['range breakout', { breakoutDirection: 'LONG' }, 'range_breakout'],
    [
      'unconfirmed entry',
      { entrySignalStage: 'waiting' },
      'entry_not_confirmed',
    ],
    [
      'invalid grid level',
      { gridLevel: 2, filledLevels: 0 },
      'invalid_grid_level_state',
    ],
    ['invalid economics', { targetDistanceBps: 0 }, 'invalid_entry_economics'],
  ])('rejects %s deterministically', (_label, overrides, reason) => {
    const payload = buildPayload(buildContext(overrides));

    expect(postProcess(payload)).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 2,
        approved: false,
        rejectReason: expect.stringContaining(reason),
      }),
    );
  });

  it('fails closed for malformed context', () => {
    const payload = gridClassicAiAdapter.buildPayload!({
      signal: { additionalIndicators: [] } as any,
      basePayload: { additionalIndicators: [] } as any,
    }) as any;

    expect(payload.additionalIndicators.gridClassicContext).toEqual(
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
  });
});
