import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import {
  AiPayload,
  BaseStrategyContextSnapshot,
  StrategyAiAdapter,
} from '@tradejs/types';
import { TrendFollowConfig } from '../config';
import { TrendFollowSignalContext } from '../engine';
import { buildTrendFollowGuardrailContext } from '../guardrails';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getTrendFollowContext = (payload: AiPayload) => {
  const additional = asRecord(payload.additionalIndicators);
  const signalContext = ((additional?.trendFollowContext ?? {}) ||
    {}) as Partial<TrendFollowSignalContext>;
  const baseContext = (additional?.baseContext ??
    null) as BaseStrategyContextSnapshot | null;

  return buildTrendFollowGuardrailContext({
    signalContext,
    baseContext,
    prices: payload.signal?.prices,
  });
};

export const trendFollowAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => {
    const payload = {
      ...basePayload,
      additionalIndicators: {
        ...(basePayload.additionalIndicators as Record<string, unknown>),
        trendFollowContext: (
          signal.additionalIndicators as Record<string, unknown> | undefined
        )?.trendFollowContext,
      },
    };

    return {
      ...payload,
      additionalIndicators: {
        ...(payload.additionalIndicators as Record<string, unknown>),
        trendFollowContext: getTrendFollowContext(payload),
      },
    };
  },
  postProcessAnalysis: ({ payload, analysis }) => {
    const context = getTrendFollowContext(payload);
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
          ) || 'Trend Follow breakout lacks confirmation.',
    };
  },
  buildHumanPromptAddon: ({ payload }) => {
    const context = getTrendFollowContext(payload);
    return `
Additional TrendFollow context:
- signalDirection=${context.signalDirection ?? 'n/a'}
- entryLevel=${String(context.entryLevel ?? 'n/a')}
- trailStop=${String(context.trailStop ?? 'n/a')}
- atr=${String(context.atr ?? 'n/a')}
- pivotKind=${context.pivotKind ?? 'n/a'}
- pivotTimestamp=${String(context.pivotTimestamp ?? 'n/a')}
- pivotValue=${String(context.pivotValue ?? 'n/a')}
- barsSinceSignal=${String(context.barsSinceSignal ?? 'n/a')}
- breakoutDistancePct=${String(context.breakoutDistancePct ?? 'n/a')}
- distanceToStopPct=${String(context.distanceToStopPct ?? 'n/a')}
- currentPrice=${String(context.currentPrice ?? 'n/a')}
- primarySession=${context.primarySession ?? 'n/a'}
- trendBias=${context.trendBias ?? 'n/a'}
- breakoutState=${context.breakoutState ?? 'n/a'}
- momentumRsi=${String(context.momentumRsi ?? 'n/a')}
- volumeRel20=${String(context.volumeRel20 ?? 'n/a')}
- deltaDivergenceVsPrice=${context.deltaDivergenceVsPrice ?? 'n/a'}
- volumeStructureDirectionalShare=${String(context.volumeStructureDirectionalShare ?? 'n/a')}
- volumeStructureDirectionAligned=${String(context.volumeStructureDirectionAligned ?? 'n/a')}
- highConvictionApprovalPocket=${String(context.highConvictionApprovalPocket)}
- trendFollowGateSetupStopDistanceAtr=${String(context.trendFollowGateFeatures.setupStopDistanceAtr ?? 'n/a')}
- trendFollowGateSetupTpDistanceAtr=${String(context.trendFollowGateFeatures.setupTpDistanceAtr ?? 'n/a')}
- trendFollowGateSetupRewardToVolatility=${String(context.trendFollowGateFeatures.setupRewardToVolatility ?? 'n/a')}
- trendFollowGateSetupRiskShape=${context.trendFollowGateFeatures.setupRiskShape}
- trendFollowGateBreakoutBodyAtr=${String(context.trendFollowGateFeatures.breakoutBodyAtr ?? 'n/a')}
- trendFollowGateBreakoutAcceptance=${context.trendFollowGateFeatures.breakoutAcceptance}
- trendFollowGateContinuationState=${context.trendFollowGateFeatures.continuationState}
- trendFollowGateParticipationState=${context.trendFollowGateFeatures.participationState}
- trendFollowGateDirectionalVolumeAligned=${String(context.trendFollowGateFeatures.directionalVolumeAligned ?? 'n/a')}
- trendFollowGateDerivativesContinuation=${context.trendFollowGateFeatures.derivativesContinuation}
- trendFollowGateRelativeContinuation=${context.trendFollowGateFeatures.relativeContinuation}
- trendFollowGateMarketBreadthContinuation=${context.trendFollowGateFeatures.marketBreadthContinuation}
- trendFollowGateMarketBreadthDispersion=${String(context.trendFollowGateFeatures.marketBreadthDispersion ?? 'n/a')}
- trendFollowGateMarketVolatilityState=${String(context.trendFollowGateFeatures.marketVolatilityState ?? 'n/a')}
- trendFollowGateTargetVsBtcBeta20=${String(context.trendFollowGateFeatures.targetVsBtcBeta20 ?? 'n/a')}
- trendFollowGateBtcAltRegimeBtcTurnoverShare24h=${String(context.trendFollowGateFeatures.btcAltRegimeBtcTurnoverShare24h ?? 'n/a')}
- trendFollowGateBtcAltRegimeAltBasketReturn24h=${String(context.trendFollowGateFeatures.btcAltRegimeAltBasketReturn24h ?? 'n/a')}
- trendFollowGateDerivatives1hOiChangePct24h=${String(context.trendFollowGateFeatures.derivatives1hOiChangePct24h ?? 'n/a')}
- trendFollowGateDerivatives1hLiqLong=${String(context.trendFollowGateFeatures.derivatives1hLiqLong ?? 'n/a')}
- trendFollowGateDerivatives1hLiqImbalance=${String(context.trendFollowGateFeatures.derivatives1hLiqImbalance ?? 'n/a')}
- trendFollowGateSharedParticipationScore=${String(context.trendFollowGateFeatures.sharedParticipationScore ?? 'n/a')}
- trendFollowGateMinutesFromSessionOpen=${String(context.trendFollowGateFeatures.minutesFromSessionOpen ?? 'n/a')}
- trendFollowGateReferenceXrp15mOpenInterest=${String(context.trendFollowGateFeatures.referenceXrp15mOpenInterest ?? 'n/a')}
- trendFollowGateReferenceXrp15mOiChangePct24h=${String(context.trendFollowGateFeatures.referenceXrp15mOiChangePct24h ?? 'n/a')}
- trendFollowGateReferenceXrp1hOiChangePct1h=${String(context.trendFollowGateFeatures.referenceXrp1hOiChangePct1h ?? 'n/a')}
- trendFollowGateReferenceSol15mOpenInterest=${String(context.trendFollowGateFeatures.referenceSol15mOpenInterest ?? 'n/a')}
- trendFollowGateReferenceSol15mOiChangePct4h=${String(context.trendFollowGateFeatures.referenceSol15mOiChangePct4h ?? 'n/a')}
- trendFollowGateReferenceSol15mFundingZScore=${String(context.trendFollowGateFeatures.referenceSol15mFundingZScore ?? 'n/a')}
- trendFollowGateReferenceBnb15mOpenInterest=${String(context.trendFollowGateFeatures.referenceBnb15mOpenInterest ?? 'n/a')}
- trendFollowGateReferenceBnb15mOiChangePct24h=${String(context.trendFollowGateFeatures.referenceBnb15mOiChangePct24h ?? 'n/a')}
- trendFollowGateReferenceTrx15mFundingRate=${String(context.trendFollowGateFeatures.referenceTrx15mFundingRate ?? 'n/a')}
- trendFollowGateReferenceEthCrowdingPersistenceBars=${String(context.trendFollowGateFeatures.referenceEthCrowdingPersistenceBars ?? 'n/a')}
- trendFollowGateDerivativesShortFlushOiPocket=${String(context.trendFollowGateFeatures.derivativesShortFlushOiPocket)}
- trendFollowGateMarketRegimeCadencePocket=${String(context.trendFollowGateFeatures.marketRegimeCadencePocket)}
- trendFollowGateParticipationCadencePocket=${String(context.trendFollowGateFeatures.participationCadencePocket)}
- trendFollowGateReferenceDerivativesOiCompressionPocket=${String(context.trendFollowGateFeatures.referenceDerivativesOiCompressionPocket)}
- trendFollowGateReferenceDerivativesXrpFundingPocket=${String(context.trendFollowGateFeatures.referenceDerivativesXrpFundingPocket)}
- trendFollowGateReferenceDerivativesSolFlushPocket=${String(context.trendFollowGateFeatures.referenceDerivativesSolFlushPocket)}
- trendFollowGateReferenceDerivativesLossBlock=${String(context.trendFollowGateFeatures.referenceDerivativesLossBlock)}
- trendFollowGateReferenceDerivativesCadencePocket=${String(context.trendFollowGateFeatures.referenceDerivativesCadencePocket)}
- trendFollowGateReferenceDerivativesOpeningPocket=${String(context.trendFollowGateFeatures.referenceDerivativesOpeningPocket)}
- trendFollowGateNormalVolatilityCadencePocket=${String(context.trendFollowGateFeatures.normalVolatilityCadencePocket)}
- trendFollowGateHighQualityCadencePocket=${String(context.trendFollowGateFeatures.highQualityCadencePocket)}
- benchmarkTrendAlignment=${context.benchmarkTrendAlignment ?? 'n/a'}
- derivativesPressure=${context.derivativesPressure ?? 'n/a'}
- derivativesDirectionAligned=${String(context.derivativesDirectionAligned ?? 'n/a')}
- derivativesRiskFlags=${JSON.stringify(context.derivativesRiskFlags)}
- deterministicQuality=${context.deterministicQuality}
- approvalAllowedNow=${String(context.approvalAllowedNow)}
- hardBlockReasons=${JSON.stringify(context.hardBlockReasons)}
- softBlockReasons=${JSON.stringify(context.softBlockReasons)}

Interpretation rules for TrendFollow:
- This is a market-structure trend-following strategy, not a mean-reversion setup.
- LONG appears when close crosses above the latest confirmed pivot high.
- SHORT appears when close crosses below the latest confirmed pivot low.
- The ATR trailing stop is the structural invalidation line and also updates while a position is open.
- Prefer breakouts aligned with shared market context and backed by participation.
- Late, thin, crowded, inside-range, adverse-delta, weak-momentum, or weak-volume-structure breakouts should be downgraded even if the pivot cross is valid.
- Live approval is reserved for calibrated SHORT derivatives pockets in normal volatility: the legacy BTC benchmark long-liquidation flush, guarded extra-reference XRP/SOL/BNB/TRX continuation pockets, or the narrow opening-session XRP/BNB reference pocket; other structurally valid breakouts remain watch mode.
- Treat deterministicQuality and approvalAllowedNow as the local normalized gate result.
`.trim();
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        TrendFollowConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
