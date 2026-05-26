import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import { AiPayload, StrategyAiAdapter } from '@tradejs/types';
import { DoubleTapConfig } from '../config';
import { DoubleTapSignalContext } from '../engine';

type Direction = 'LONG' | 'SHORT';

type DoubleTapAiContext = Partial<DoubleTapSignalContext> & {
  baseContextAvailable: boolean;
  primarySession: string | null;
  trendBias: string | null;
  swingBias: string | null;
  breakoutState: string | null;
  barsSinceBreakout: number | null;
  volumeRel20: number | null;
  benchmarkTrendAlignment: string | null;
  benchmarkBias: string | null;
  derivativesDirectionAligned: boolean | null;
  derivativesRiskFlags: string[];
  bodyStrength: number | null;
  venueSpreadZScore: number | null;
  structuralHardBlockReasons: string[];
  softBlockReasons: string[];
  deterministicQuality: number;
  approvalAllowedNow: boolean;
  maxAllowedQuality: number;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const getDoubleTapContext = (payload: AiPayload) => {
  const additional = asRecord(payload.additionalIndicators);
  return ((additional?.doubleTapContext ?? {}) ||
    {}) as Partial<DoubleTapSignalContext>;
};

const getNestedRecord = (
  record: Record<string, unknown> | null,
  path: string[],
): Record<string, unknown> | null =>
  path.reduce<Record<string, unknown> | null>(
    (current, key) => asRecord(current?.[key]),
    record,
  );

const getNestedNumber = (
  record: Record<string, unknown> | null,
  path: string[],
): number | null =>
  asNumber(
    path.reduce<unknown>((current, key) => {
      return asRecord(current)?.[key];
    }, record),
  );

const getNestedString = (
  record: Record<string, unknown> | null,
  path: string[],
): string | null => {
  const value = path.reduce<unknown>((current, key) => {
    return asRecord(current)?.[key];
  }, record);
  return typeof value === 'string' && value.trim() ? value : null;
};

const getStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.trim().length > 0,
      )
    : [];

const resolveGeometryQuality = (context: Partial<DoubleTapSignalContext>) => {
  const breakoutDistancePct = asNumber(context.breakoutDistancePct) ?? 999;
  const height = asNumber(context.height) ?? 0;
  if (height <= 0) {
    return 1;
  }
  if (breakoutDistancePct <= 0.8) {
    return 4;
  }
  if (breakoutDistancePct <= 1.4) {
    return 3;
  }
  if (breakoutDistancePct <= 2.5) {
    return 2;
  }
  return 1;
};

const isDirectionalCrowding = (
  direction: Direction | null,
  riskFlags: string[],
) =>
  direction === 'LONG'
    ? riskFlags.includes('crowded_long')
    : direction === 'SHORT'
      ? riskFlags.includes('crowded_short')
      : false;

const isBenchmarkAligned = ({
  direction,
  trendAlignment,
  benchmarkBias,
}: {
  direction: Direction | null;
  trendAlignment: string | null;
  benchmarkBias: string | null;
}) =>
  direction === 'LONG'
    ? trendAlignment === 'aligned_bull' || benchmarkBias === 'bull'
    : direction === 'SHORT'
      ? trendAlignment === 'aligned_bear' || benchmarkBias === 'bear'
      : false;

const buildDoubleTapAiContext = (payload: AiPayload): DoubleTapAiContext => {
  const context = getDoubleTapContext(payload);
  const additional = asRecord(payload.additionalIndicators);
  const baseContext = asRecord(additional?.baseContext);
  const derivativesSummary = getNestedRecord(baseContext, [
    'derivatives',
    'summary',
  ]);
  const signalDirection =
    context.signalDirection === 'LONG' || context.signalDirection === 'SHORT'
      ? context.signalDirection
      : null;
  const breakoutDistancePct = asNumber(context.breakoutDistancePct);
  const height = asNumber(context.height);
  const baseContextAvailable = Boolean(baseContext);
  const primarySession = getNestedString(baseContext, [
    'regime',
    'session',
    'sessionPhase',
  ]);
  const trendBias = getNestedString(baseContext, ['regime', 'trend', 'bias']);
  const swingBias = getNestedString(baseContext, [
    'structure',
    'swing',
    'bias',
  ]);
  const breakoutState = getNestedString(baseContext, [
    'structure',
    'localRange',
    'breakoutState',
  ]);
  const barsSinceBreakout = getNestedNumber(baseContext, [
    'structure',
    'localRange',
    'barsSinceBreakout',
  ]);
  const volumeRel20 = getNestedNumber(baseContext, [
    'participation',
    'volume',
    'volumeRel20',
  ]);
  const benchmarkTrendAlignment = getNestedString(baseContext, [
    'relative',
    'benchmark',
    'trendAlignment',
  ]);
  const benchmarkBias = getNestedString(baseContext, [
    'relative',
    'benchmark',
    'bias',
  ]);
  const derivativesDirectionAligned =
    typeof derivativesSummary?.directionAligned === 'boolean'
      ? derivativesSummary.directionAligned
      : null;
  const derivativesRiskFlags = getStringArray(derivativesSummary?.riskFlags);
  const bodyStrength = getNestedNumber(baseContext, [
    'regime',
    'momentum',
    'bodyStrength',
  ]);
  const venueSpreadZScore = getNestedNumber(baseContext, [
    'relative',
    'execution',
    'venueSpreadZScore',
  ]);

  const structuralHardBlockReasons: string[] = [];
  if (!baseContextAvailable) {
    structuralHardBlockReasons.push('missing_base_context');
  }
  if ((height ?? 0) <= 0) {
    structuralHardBlockReasons.push('invalid_pattern_height');
  }
  if (breakoutDistancePct == null || breakoutDistancePct > 1.4) {
    structuralHardBlockReasons.push('extended_or_missing_breakout');
  }

  const geometryQuality = resolveGeometryQuality(context);
  const compactButNotTooEarly =
    breakoutDistancePct != null &&
    breakoutDistancePct > 0.35 &&
    breakoutDistancePct <= 0.8;
  const directionalCrowding = isDirectionalCrowding(
    signalDirection,
    derivativesRiskFlags,
  );
  const benchmarkAligned = isBenchmarkAligned({
    direction: signalDirection,
    trendAlignment: benchmarkTrendAlignment,
    benchmarkBias,
  });
  const trendAligned =
    signalDirection === 'LONG'
      ? trendBias === 'bull'
      : signalDirection === 'SHORT'
        ? trendBias === 'bear'
        : false;
  const breakoutAligned =
    signalDirection === 'LONG'
      ? breakoutState === 'above_high_level'
      : signalDirection === 'SHORT'
        ? breakoutState === 'below_low_level'
        : false;
  const longQualityPocket =
    signalDirection === 'LONG' &&
    breakoutDistancePct != null &&
    breakoutDistancePct > 0.5 &&
    breakoutDistancePct <= 1.4 &&
    primarySession !== 'us' &&
    volumeRel20 != null &&
    volumeRel20 > 2 &&
    barsSinceBreakout != null &&
    barsSinceBreakout <= 1;
  const shortQualityPocket =
    signalDirection === 'SHORT' &&
    breakoutDistancePct != null &&
    breakoutDistancePct > 0.25 &&
    breakoutDistancePct <= 0.8 &&
    (primarySession === 'europe' || primarySession === 'off_hours') &&
    volumeRel20 != null &&
    volumeRel20 > 0.8 &&
    !directionalCrowding &&
    trendAligned;
  const highPrecisionPocket = longQualityPocket || shortQualityPocket;
  const longApprovalPocket =
    signalDirection === 'LONG' &&
    breakoutDistancePct != null &&
    breakoutDistancePct > 0.25 &&
    breakoutDistancePct <= 0.8 &&
    primarySession !== 'us' &&
    volumeRel20 != null &&
    volumeRel20 > 0.8 &&
    breakoutAligned;
  const shortApprovalPocket =
    signalDirection === 'SHORT' &&
    compactButNotTooEarly &&
    !directionalCrowding &&
    (primarySession === 'europe' ||
      primarySession === 'off_hours' ||
      (volumeRel20 != null && volumeRel20 > 1.2) ||
      benchmarkAligned) &&
    (primarySession !== 'us' ||
      trendAligned ||
      (volumeRel20 != null && volumeRel20 > 2));
  const approvalPocket =
    baseContextAvailable &&
    (longApprovalPocket || shortApprovalPocket || highPrecisionPocket);
  const neutralVenueSpread =
    venueSpreadZScore != null &&
    venueSpreadZScore > -1 &&
    venueSpreadZScore < 1;
  const weakSignalBody = bodyStrength != null && bodyStrength < 0.35;
  const softBlockReasons = [
    ...(approvalPocket && !highPrecisionPocket && neutralVenueSpread
      ? ['neutral_venue_spread']
      : []),
    ...(approvalPocket && !highPrecisionPocket && weakSignalBody
      ? ['weak_signal_body']
      : []),
  ];
  const q4ApprovalBlocked = softBlockReasons.length > 0;

  const deterministicQuality =
    structuralHardBlockReasons.length > 0
      ? Math.min(geometryQuality, 2)
      : approvalPocket && highPrecisionPocket
        ? 5
        : approvalPocket && !q4ApprovalBlocked
          ? 4
          : Math.min(geometryQuality, 3);

  return {
    ...context,
    baseContextAvailable,
    primarySession,
    trendBias,
    swingBias,
    breakoutState,
    barsSinceBreakout,
    volumeRel20,
    benchmarkTrendAlignment,
    benchmarkBias,
    derivativesDirectionAligned,
    derivativesRiskFlags,
    bodyStrength,
    venueSpreadZScore,
    structuralHardBlockReasons,
    softBlockReasons,
    deterministicQuality,
    approvalAllowedNow:
      deterministicQuality >= 4 && approvalPocket && !q4ApprovalBlocked,
    maxAllowedQuality: deterministicQuality,
  };
};

export const doubleTapAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => {
    const payload = {
      ...basePayload,
      additionalIndicators: {
        ...(basePayload.additionalIndicators as Record<string, unknown>),
        doubleTapContext: (
          signal.additionalIndicators as Record<string, unknown> | undefined
        )?.doubleTapContext,
      },
    };

    return {
      ...payload,
      additionalIndicators: {
        ...(payload.additionalIndicators as Record<string, unknown>),
        doubleTapContext: buildDoubleTapAiContext(payload),
      },
    };
  },
  postProcessAnalysis: ({ payload, analysis }) => {
    const context = buildDoubleTapAiContext(payload);
    const direction =
      analysis.direction === 'LONG' || analysis.direction === 'SHORT'
        ? analysis.direction
        : context.signalDirection;
    const quality = context.deterministicQuality;
    const approved = context.approvalAllowedNow && Boolean(direction);

    return {
      ...analysis,
      direction: approved ? direction ?? null : null,
      quality,
      qualityReason: approved
        ? analysis.qualityReason
        : 'DoubleTap breakout is not in a baseContext-supported approval pocket.',
    };
  },
  buildHumanPromptAddon: ({ payload }) => {
    const context = buildDoubleTapAiContext(payload);
    return `
Additional DoubleTap context:
- patternKind=${context.patternKind ?? 'n/a'}
- signalDirection=${context.signalDirection ?? 'n/a'}
- neckline=${String(context.neckline ?? 'n/a')}
- targetPrice=${String(context.targetPrice ?? 'n/a')}
- stopLossPrice=${String(context.stopLossPrice ?? 'n/a')}
- height=${String(context.height ?? 'n/a')}
- pivotTolerancePct=${String(context.pivotTolerancePct ?? 'n/a')}
- breakoutDistancePct=${String(context.breakoutDistancePct ?? 'n/a')}
- currentPrice=${String(context.currentPrice ?? 'n/a')}
- baseContextAvailable=${String(context.baseContextAvailable)}
- primarySession=${context.primarySession ?? 'n/a'}
- trendBias=${context.trendBias ?? 'n/a'}
- swingBias=${context.swingBias ?? 'n/a'}
- breakoutState=${context.breakoutState ?? 'n/a'}
- barsSinceBreakout=${String(context.barsSinceBreakout ?? 'n/a')}
- volumeRel20=${String(context.volumeRel20 ?? 'n/a')}
- benchmarkTrendAlignment=${context.benchmarkTrendAlignment ?? 'n/a'}
- derivativesDirectionAligned=${String(context.derivativesDirectionAligned ?? 'n/a')}
- derivativesRiskFlags=${JSON.stringify(context.derivativesRiskFlags)}
- bodyStrength=${String(context.bodyStrength ?? 'n/a')}
- venueSpreadZScore=${String(context.venueSpreadZScore ?? 'n/a')}
- deterministicQuality=${String(context.deterministicQuality)}
- approvalAllowedNow=${String(context.approvalAllowedNow)}
- structuralHardBlockReasons=${JSON.stringify(context.structuralHardBlockReasons)}
- softBlockReasons=${JSON.stringify(context.softBlockReasons)}
- pivots=${JSON.stringify(context.pivots ?? [])}

Interpretation rules for DoubleTap:
- This strategy enters only after a confirmed neckline break of a double bottom or double top.
- Prefer compact breaks close to the neckline; late/extended breaks should be downgraded.
- Extremely tiny breaks can still be early noise; live approval needs support from baseContext.
- Treat deterministicQuality and approvalAllowedNow as the normalized local gate result.
- A good long has two comparable lows and a clean close above the neckline.
- A good short has two comparable highs and a clean close below the neckline.
- Reject or downgrade cases where target/stop geometry leaves poor reward-to-risk after breakout.
`.trim();
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        DoubleTapConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
