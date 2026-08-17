import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import type {
  AiPayload,
  BaseStrategyContextSnapshot,
  StrategyAiAdapter,
} from '@tradejs/types';
import type { VolatilityCompressionBreakoutConfig } from '../config';
import type { VolatilityCompressionBreakoutSignalContext } from '../core';
import {
  buildVolatilityCompressionBreakoutGuardrailContext,
  getVolatilityCompressionBreakoutGuardrailRejectReason,
} from '../guardrails';
import { withStrategyLocalAiGateFilter } from '@tradejs/strategy-kit/ai-gate';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getVolatilityCompressionBreakoutContext = (payload: AiPayload) => {
  const additional = asRecord(payload.additionalIndicators);
  const signalContext = asRecord(
    additional.volatilityCompressionBreakoutContext,
  ) as Partial<VolatilityCompressionBreakoutSignalContext>;
  const baseContext = (additional.baseContext ??
    null) as BaseStrategyContextSnapshot | null;

  return buildVolatilityCompressionBreakoutGuardrailContext({
    signalContext,
    baseContext,
    prices: payload.signal?.prices,
  });
};

const volatilityCompressionBreakoutBaseAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }): AiPayload => {
    const payload = {
      ...basePayload,
      additionalIndicators: {
        ...asRecord(basePayload.additionalIndicators),
        volatilityCompressionBreakoutContext: asRecord(
          signal.additionalIndicators,
        ).volatilityCompressionBreakoutContext,
      },
    };

    return {
      ...payload,
      additionalIndicators: {
        ...asRecord(payload.additionalIndicators),
        volatilityCompressionBreakoutContext:
          getVolatilityCompressionBreakoutContext(payload),
      },
    };
  },
  postProcessAnalysis: ({ payload, analysis }) => {
    const context = getVolatilityCompressionBreakoutContext(payload);
    const requestedDirection =
      analysis.direction === 'LONG' || analysis.direction === 'SHORT'
        ? analysis.direction
        : context.signalDirection;
    const approved =
      context.approvalAllowedNow &&
      requestedDirection != null &&
      requestedDirection === context.signalDirection;

    return {
      ...analysis,
      direction: approved ? requestedDirection : null,
      quality: context.deterministicQuality,
      approved,
      rejectReason: approved
        ? undefined
        : getVolatilityCompressionBreakoutGuardrailRejectReason(context),
    };
  },
  buildHumanPromptAddon: ({ payload }) => {
    const context = getVolatilityCompressionBreakoutContext(payload);
    const gate = context.volatilityCompressionBreakoutGateFeatures;

    return `
Additional VolatilityCompressionBreakout context:
- signalDirection=${context.signalDirection ?? 'n/a'}
- breakoutState=${context.breakoutState ?? 'n/a'}
- compressionConfirmed=${String(context.compressionConfirmed)}
- expansionConfirmed=${String(context.expansionConfirmed)}
- participationConfirmed=${String(context.participationConfirmed)}
- mtfConfirmed=${String(context.mtfConfirmed)}
- tradeFlowConfirmed=${String(context.tradeFlowConfirmed)}
- stopDistanceBps=${String(gate.stopDistanceBps ?? 'n/a')}
- distanceToTrailStopPct=${String(gate.distanceToTrailStopPct ?? 'n/a')}
- momentumRsi=${String(gate.momentumRsi ?? 'n/a')}
- price24hPct=${String(gate.price24hPct ?? 'n/a')}
- freshShortBreakdown=${String(gate.freshShortBreakdown)}
- highQualityFreshShortBreakdown=${String(gate.highQualityFreshShortBreakdown)}
- deterministicQuality=${String(context.deterministicQuality)}
- approvalAllowedNow=${String(context.approvalAllowedNow)}
- approvalBlockReasons=${JSON.stringify(context.approvalBlockReasons)}
`;
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        VolatilityCompressionBreakoutConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};

export const volatilityCompressionBreakoutAiAdapter =
  withStrategyLocalAiGateFilter(volatilityCompressionBreakoutBaseAiAdapter, {
    id: 'volatility_compression_breakout_disabled_2026_08_12',
    allows: () => false,
  });
