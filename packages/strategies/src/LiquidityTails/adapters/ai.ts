import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import {
  AiPayload,
  BaseStrategyContextSnapshot,
  StrategyAiAdapter,
} from '@tradejs/types';
import { LiquidityTailsConfig } from '../config';
import { LiquidityTailsSignalContext } from '../engine';
import { buildLiquidityTailsGuardrailContext } from '../guardrails';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getLiquidityTailsContext = (payload: AiPayload) => {
  const additional = asRecord(payload.additionalIndicators);
  const signalContext = ((additional?.liquidityTailsContext ?? {}) ||
    {}) as Partial<LiquidityTailsSignalContext>;
  const baseContext = (additional?.baseContext ??
    null) as BaseStrategyContextSnapshot | null;

  return buildLiquidityTailsGuardrailContext({
    signalContext,
    baseContext,
  });
};

const withLiquidityTailsGateFeatures = ({
  baseContext,
  context,
}: {
  baseContext: BaseStrategyContextSnapshot | null;
  context: ReturnType<typeof buildLiquidityTailsGuardrailContext>;
}) =>
  baseContext == null
    ? baseContext
    : ({
        ...(baseContext as unknown as Record<string, unknown>),
        liquidityTailsGateFeatures: context.liquidityTailsGateFeatures,
      } as BaseStrategyContextSnapshot & {
        liquidityTailsGateFeatures: typeof context.liquidityTailsGateFeatures;
      });

export const liquidityTailsAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => {
    const baseAdditional =
      (basePayload.additionalIndicators as
        | Record<string, unknown>
        | undefined) ?? {};
    const payload = {
      ...basePayload,
      additionalIndicators: {
        ...baseAdditional,
        liquidityTailsContext: (
          signal.additionalIndicators as Record<string, unknown> | undefined
        )?.liquidityTailsContext,
      },
    };
    const context = getLiquidityTailsContext(payload);
    const baseContext = (baseAdditional.baseContext ??
      null) as BaseStrategyContextSnapshot | null;

    return {
      ...payload,
      additionalIndicators: {
        ...(payload.additionalIndicators as Record<string, unknown>),
        baseContext: withLiquidityTailsGateFeatures({
          baseContext,
          context,
        }),
        liquidityTailsContext: context,
      },
    };
  },
  postProcessAnalysis: ({ payload, analysis }) => {
    const context = getLiquidityTailsContext(payload);
    const requestedDirection =
      analysis.direction === 'LONG' || analysis.direction === 'SHORT'
        ? analysis.direction
        : context.signalDirection;
    const approved =
      context.approvalAllowedNow === true && requestedDirection != null;

    return {
      ...analysis,
      direction: approved ? requestedDirection : null,
      quality: context.deterministicQuality,
      approved,
      rejectReason: approved
        ? undefined
        : [...context.hardBlockReasons, ...context.softBlockReasons].join(
            '; ',
          ) || 'Liquidity Tails retest lacks confirmation.',
    };
  },
  buildHumanPromptAddon: ({ payload }) => {
    const context = getLiquidityTailsContext(payload);
    return `
Additional Liquidity Tails context:
- signalDirection=${context.signalDirection ?? 'n/a'}
- zoneKind=${context.zoneKind ?? 'n/a'}
- zoneTop=${String(context.zoneTop ?? 'n/a')}
- zoneBottom=${String(context.zoneBottom ?? 'n/a')}
- zoneMid=${String(context.zoneMid ?? 'n/a')}
- zoneHeight=${String(context.zoneHeight ?? 'n/a')}
- zoneAgeBars=${String(context.zoneAgeBars ?? 'n/a')}
- zoneTouches=${String(context.zoneTouches ?? 'n/a')}
- originVolume=${String(context.originVolume ?? 'n/a')}
- currentPrice=${String(context.currentPrice ?? 'n/a')}
- atr=${String(context.atr ?? 'n/a')}
- wickBodyRatio=${String(context.wickBodyRatio ?? 'n/a')}
- wickDominanceRatio=${String(context.wickDominanceRatio ?? 'n/a')}
- retestPenetrationPct=${String(context.retestPenetrationPct ?? 'n/a')}
- reactionCloseDistancePct=${String(context.reactionCloseDistancePct ?? 'n/a')}
- reactionBodyAligned=${String(context.reactionBodyAligned ?? 'n/a')}
- primarySession=${context.primarySession ?? 'n/a'}
- trendBias=${context.trendBias ?? 'n/a'}
- breakoutState=${context.breakoutState ?? 'n/a'}
- volumeRel20=${String(context.volumeRel20 ?? 'n/a')}
- bodyStrength=${String(context.bodyStrength ?? 'n/a')}
- adxValue=${String(context.adxValue ?? 'n/a')}
- adxStrength=${context.adxStrength ?? 'n/a'}
- roc1h=${String(context.roc1h ?? 'n/a')}
- roc4h=${String(context.roc4h ?? 'n/a')}
- benchmarkTrendAlignment=${context.benchmarkTrendAlignment ?? 'n/a'}
- atrPctRankBucket=${context.atrPctRankBucket ?? 'n/a'}
- q4AtrRankEligible=${String(context.q4AtrRankEligible)}
- liquidityRisk=${context.liquidityRisk ?? 'n/a'}
- higherTimeframeConflict=${String(context.higherTimeframeConflict)}
- benchmarkConflict=${String(context.benchmarkConflict)}
- derivativesPressure=${context.derivativesPressure ?? 'n/a'}
- derivativesDirectionAligned=${String(context.derivativesDirectionAligned ?? 'n/a')}
- derivativesRiskFlags=${JSON.stringify(context.derivativesRiskFlags)}
- cadenceUpgradePocket=${String(context.cadenceUpgradePocket)}
- liquidityTailsGateZoneQuality=${context.liquidityTailsGateFeatures.zoneQuality}
- liquidityTailsGateRetestAcceptance=${context.liquidityTailsGateFeatures.retestAcceptance}
- liquidityTailsGateReactionMomentum=${context.liquidityTailsGateFeatures.reactionMomentum}
- liquidityTailsGateParticipationState=${context.liquidityTailsGateFeatures.participationState}
- liquidityTailsGateDerivativesReversal=${context.liquidityTailsGateFeatures.derivativesReversal}
- liquidityTailsGateTrendContext=${context.liquidityTailsGateFeatures.trendContext}
- liquidityTailsGateHighQualityRetestPocket=${String(context.liquidityTailsGateFeatures.highQualityRetestPocket)}
- deterministicQuality=${context.deterministicQuality}
- approvalAllowedNow=${String(context.approvalAllowedNow)}
- hardBlockReasons=${JSON.stringify(context.hardBlockReasons)}
- softBlockReasons=${JSON.stringify(context.softBlockReasons)}

Interpretation rules for Liquidity Tails:
- This is a liquidity-rejection retest strategy, not a breakout-following strategy.
- LONG comes from an active green buy-pressure lower-wick zone retest that holds and closes back above the zone.
- SHORT comes from an active red sell-pressure upper-wick zone retest that holds and closes back below the zone.
- Prefer clean pin-bar origins with high wick/body ratio and dominant active wick.
- Prefer retests with aligned reaction body, reasonable penetration into the zone, and participation that is not thin.
- Broken gray ghost zones are historical context only; live entries use active zones.
- Treat deterministicQuality and approvalAllowedNow as the local normalized gate result.
`.trim();
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        LiquidityTailsConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
