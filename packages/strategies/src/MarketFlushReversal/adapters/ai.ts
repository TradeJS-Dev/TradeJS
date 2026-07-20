import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import type {
  AiPayload,
  BaseStrategyContextSnapshot,
  StrategyAiAdapter,
} from '@tradejs/types';
import type { MarketFlushReversalConfig } from '../config';
import {
  buildMarketFlushReversalGuardrailContext,
  type MarketFlushReversalGateFeatures,
} from '../guardrails';
import type { MarketFlushReversalSignalContext } from '../core';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getMarketFlushReversalContext = (payload: AiPayload) => {
  const additional = asRecord(payload.additionalIndicators);
  const signalContext = (additional?.marketFlushReversalContext ??
    {}) as Partial<MarketFlushReversalSignalContext>;
  const baseContext = (additional?.baseContext ??
    null) as BaseStrategyContextSnapshot | null;

  return buildMarketFlushReversalGuardrailContext({
    signalContext,
    baseContext,
  });
};

const withMarketFlushReversalGateFeatures = ({
  baseContext,
  context,
}: {
  baseContext: BaseStrategyContextSnapshot | null;
  context: ReturnType<typeof buildMarketFlushReversalGuardrailContext>;
}) =>
  baseContext == null
    ? baseContext
    : ({
        ...(baseContext as unknown as Record<string, unknown>),
        marketFlushReversalGateFeatures:
          context.marketFlushReversalGateFeatures,
      } as BaseStrategyContextSnapshot & {
        marketFlushReversalGateFeatures: MarketFlushReversalGateFeatures;
      });

export const marketFlushReversalAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }): AiPayload => {
    const baseAdditional = asRecord(basePayload.additionalIndicators) ?? {};
    const payload = {
      ...basePayload,
      additionalIndicators: {
        ...baseAdditional,
        marketFlushReversalContext: asRecord(signal.additionalIndicators)
          ?.marketFlushReversalContext,
      },
    };
    const context = getMarketFlushReversalContext(payload);
    const baseContext = (baseAdditional.baseContext ??
      null) as BaseStrategyContextSnapshot | null;

    return {
      ...payload,
      additionalIndicators: {
        ...(payload.additionalIndicators as Record<string, unknown>),
        baseContext: withMarketFlushReversalGateFeatures({
          baseContext,
          context,
        }),
        marketFlushReversalContext: context,
      },
    };
  },
  postProcessAnalysis: ({ payload, analysis }) => {
    const context = getMarketFlushReversalContext(payload);
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
        : context.approvalBlockReasons.join('; ') ||
          'Market flush reversal lacks broad-market confirmation.',
    };
  },
  buildHumanPromptAddon: ({ payload }) => {
    const context = getMarketFlushReversalContext(payload);
    return `
Additional Market Flush Reversal context:
- signalDirection=${context.signalDirection ?? 'n/a'}
- broadMarketPressure=${context.marketPressure ?? 'n/a'}
- broadMarketRiskFlags=${context.marketRiskFlags?.join(',') || 'none'}
- broadMarketLiqSpikeRatio=${String(context.marketLiqSpikeRatio ?? 'n/a')}
- broadMarketLiqImbalance=${String(context.marketLiqImbalance ?? 'n/a')}
- broadMarketFlushConfirmed=${String(context.marketFlushConfirmed)}
- sweepState=${context.sweepState ?? 'n/a'}
- breakoutState=${context.breakoutState ?? 'n/a'}
- tailSide=${context.tailSide ?? 'n/a'}
- rangePosition20=${String(context.rangePosition20 ?? 'n/a')}
- sweepWickPct=${String(context.sweepWickPct ?? 'n/a')}
- volumeRel20=${String(context.volumeRel20 ?? 'n/a')}
- buyPressurePct=${String(context.buyPressurePct ?? 'n/a')}
- deltaDivergenceVsPrice=${context.deltaDivergenceVsPrice ?? 'n/a'}
- targetVsBtcRatioReturn24h=${String(context.marketFlushReversalGateFeatures.targetVsBtcRatioReturn24h ?? 'n/a')}
- ethVsBtcVolumeRatio=${String(context.marketFlushReversalGateFeatures.ethVsBtcVolumeRatio ?? 'n/a')}
- h1RangePosition=${String(context.marketFlushReversalGateFeatures.h1RangePosition ?? 'n/a')}
- calibratedLongRebound=${String(context.marketFlushReversalGateFeatures.calibratedLongRebound)}
- stopDistanceAtr=${String(context.marketFlushReversalGateFeatures.stopDistanceAtr ?? 'n/a')}
- cmcIndexRegime=${context.marketFlushReversalGateFeatures.cmcIndexRegime ?? 'n/a'}
- cmcIndexStale=${String(context.marketFlushReversalGateFeatures.cmcIndexStale ?? 'n/a')}
- rsiState=${context.marketFlushReversalGateFeatures.rsiState ?? 'n/a'}
- validatedAiLongPocket=${String(context.marketFlushReversalGateFeatures.validatedAiLongPocket)}
- approvalAllowedNow=${String(context.approvalAllowedNow)}
- deterministicQuality=${String(context.deterministicQuality)}
- approvalBlockReasons=${context.approvalBlockReasons.join(',') || 'none'}
	`;
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        MarketFlushReversalConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
