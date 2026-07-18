import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import {
  AiPayload,
  BaseStrategyContextSnapshot,
  StrategyAiAdapter,
} from '@tradejs/types';
import { TrendShiftConfig } from '../config';
import {
  buildTrendShiftGuardrailContext,
  getTrendShiftGuardrailRejectReason,
  TrendShiftSignalContext,
} from '../guardrails';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getTrendShiftContext = (payload: AiPayload) => {
  const additional = asRecord(payload.additionalIndicators);
  const raw =
    ((additional?.trendShiftContext ?? {}) as TrendShiftSignalContext) || {};
  const baseContext = (additional?.baseContext ??
    null) as BaseStrategyContextSnapshot | null;

  return buildTrendShiftGuardrailContext({
    signalContext: raw,
    baseContext,
  });
};

const withTrendShiftGateFeatures = ({
  baseContext,
  context,
}: {
  baseContext: BaseStrategyContextSnapshot | null;
  context: ReturnType<typeof buildTrendShiftGuardrailContext>;
}) =>
  baseContext == null
    ? baseContext
    : ({
        ...(baseContext as unknown as Record<string, unknown>),
        trendShiftGateFeatures: context.trendShiftGateFeatures,
      } as BaseStrategyContextSnapshot & {
        trendShiftGateFeatures: typeof context.trendShiftGateFeatures;
      });

export const trendShiftAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => {
    const baseAdditional = basePayload.additionalIndicators as Record<
      string,
      unknown
    >;
    const payload = {
      ...basePayload,
      additionalIndicators: {
        ...baseAdditional,
        trendShiftContext: (
          signal.additionalIndicators as Record<string, unknown> | undefined
        )?.trendShiftContext,
      },
    };
    const context = getTrendShiftContext(payload);
    const baseContext = (baseAdditional.baseContext ??
      null) as BaseStrategyContextSnapshot | null;

    return {
      ...payload,
      additionalIndicators: {
        ...(payload.additionalIndicators as Record<string, unknown>),
        baseContext: withTrendShiftGateFeatures({
          baseContext,
          context,
        }),
        trendShiftContext: context,
      },
    };
  },
  postProcessAnalysis: ({ payload, analysis }) => {
    const context = getTrendShiftContext(payload);
    const requestedDirection =
      analysis.direction === 'LONG' || analysis.direction === 'SHORT'
        ? analysis.direction
        : context.signalDirection;

    if (context.approvalAllowedNow === true && requestedDirection != null) {
      return {
        ...analysis,
        direction: requestedDirection,
        quality: context.deterministicQuality,
        approved: true,
      };
    }

    return {
      ...analysis,
      direction: null,
      quality: context.deterministicQuality,
      approved: false,
      rejectReason: getTrendShiftGuardrailRejectReason(context),
    };
  },
  buildHumanPromptAddon: ({ payload }) => {
    const context = getTrendShiftContext(payload);
    return `
Additional TrendShift context:
- signalDirection=${context.signalDirection ?? 'n/a'}
- confirmedFlip=${String(context.confirmedFlip)}
- bullFlip=${String(context.bullFlip)}
- bearFlip=${String(context.bearFlip)}
- flipDistanceOk=${String(context.flipDistanceOk)}
- closeVsAvgPct=${String(context.closeVsAvgPct ?? 'n/a')}
- bandWidthPct=${String(context.bandWidthPct ?? 'n/a')}
- avgSlopePct=${String(context.avgSlopePct ?? 'n/a')}
- distanceAtrRatio=${String(context.distanceAtrRatio ?? 'n/a')}
- coinBias=${context.coinBias ?? 'n/a'}
- coinBiasAligned=${String(context.coinBiasAligned)}
- derivativesPressure=${context.derivativesPressure ?? 'n/a'}
- derivativesDirectionAligned=${String(context.derivativesDirectionAligned)}
- derivativesFlushSupport=${String(context.derivativesFlushSupport)}
- breakoutState=${context.breakoutState ?? 'n/a'}
- swingBias=${context.swingBias ?? 'n/a'}
- volumeRel20=${String(context.volumeRel20 ?? 'n/a')}
- atrPctZScore=${String(context.atrPctZScore ?? 'n/a')}
- bbWidthPct=${String(context.bbWidthPct ?? 'n/a')}
- adaptiveChannelDirection=${context.adaptiveChannelDirection ?? 'n/a'}
- liquidityTailSide=${context.liquidityTailSide ?? 'n/a'}
- nearPointOfControl=${String(context.nearPointOfControl ?? 'n/a')}
- relativeStrength1h=${String(context.relativeStrength1h ?? 'n/a')}
- marketBreadthReturn=${String(context.marketBreadthReturn ?? 'n/a')}
- marketBreadthAdvancers=${String(context.marketBreadthAdvancers ?? 'n/a')}
- marketBreadthPctAboveMa20=${String(context.marketBreadthPctAboveMa20 ?? 'n/a')}
- btcVsAltReturn24h=${String(context.btcVsAltReturn24h ?? 'n/a')}
- btcVsAltReturn1h=${String(context.btcVsAltReturn1h ?? 'n/a')}
- cmcFearGreedValue=${String(context.cmcFearGreedValue ?? 'n/a')}
- cmcFearGreedValueChange24h=${String(context.cmcFearGreedValueChange24h ?? 'n/a')}
- derivatives1hLiqShort=${String(context.derivatives1hLiqShort ?? 'n/a')}
- btcAltRegime=${context.btcAltRegime ?? 'n/a'}
- cmcExchangeLiquidityVolumeChange24hPct=${String(context.cmcExchangeLiquidityVolumeChange24hPct ?? 'n/a')}
- trendShiftGateReversalConfirmation=${context.trendShiftGateFeatures.reversalConfirmation}
- trendShiftGateExhaustionSignal=${context.trendShiftGateFeatures.exhaustionSignal}
- trendShiftGateOiConfirmation=${context.trendShiftGateFeatures.oiConfirmation}
- trendShiftGateFlipStretch=${context.trendShiftGateFeatures.flipStretch}
- trendShiftGateQ4RecoveryProfile=${context.trendShiftGateFeatures.q4RecoveryProfile}
- trendShiftGateDerivativesReversalAlignment=${context.trendShiftGateFeatures.derivativesReversalAlignment}
- trendShiftGateRelativeStrengthBucket=${context.trendShiftGateFeatures.relativeStrengthBucket}
- trendShiftGateConflictCount=${String(context.trendShiftGateFeatures.conflictCount)}
- trendShiftGateMtfAlignment=${context.trendShiftGateFeatures.mtfAlignment}
- q4LongBreakoutCandidate=${String(context.q4LongBreakoutCandidate)}
- q4ShortBreakoutCandidate=${String(context.q4ShortBreakoutCandidate)}
- q4ShortFailedLowBreakoutCandidate=${String(context.q4ShortFailedLowBreakoutCandidate)}
- shortNeutralBearChannelBreakdownCandidate=${String(context.shortNeutralBearChannelBreakdownCandidate)}
- selectiveNeutralQ4Candidate=${String(context.selectiveNeutralQ4Candidate)}
- longRelativeStrengthOverextended=${String(context.longRelativeStrengthOverextended)}
- longPriceUpOiDivergence=${String(context.longPriceUpOiDivergence)}
- longLowerTailPriceUpOiDivergence=${String(context.longLowerTailPriceUpOiDivergence)}
- shortUsLongFlushRisk=${String(context.shortUsLongFlushRisk)}
- shortFailedLowOiNotConfirming=${String(context.shortFailedLowOiNotConfirming)}
- shortBelowLowOiFallingLongFlushRisk=${String(context.shortBelowLowOiFallingLongFlushRisk)}
- shortNearPointOfControlRisk=${String(context.shortNearPointOfControlRisk)}
- shortLowBollingerWidthRisk=${String(context.shortLowBollingerWidthRisk)}
- defensiveRewardToVolatilityRisk=${String(context.defensiveRewardToVolatilityRisk)}
- shortBullSwingStructureRisk=${String(context.shortBullSwingStructureRisk)}
- shortAsiaLongFlushLowCmcBreadthRisk=${String(context.shortAsiaLongFlushLowCmcBreadthRisk)}
- derivativesDataUnavailableStressRisk=${String(context.derivativesDataUnavailableStressRisk)}
- longBtcAltRegimeRisk=${String(context.longBtcAltRegimeRisk)}
- longBroadMarketShortFlushRisk=${String(context.longBroadMarketShortFlushRisk)}
- cmcExchangeLiquidityVolumeChangeRisk=${String(context.cmcExchangeLiquidityVolumeChangeRisk)}
- q4TrendShiftGateFeaturesRecoveryCandidate=${String(context.q4TrendShiftGateFeaturesRecoveryCandidate)}
- q4UsClosingOiConfirmationRecoveryCandidate=${String(context.q4UsClosingOiConfirmationRecoveryCandidate)}
- q4ShortBreadthShockLiquidationRecoveryCandidate=${String(context.q4ShortBreadthShockLiquidationRecoveryCandidate)}
- q4LongAltLeadershipRecoveryCandidate=${String(context.q4LongAltLeadershipRecoveryCandidate)}
- derivativesRiskFlags=${JSON.stringify(context.derivativesRiskFlags)}
- priceOiDivergenceType=${context.priceOiDivergenceType ?? 'n/a'}
- sessionPrimary=${context.sessionPrimary ?? 'n/a'}
- sessionWindowPhase=${context.sessionWindowPhase ?? 'n/a'}
- sessionIsOverlap=${String(context.sessionIsOverlap)}
- deterministicQuality=${context.deterministicQuality}
- approvalAllowedNow=${context.approvalAllowedNow}
- coinBiasConflict=${context.coinBiasConflict}
- hardBlockReasons=${JSON.stringify(context.hardBlockReasons)}

Interpretation rules for TrendShift:
- This is a trend-state flip strategy, not a forecast of future impulse.
- If approvalAllowedNow=false, do not describe the signal as a fully confirmed live entry.
- Ordinary q4 strength is watch-only; only core q5-strength flips qualify for live approval.
- Even if a q4 breakout or failed-breakout pocket looks interesting, keep it as research/watch-only until it proves robust across wider history.
- Exception: a very narrow SHORT q4 pocket may still pass when Asia-session reversal pressure looks neutral but a real long-liquidation flush is already visible and geometry is near-q5 strong.
- Exception: selective neutral-derivatives q4 pockets may still pass only in the explicitly tested session/structure combinations surfaced by selectiveNeutralQ4Candidate.
- Exception: a narrow SHORT breakdown may still pass through neutral derivatives when shortNeutralBearChannelBreakdownCandidate=true: price is below the local low, ATR z-score is normal, and the adaptive channel already points bear.
- Exception: q4TrendShiftGateFeaturesRecoveryCandidate=true may pass only when TrendShift-local gate features show neutral relative strength, exactly two conflicts, MTF is not against the trade, and the only recovered veto is neutral derivatives pressure or US-session SHORT OI non-expansion.
- If derivatives risk flags include 'oi_not_confirming' and there is no supporting liquidation flush, keep the setup in watch mode even when price geometry looks q5-strong.
- For SHORT, if the move is already very far from the adaptive average without a long-liquidation flush, treat it as overextended and keep it in watch mode.
- Thin participation (volumeRel20 < 0.8) is a live hard downgrade even for otherwise q5-looking flips.
- If derivatives pressure is neutral or derivatives alignment is still unknown, keep the flip in watch mode unless there is explicit liquidation-flush support.
- SHORT failed-low-breakout setups are watch-only at q4 strength; require true q5 geometry and expanding OI before live approval.
- For LONG, strong positive relativeStrength1h can mean the flip is already overextended versus BTC; falling OI during a price rise is also a watch-only warning.
- For LONG, a lower liquidity tail after price and OI already expanded is a watch-only warning even when geometry is q5-strong.
- For SHORT, US-session long-flush setups are watch-only unless later research revalidates that pocket.
- For SHORT, a below-low long-liquidation flush with falling OI is watch-only outside Asia because it lacks continuation OI.
- For SHORT, being near the price-volume point of control is a watch-only warning; LONG near-POC flips are not blocked by this rule.
- For SHORT, a bullish swing structure is a watch-only warning even when the immediate flip geometry looks q5-strong.
- For SHORT, a narrow Bollinger-width compression pocket is watch-only even if another q4 recovery condition is present.
- For SHORT, Asia-session long-flush setups are watch-only when CMC fear/greed and market breadth are already in capitulation.
- If benchmark derivatives data is missing or stale while CMC fear/greed is in stress mode, keep the flip in watch mode; neutral/unknown derivatives are not confirmation in that state.
- The defensive live gate requires rewardToVolatility >= 8 when that field is available.
- For LONG, BTC-led or risk-off BTC/alt regime is watch-only even when flip geometry is q5-strong.
- For LONG, broad-market squeeze clusters are watch-only when breadth is already extreme, BTC is leading alts, and benchmark derivatives show a short flush.
- If CMC major-exchange liquidity 24h change is in the historically choppy bands (-0.1, 0) or [0.1, 0.3), keep the flip in watch mode.
- A narrow q4 recovery is allowed during the US closing window only when the sole blocker is missing OI expansion on an otherwise liquidation-supported US-session flush.
- A narrow SHORT q4 recovery may pass during a market breadth shock only when marketBreadthReturn <= -0.0112952 and 1h liqShort <= 0.208; this does not override existing hard blockers or the low-Bollinger-width defensive cut.
- A narrow LONG q4 recovery may pass only when alt leadership is clear (btcVsAltReturn24h <= -0.00503054 and btcVsAltReturn1h <= -0.00581403), fear/greed is not falling hard, and the only blockers are the tested OI/benchmark-derivatives or defensive reward-to-volatility blockers.
- If hardBlockReasons is not empty, explain exactly what is still missing for confirmation.
`.trim();
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        TrendShiftConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
