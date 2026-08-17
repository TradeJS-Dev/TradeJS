import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import {
  AiPayload,
  BaseStrategyContextSnapshot,
  Direction,
  StrategyAiAdapter,
} from '@tradejs/types';
import { LiquidityTailsConfig } from '../config';
import { LiquidityTailsSignalContext } from '../engine';
import { buildLiquidityTailsGuardrailContext } from '../guardrails';
import { withStrategyLocalAiGateFilter } from '@tradejs/strategy-kit/ai-gate';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const toDirection = (value: unknown): Direction | undefined =>
  value === 'LONG' || value === 'SHORT' ? value : undefined;

const getLiquidityTailsContext = (payload: AiPayload) => {
  const additional = asRecord(payload.additionalIndicators);
  const sourceSignalContext = ((additional?.liquidityTailsContext ?? {}) ||
    {}) as Partial<LiquidityTailsSignalContext>;
  const signalDirection = toDirection(payload.signal?.direction);
  const signalContext =
    signalDirection == null
      ? sourceSignalContext
      : { ...sourceSignalContext, signalDirection };
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

const liquidityTailsBaseAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => {
    const baseAdditional =
      (basePayload.additionalIndicators as
        | Record<string, unknown>
        | undefined) ?? {};
    const sourceSignalContext =
      (asRecord(signal.additionalIndicators)?.liquidityTailsContext as
        | Partial<LiquidityTailsSignalContext>
        | undefined) ?? {};
    const signalDirection = toDirection(signal.direction);
    const signalContext =
      signalDirection == null
        ? sourceSignalContext
        : { ...sourceSignalContext, signalDirection };
    const payload = {
      ...basePayload,
      additionalIndicators: {
        ...baseAdditional,
        liquidityTailsContext: signalContext,
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
    const approved =
      context.approvalAllowedNow === true && context.signalDirection != null;

    return {
      ...analysis,
      direction: approved ? context.signalDirection : null,
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
- action=${context.action ?? 'n/a'}
- level=${String(context.level ?? 'n/a')}
- levelsFilled=${String(context.levelsFilled ?? 'n/a')}
- maxLevels=${String(context.maxLevels ?? 'n/a')}
- targetRiskBudgetPct=${String(context.targetRiskBudgetPct ?? 'n/a')}
- positionQty=${String(context.positionQty ?? 'n/a')}
- positionAveragePrice=${String(context.positionAveragePrice ?? 'n/a')}
- priceImprovementAtr=${String(context.priceImprovementAtr ?? 'n/a')}
- projectedQty=${String(context.projectedQty ?? 'n/a')}
- projectedAveragePrice=${String(context.projectedAveragePrice ?? 'n/a')}
- stopLossPrice=${String(context.stopLossPrice ?? 'n/a')}
- takeProfitPrice=${String(context.takeProfitPrice ?? 'n/a')}
- existingRiskValue=${String(context.existingRiskValue ?? 'n/a')}
- remainingRiskValue=${String(context.remainingRiskValue ?? 'n/a')}
- projectedRiskValue=${String(context.projectedRiskValue ?? 'n/a')}
- riskBudgetUsedPct=${String(context.riskBudgetUsedPct ?? 'n/a')}
- initialRiskFraction=${String(context.initialRiskFraction ?? 'n/a')}
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
- priceDistanceToMaSlowAtr=${String(context.priceDistanceToMaSlowAtr ?? 'n/a')}
- liquidityZonesActiveCount=${String(context.liquidityZonesActiveCount ?? 'n/a')}
- atrPctRankBucket=${context.atrPctRankBucket ?? 'n/a'}
- q4AtrRankEligible=${String(context.q4AtrRankEligible)}
- liquidityRisk=${context.liquidityRisk ?? 'n/a'}
- cmcFearGreedValue=${String(context.cmcFearGreedValue ?? 'n/a')}
- altBasketReturn24h=${String(context.altBasketReturn24h ?? 'n/a')}
- top100MarketBreadthDispersion=${String(context.top100MarketBreadthDispersion ?? 'n/a')}
- top100MarketBreadthPctAboveMa20=${String(context.top100MarketBreadthPctAboveMa20 ?? 'n/a')}
- top100MarketBreadthStale=${String(context.top100MarketBreadthStale ?? 'n/a')}
- referenceTrx1hOiChangePct4h=${String(context.referenceTrx1hOiChangePct4h ?? 'n/a')}
- referenceTrx1hStale=${String(context.referenceTrx1hStale ?? 'n/a')}
- higherTimeframeConflict=${String(context.higherTimeframeConflict)}
- benchmarkConflict=${String(context.benchmarkConflict)}
- benchmarkConflictAvailable=${String(context.benchmarkConflictAvailable)}
- derivativesPressure=${context.derivativesPressure ?? 'n/a'}
- derivativesDirectionAligned=${String(context.derivativesDirectionAligned ?? 'n/a')}
- derivativesRiskFlags=${JSON.stringify(context.derivativesRiskFlags)}
- derivativesRiskOffLongRecoveryCandidate=${String(context.derivativesRiskOffLongRecoveryCandidate)}
- shortBreadthStressRecoveryCandidate=${String(context.shortBreadthStressRecoveryCandidate)}
- targetLongRetestRecoveryCandidate=${String(context.targetLongRetestRecoveryCandidate)}
- liquidityTailsGateZoneQuality=${context.liquidityTailsGateFeatures.zoneQuality}
- liquidityTailsGateRetestAcceptance=${context.liquidityTailsGateFeatures.retestAcceptance}
- liquidityTailsGateReactionMomentum=${context.liquidityTailsGateFeatures.reactionMomentum}
- liquidityTailsGateParticipationState=${context.liquidityTailsGateFeatures.participationState}
- liquidityTailsGateDerivativesReversal=${context.liquidityTailsGateFeatures.derivativesReversal}
- liquidityTailsGateTrendContext=${context.liquidityTailsGateFeatures.trendContext}
- liquidityTailsGateGeometry=${JSON.stringify(context.liquidityTailsGateFeatures.geometry)}
- liquidityTailsGatePath=${JSON.stringify(context.liquidityTailsGateFeatures.path)}
- liquidityTailsGateHighQualityRetestPocket=${String(context.liquidityTailsGateFeatures.highQualityRetestPocket)}
- deterministicQuality=${context.deterministicQuality}
- approvalAllowedNow=${String(context.approvalAllowedNow)}
- hardBlockReasons=${JSON.stringify(context.hardBlockReasons)}
- softBlockReasons=${JSON.stringify(context.softBlockReasons)}

Interpretation rules for Liquidity Tails:
- This is a liquidity-rejection retest strategy, not a breakout-following strategy.
- action=increase is a risk-capped additional entry into an existing same-direction basket, not a new independent position.
- level/levelsFilled/maxLevels identify the current scale-in step; all levels share one MAX_LOSS_VALUE budget.
- For increase, evaluate the fresh retest itself; do not inherit approval from the original open signal.
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

export const liquidityTailsAiAdapter = withStrategyLocalAiGateFilter(
  liquidityTailsBaseAiAdapter,
  {
    id: 'liquidity_tails_long_only_2026_08_12',
    allows: ({ signal }) => signal.direction === 'LONG',
  },
);
