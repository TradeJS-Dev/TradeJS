import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import type {
  AiPayload,
  BaseStrategyContextSnapshot,
  StrategyAiAdapter,
} from '@tradejs/types';
import type { RelativeRotationConfig } from '../config';
import type { RelativeRotationSignalContext } from '../core';
import { buildRelativeRotationGuardrailContext } from '../guardrails';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getRelativeRotationContext = (payload: AiPayload) => {
  const additional = asRecord(payload.additionalIndicators);
  const signalContext = asRecord(
    additional.relativeRotationContext,
  ) as Partial<RelativeRotationSignalContext>;
  const baseContext = (additional.baseContext ??
    null) as BaseStrategyContextSnapshot | null;

  return buildRelativeRotationGuardrailContext({
    signalContext,
    baseContext,
  });
};

export const relativeRotationAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }): AiPayload => {
    const payload = {
      ...basePayload,
      additionalIndicators: {
        ...asRecord(basePayload.additionalIndicators),
        relativeRotationContext: asRecord(signal.additionalIndicators)
          .relativeRotationContext,
      },
    };

    return {
      ...payload,
      additionalIndicators: {
        ...asRecord(payload.additionalIndicators),
        relativeRotationContext: getRelativeRotationContext(payload),
      },
    };
  },
  postProcessAnalysis: ({ payload, analysis }) => {
    const context = getRelativeRotationContext(payload);
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
          ) || 'Relative Rotation signal lacks validated confirmation.',
    };
  },
  buildHumanPromptAddon: ({ payload }) => {
    const context = getRelativeRotationContext(payload);
    return `
Additional RelativeRotation context:
- signalDirection=${context.signalDirection ?? 'n/a'}
- targetVsBtcRatioReturn1h=${String(context.targetVsBtcRatioReturn1h ?? 'n/a')}
- targetVsBtcAlpha1h=${String(context.targetVsBtcAlpha1h ?? 'n/a')}
- targetVsBtcAlpha24h=${String(context.targetVsBtcAlpha24h ?? 'n/a')}
- targetVsBtcRatioReturn24h=${String(context.targetVsBtcRatioReturn24h ?? 'n/a')}
- targetVsEthRatioTrend=${context.targetVsEthRatioTrend ?? 'n/a'}
- targetVsEthAligned=${String(context.targetVsEthAligned ?? 'n/a')}
- btcAltRegime=${context.btcAltRegime ?? 'n/a'}
- marketBreadthReturn=${String(context.marketBreadthReturn ?? 'n/a')}
- volumeRel20=${String(context.volumeRel20 ?? 'n/a')}
- trendBias=${context.trendBias ?? 'n/a'}
- distanceToLowLevelAtr=${String(context.distanceToLowLevelAtr ?? 'n/a')}
- adxDiMinus=${String(context.adxDiMinus ?? 'n/a')}
- contextConflictCount=${String(context.contextConflictCount ?? 'n/a')}
- totalContextScore=${String(context.totalContextScore ?? 'n/a')}
- deterministicQuality=${context.deterministicQuality}
- approvalAllowedNow=${String(context.approvalAllowedNow)}
- hardBlockReasons=${JSON.stringify(context.hardBlockReasons)}
- softBlockReasons=${JSON.stringify(context.softBlockReasons)}

Interpretation rules for RelativeRotation:
- The strategy trades target-symbol strength or weakness relative to BTC.
- Treat target-vs-BTC 1h return as the signal-time relative-strength field; do not use the legacy benchmark ratio metric.
- The validated deterministic pocket only approves SHORT signals at least 2.75 ATR below the local low while ADX DI- is at most 50.
- distanceToLowLevelAtr and adxDiMinus are signal-time causal fields, not trade outcomes.
- Treat deterministicQuality and approvalAllowedNow as the local normalized gate result.
`.trim();
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        RelativeRotationConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
