import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import {
  AiPayload,
  BaseStrategyContextSnapshot,
  StrategyAiAdapter,
} from '@tradejs/types';
import { AdaptiveTrendChannelConfig } from '../config';
import { AdaptiveTrendChannelSignalContext } from '../engine';
import { buildAdaptiveTrendChannelGuardrailContext } from '../guardrails';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getAdaptiveTrendChannelContext = (payload: AiPayload) => {
  const additional = asRecord(payload.additionalIndicators);
  const signalContext = ((additional?.adaptiveTrendChannelContext ?? {}) ||
    {}) as Partial<AdaptiveTrendChannelSignalContext>;
  const baseContext = (additional?.baseContext ??
    null) as BaseStrategyContextSnapshot | null;

  return buildAdaptiveTrendChannelGuardrailContext({
    signalContext,
    baseContext,
  });
};

export const adaptiveTrendChannelAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => {
    const payload = {
      ...basePayload,
      additionalIndicators: {
        ...(basePayload.additionalIndicators as Record<string, unknown>),
        adaptiveTrendChannelContext: (
          signal.additionalIndicators as Record<string, unknown> | undefined
        )?.adaptiveTrendChannelContext,
      },
    };

    return {
      ...payload,
      additionalIndicators: {
        ...(payload.additionalIndicators as Record<string, unknown>),
        adaptiveTrendChannelContext: getAdaptiveTrendChannelContext(payload),
      },
    };
  },
  postProcessAnalysis: ({ payload, analysis }) => {
    const context = getAdaptiveTrendChannelContext(payload);
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
          ) || 'Adaptive Trend Channel flip lacks confirmation.',
    };
  },
  buildHumanPromptAddon: ({ payload }) => {
    const context = getAdaptiveTrendChannelContext(payload);
    return `
Additional AdaptiveTrendChannel context:
- signalDirection=${context.signalDirection ?? 'n/a'}
- regime=${String(context.regime ?? 'n/a')}
- centerline=${String(context.centerline ?? 'n/a')}
- roof=${String(context.roof ?? 'n/a')}
- floor=${String(context.floor ?? 'n/a')}
- halfChannel=${String(context.halfChannel ?? 'n/a')}
- atr=${String(context.atr ?? 'n/a')}
- breakoutDistancePct=${String(context.breakoutDistancePct ?? 'n/a')}
- channelWidthPct=${String(context.channelWidthPct ?? 'n/a')}
- currentPrice=${String(context.currentPrice ?? 'n/a')}
- primarySession=${context.primarySession ?? 'n/a'}
- trendBias=${context.trendBias ?? 'n/a'}
- breakoutState=${context.breakoutState ?? 'n/a'}
- volumeRel20=${String(context.volumeRel20 ?? 'n/a')}
- rsi=${String(context.rsi ?? 'n/a')}
- bbWidthRank100=${String(context.bbWidthRank100 ?? 'n/a')}
- trendFollowState=${context.trendFollowState ?? 'n/a'}
- h4VolatilityState=${context.h4VolatilityState ?? 'n/a'}
- benchmarkTrendAlignment=${context.benchmarkTrendAlignment ?? 'n/a'}
- targetLiqImbalance1h=${String(context.targetLiqImbalance1h ?? 'n/a')}
- targetLiqSpikeRatio1h=${String(context.targetLiqSpikeRatio1h ?? 'n/a')}
- targetLiqTotal1h=${String(context.targetLiqTotal1h ?? 'n/a')}
- ethLiqImbalance1h=${String(context.ethLiqImbalance1h ?? 'n/a')}
- ethFundingRate1h=${String(context.ethFundingRate1h ?? 'n/a')}
- xrpOpenInterest15m=${String(context.xrpOpenInterest15m ?? 'n/a')}
- xrpPriceOiDivergenceType=${context.xrpPriceOiDivergenceType ?? 'n/a'}
- xrpFundingZScore1h=${String(context.xrpFundingZScore1h ?? 'n/a')}
- btcVsAltReturn24h=${String(context.btcVsAltReturn24h ?? 'n/a')}
- baseApproveBias=${context.baseApproveBias ?? 'n/a'}
- deterministicQuality=${context.deterministicQuality}
- approvalAllowedNow=${String(context.approvalAllowedNow)}
- hardBlockReasons=${JSON.stringify(context.hardBlockReasons)}
- softBlockReasons=${JSON.stringify(context.softBlockReasons)}

Interpretation rules for AdaptiveTrendChannel:
- This strategy follows flips in a stateful adaptive regression channel.
- LONG appears when the channel regime flips from bearish to bullish.
- SHORT appears when the channel regime flips from bullish to bearish.
- The centerline is the adaptive rail; floor/roof are volatility-scaled invalidation bands.
- Prefer flips with reasonable distance from the centerline and confirmation from shared market context.
- Thin participation, missing shared-context confirmation, or missing liquidation-shock recovery evidence should downgrade the setup.
- A high-XRP-OI reject bias should remain blocked unless a narrow XRP reference SHORT recovery setup is present.
- Treat deterministicQuality and approvalAllowedNow as the local normalized gate result.
`.trim();
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        AdaptiveTrendChannelConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
