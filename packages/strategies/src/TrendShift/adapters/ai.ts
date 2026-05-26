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

export const trendShiftAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => ({
    ...basePayload,
    additionalIndicators: {
      ...(basePayload.additionalIndicators as Record<string, unknown>),
      trendShiftContext: (
        signal.additionalIndicators as Record<string, unknown> | undefined
      )?.trendShiftContext,
    },
  }),
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
- volumeRel20=${String(context.volumeRel20 ?? 'n/a')}
- atrPctZScore=${String(context.atrPctZScore ?? 'n/a')}
- relativeStrength1h=${String(context.relativeStrength1h ?? 'n/a')}
- q4LongBreakoutCandidate=${String(context.q4LongBreakoutCandidate)}
- q4ShortBreakoutCandidate=${String(context.q4ShortBreakoutCandidate)}
- q4ShortFailedLowBreakoutCandidate=${String(context.q4ShortFailedLowBreakoutCandidate)}
- selectiveNeutralQ4Candidate=${String(context.selectiveNeutralQ4Candidate)}
- longRelativeStrengthOverextended=${String(context.longRelativeStrengthOverextended)}
- longPriceUpOiDivergence=${String(context.longPriceUpOiDivergence)}
- shortUsLongFlushRisk=${String(context.shortUsLongFlushRisk)}
- shortFailedLowOiNotConfirming=${String(context.shortFailedLowOiNotConfirming)}
- derivativesRiskFlags=${JSON.stringify(context.derivativesRiskFlags)}
- priceOiDivergenceType=${context.priceOiDivergenceType ?? 'n/a'}
- sessionPrimary=${context.sessionPrimary ?? 'n/a'}
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
- If derivatives risk flags include 'oi_not_confirming' and there is no supporting liquidation flush, keep the setup in watch mode even when price geometry looks q5-strong.
- For SHORT, if the move is already very far from the adaptive average without a long-liquidation flush, treat it as overextended and keep it in watch mode.
- Thin participation (volumeRel20 < 0.8) is a live hard downgrade even for otherwise q5-looking flips.
- If derivatives pressure is neutral or derivatives alignment is still unknown, keep the flip in watch mode unless there is explicit liquidation-flush support.
- SHORT failed-low-breakout setups are watch-only at q4 strength; require true q5 geometry and expanding OI before live approval.
- For LONG, strong positive relativeStrength1h can mean the flip is already overextended versus BTC; falling OI during a price rise is also a watch-only warning.
- For SHORT, US-session long-flush setups are watch-only unless later research revalidates that pocket.
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
