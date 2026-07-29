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
- price1hPct=${String(context.price1hPct ?? 'n/a')}
- marketBreadthDispersion=${String(context.marketBreadthDispersion ?? 'n/a')}
- altBasketReturn1h=${String(context.altBasketReturn1h ?? 'n/a')}
- btcVsAltReturn1h=${String(context.btcVsAltReturn1h ?? 'n/a')}
- btcTurnoverShare24h=${String(context.btcTurnoverShare24h ?? 'n/a')}
- cmcFearGreedValueChange7d=${String(context.cmcFearGreedValueChange7d ?? 'n/a')}
- cmcFearGreedStale=${String(context.cmcFearGreedStale ?? 'n/a')}
- minutesToFundingWindow=${String(context.minutesToFundingWindow ?? 'n/a')}
- contextConflictCount=${String(context.contextConflictCount ?? 'n/a')}
- totalContextScore=${String(context.totalContextScore ?? 'n/a')}
- deterministicQuality=${context.deterministicQuality}
- approvalAllowedNow=${String(context.approvalAllowedNow)}
- hardBlockReasons=${JSON.stringify(context.hardBlockReasons)}
- softBlockReasons=${JSON.stringify(context.softBlockReasons)}

Interpretation rules for RelativeRotation:
- The strategy trades target-symbol strength or weakness relative to BTC.
- Treat target-vs-BTC 1h return as the signal-time relative-strength field; do not use the legacy benchmark ratio metric.
- The primary deterministic pocket approves SHORT signals at least 2.75 ATR below the local low, with ADX DI- at most 50, a 1h price move of at most -5%, and a non-stale CMC Fear & Greed 7d change of at least -12.
- The validated recovery pocket may also approve such a downside impulse when market breadth dispersion is at least 0.0085 and the 1h alt-basket return is at least -0.015.
- Both SHORT pockets additionally require BTC to outperform the alt basket by at least -0.001 over 1h and BTC to hold at least 0.25 of BTC-plus-alt 24h turnover.
- Both SHORT pockets are disabled during the first 30 minutes after an 8-hour funding timestamp; minutesToFundingWindow must be at most 435.
- distanceToLowLevelAtr, adxDiMinus, price1hPct, marketBreadthDispersion, altBasketReturn1h, btcVsAltReturn1h, btcTurnoverShare24h, minutesToFundingWindow, and CMC Fear & Greed context are signal-time causal fields, not trade outcomes.
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
