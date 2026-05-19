import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import { AiPayload, StrategyAiAdapter } from '@tradejs/types';
import { TrendShiftConfig } from '../config';

type TrendShiftContext = {
  signalDirection?: 'LONG' | 'SHORT';
  confirmedFlip?: boolean;
  bullFlip?: boolean;
  bearFlip?: boolean;
  flipDistanceOk?: boolean;
  closeVsAvgPct?: number;
  bandWidthPct?: number;
  avgSlopePct?: number;
  distanceAtrRatio?: number;
  coinBias?: 'bullish' | 'bearish' | 'neutral' | 'unknown';
  coinBiasAligned?: boolean | null;
  currentPrice?: number;
  avg?: number;
};

type TrendShiftAiContext = TrendShiftContext & {
  deterministicQuality: number;
  approvalAllowedNow: boolean;
  hardBlockReasons: string[];
  coinBiasConflict: boolean;
  derivativesRiskFlags: string[];
  derivativesDirectionAligned: boolean | null;
  derivativesPressure: string | null;
  derivativesFlushSupport: boolean;
  q4LongBreakoutCandidate: boolean;
  q4ShortBreakoutCandidate: boolean;
  breakoutState: string | null;
  volumeRel20: number | null;
  atrPctZScore: number | null;
  relativeStrength1h: number | null;
  sessionPrimary: string | null;
  sessionIsOverlap: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.trim().length > 0,
      )
    : [];

const getFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getTrendShiftContext = (payload: AiPayload): TrendShiftAiContext => {
  const additional = asRecord(payload.additionalIndicators);
  const raw =
    ((additional?.trendShiftContext ?? {}) as TrendShiftContext) || {};
  const derivativesContext = asRecord(additional?.derivativesContext);
  const derivativesSummary = asRecord(derivativesContext?.summary);
  const derivativesIntervals = asRecord(derivativesContext?.intervals);
  const marketContext = asRecord(additional?.marketContext);
  const tradingSession = asRecord(marketContext?.tradingSession);
  const baseContext = asRecord(additional?.baseContext);
  const regime = asRecord(baseContext?.regime);
  const regimeVolatility = asRecord(regime?.volatility);
  const structure = asRecord(baseContext?.structure);
  const localRange = asRecord(structure?.localRange);
  const participation = asRecord(baseContext?.participation);
  const participationVolume = asRecord(participation?.volume);
  const relative = asRecord(baseContext?.relative);
  const benchmark = asRecord(relative?.benchmark);
  const hardBlockReasons: string[] = [];
  const coinBiasConflict = raw.coinBiasAligned === false;
  const derivativesRiskFlags = getStringArray(derivativesSummary?.riskFlags);
  const derivativesDirectionAligned =
    typeof derivativesSummary?.directionAligned === 'boolean'
      ? derivativesSummary.directionAligned
      : null;
  const derivativesPressure =
    typeof derivativesSummary?.pressure === 'string' &&
    derivativesSummary.pressure.trim().length > 0
      ? derivativesSummary.pressure
      : null;
  const sessionPrimary =
    typeof tradingSession?.primarySession === 'string'
      ? tradingSession.primarySession
      : null;
  const sessionIsOverlap = tradingSession?.isOverlap === true;
  const breakoutState =
    typeof localRange?.breakoutState === 'string'
      ? localRange.breakoutState
      : null;
  const volumeRel20 = getFiniteNumber(participationVolume?.volumeRel20);
  const atrPctZScore = getFiniteNumber(regimeVolatility?.atrPctZScore);
  const relativeStrength1h = getFiniteNumber(benchmark?.relativeStrength1h);

  if (!raw.confirmedFlip) {
    hardBlockReasons.push('unconfirmed_flip');
  }
  if (!raw.flipDistanceOk) {
    hardBlockReasons.push('weak_flip_distance');
  }

  const slopeAbs = Math.abs(raw.avgSlopePct ?? 0);
  const distanceAtrRatio = raw.distanceAtrRatio ?? 0;
  const closeVsAvgPctAbs = Math.abs(raw.closeVsAvgPct ?? 0);
  const derivativesFlushSupport =
    raw.signalDirection === 'SHORT'
      ? derivativesRiskFlags.includes('long_liquidation_spike')
      : raw.signalDirection === 'LONG'
        ? derivativesRiskFlags.includes('short_liquidation_spike')
        : false;
  const oiNotConfirming = derivativesRiskFlags.includes('oi_not_confirming');
  const overextendedShortWithoutFlush =
    raw.signalDirection === 'SHORT' &&
    distanceAtrRatio > 1.2 &&
    !derivativesFlushSupport;
  const q4LongBreakoutCandidate =
    raw.signalDirection === 'LONG' &&
    breakoutState === 'above_high_level' &&
    volumeRel20 != null &&
    volumeRel20 >= 1.2 &&
    atrPctZScore != null &&
    atrPctZScore >= 0 &&
    relativeStrength1h != null &&
    relativeStrength1h > -1 &&
    (derivativesDirectionAligned === true ||
      derivativesPressure === 'short_flush');
  const q4ShortBreakoutCandidate =
    raw.signalDirection === 'SHORT' &&
    breakoutState === 'below_low_level' &&
    volumeRel20 != null &&
    volumeRel20 >= 1.2 &&
    atrPctZScore != null &&
    atrPctZScore >= 0 &&
    relativeStrength1h != null &&
    relativeStrength1h < 1 &&
    (derivativesDirectionAligned === true ||
      derivativesPressure === 'long_flush');

  let deterministicQuality = 3;
  if (hardBlockReasons.length > 0) {
    deterministicQuality = raw.confirmedFlip ? 2 : 1;
  } else if (
    distanceAtrRatio >= 0.8 &&
    slopeAbs >= 0.09 &&
    closeVsAvgPctAbs >= 0.12
  ) {
    deterministicQuality = 5;
  } else if (
    distanceAtrRatio >= 0.45 &&
    slopeAbs >= 0.04 &&
    closeVsAvgPctAbs >= 0.05
  ) {
    deterministicQuality = 4;
  }

  if (
    deterministicQuality === 4 &&
    (q4LongBreakoutCandidate || q4ShortBreakoutCandidate)
  ) {
    deterministicQuality = 5;
  }

  if (deterministicQuality >= 5 && volumeRel20 != null && volumeRel20 < 0.8) {
    deterministicQuality = 4;
    hardBlockReasons.push('thin_participation');
  }

  if (
    deterministicQuality >= 5 &&
    oiNotConfirming &&
    !derivativesFlushSupport
  ) {
    deterministicQuality = 4;
    hardBlockReasons.push('oi_not_confirming');
  }

  if (deterministicQuality >= 5 && overextendedShortWithoutFlush) {
    deterministicQuality = 4;
    hardBlockReasons.push('overextended_without_flush');
  }

  if (
    deterministicQuality >= 5 &&
    derivativesPressure === 'neutral' &&
    !derivativesFlushSupport
  ) {
    deterministicQuality = 4;
    hardBlockReasons.push('neutral_derivatives_pressure');
  }

  if (
    deterministicQuality >= 5 &&
    derivativesDirectionAligned == null &&
    !derivativesFlushSupport
  ) {
    deterministicQuality = 4;
    hardBlockReasons.push('derivatives_alignment_unknown');
  }

  return {
    ...raw,
    deterministicQuality,
    approvalAllowedNow: deterministicQuality >= 5,
    hardBlockReasons,
    coinBiasConflict,
    derivativesRiskFlags,
    derivativesDirectionAligned,
    derivativesPressure,
    derivativesFlushSupport,
    q4LongBreakoutCandidate,
    q4ShortBreakoutCandidate,
    breakoutState,
    volumeRel20,
    atrPctZScore,
    relativeStrength1h,
    sessionPrimary,
    sessionIsOverlap,
  };
};

const reasonText = (reason: string) => {
  switch (reason) {
    case 'unconfirmed_flip':
      return 'the internal flip is not confirmed yet';
    case 'weak_flip_distance':
      return 'price moved away from the adaptive average too weakly';
    case 'coin_bias_conflict':
      return 'coin MA bias conflicts with the flip direction';
    case 'oi_not_confirming':
      return 'open interest does not confirm the flip yet';
    case 'overextended_without_flush':
      return 'the SHORT flip already looks overstretched away from the average without a liquidation flush';
    case 'thin_participation':
      return 'participation is too thin versus recent volume for live approval';
    case 'neutral_derivatives_pressure':
      return 'derivatives pressure is neutral, so the flip still lacks conviction';
    case 'derivatives_alignment_unknown':
      return 'derivatives alignment is still unclear, so keep the flip in watch mode';
    default:
      return reason;
  }
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
      rejectReason:
        context.hardBlockReasons.length > 0
          ? context.hardBlockReasons.map(reasonText).join('; ')
          : context.coinBiasConflict
            ? 'coin MA bias still conflicts with the flip; require q5-strength continuation to override it'
            : 'the flip still does not look strong enough for live approval',
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
- derivativesRiskFlags=${JSON.stringify(context.derivativesRiskFlags)}
- sessionPrimary=${context.sessionPrimary ?? 'n/a'}
- sessionIsOverlap=${String(context.sessionIsOverlap)}
- deterministicQuality=${context.deterministicQuality}
- approvalAllowedNow=${context.approvalAllowedNow}
- coinBiasConflict=${context.coinBiasConflict}
- hardBlockReasons=${JSON.stringify(context.hardBlockReasons)}

Interpretation rules for TrendShift:
- This is a trend-state flip strategy, not a forecast of future impulse.
- If approvalAllowedNow=false, do not describe the signal as a fully confirmed live entry.
- Ordinary q4 strength is watch-only; only q5-strength flips qualify for live approval.
- Exception: a q4 breakout can be promoted to q5 when market structure, relative strength, volume participation, and derivatives context confirm the follow-through.
- If derivatives risk flags include 'oi_not_confirming' and there is no supporting liquidation flush, keep the setup in watch mode even when price geometry looks q5-strong.
- For SHORT, if the move is already very far from the adaptive average without a long-liquidation flush, treat it as overextended and keep it in watch mode.
- Thin participation (volumeRel20 < 0.8) is a live hard downgrade even for otherwise q5-looking flips.
- If derivatives pressure is neutral or derivatives alignment is still unknown, keep the flip in watch mode unless there is explicit liquidation-flush support.
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
