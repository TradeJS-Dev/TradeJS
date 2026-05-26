import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import {
  AiPayload,
  BaseStrategyContextSnapshot,
  StrategyAiAdapter,
} from '@tradejs/types';
import { MSLLiquidityZonesConfig } from '../config';
import { MSLLiquidityZonesSignalContext } from '../engine';
import { buildMSLLiquidityZonesGuardrailContext } from '../guardrails';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getMSLLiquidityZonesContext = (payload: AiPayload) => {
  const additional = asRecord(payload.additionalIndicators);
  const signalContext = ((additional?.mslLiquidityZonesContext ?? {}) ||
    {}) as Partial<MSLLiquidityZonesSignalContext>;
  const baseContext = (additional?.baseContext ??
    null) as BaseStrategyContextSnapshot | null;

  return buildMSLLiquidityZonesGuardrailContext({
    signalContext,
    baseContext,
  });
};

export const mslLiquidityZonesAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => {
    const payload = {
      ...basePayload,
      additionalIndicators: {
        ...(basePayload.additionalIndicators as Record<string, unknown>),
        mslLiquidityZonesContext: (
          signal.additionalIndicators as Record<string, unknown> | undefined
        )?.mslLiquidityZonesContext,
      },
    };

    return {
      ...payload,
      additionalIndicators: {
        ...(payload.additionalIndicators as Record<string, unknown>),
        mslLiquidityZonesContext: getMSLLiquidityZonesContext(payload),
      },
    };
  },
  postProcessAnalysis: ({ payload, analysis }) => {
    const context = getMSLLiquidityZonesContext(payload);
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
          ) || 'MSL Liquidity Zones retest lacks confirmation.',
    };
  },
  buildHumanPromptAddon: ({ payload }) => {
    const context = getMSLLiquidityZonesContext(payload);
    return `
Additional MSL Liquidity Zones context:
- signalDirection=${context.signalDirection ?? 'n/a'}
- zoneKind=${context.zoneKind ?? 'n/a'}
- zoneTop=${String(context.zoneTop ?? 'n/a')}
- zoneBottom=${String(context.zoneBottom ?? 'n/a')}
- zoneMid=${String(context.zoneMid ?? 'n/a')}
- zoneLevel=${String(context.zoneLevel ?? 'n/a')}
- zoneHeight=${String(context.zoneHeight ?? 'n/a')}
- zoneAgeBars=${String(context.zoneAgeBars ?? 'n/a')}
- hitCount=${String(context.hitCount ?? 'n/a')}
- hitVolume=${String(context.hitVolume ?? 'n/a')}
- filterMode=${context.filterMode ?? 'n/a'}
- filterMetric=${String(context.filterMetric ?? 'n/a')}
- currentPrice=${String(context.currentPrice ?? 'n/a')}
- retestPenetrationPct=${String(context.retestPenetrationPct ?? 'n/a')}
- reactionCloseDistancePct=${String(context.reactionCloseDistancePct ?? 'n/a')}
- reactionBodyAligned=${String(context.reactionBodyAligned ?? 'n/a')}
- primarySession=${context.primarySession ?? 'n/a'}
- trendBias=${context.trendBias ?? 'n/a'}
- breakoutState=${context.breakoutState ?? 'n/a'}
- volumeRel20=${String(context.volumeRel20 ?? 'n/a')}
- benchmarkTrendAlignment=${context.benchmarkTrendAlignment ?? 'n/a'}
- derivativesPressure=${context.derivativesPressure ?? 'n/a'}
- derivativesDirectionAligned=${String(context.derivativesDirectionAligned ?? 'n/a')}
- derivativesRiskFlags=${JSON.stringify(context.derivativesRiskFlags)}
- deterministicQuality=${context.deterministicQuality}
- approvalAllowedNow=${String(context.approvalAllowedNow)}
- hardBlockReasons=${JSON.stringify(context.hardBlockReasons)}
- softBlockReasons=${JSON.stringify(context.softBlockReasons)}

Interpretation rules for MSL Liquidity Zones:
- This strategy trades retests of active pivot-derived liquidity zones.
- LONG comes from a swing-low liquidity zone retest that holds and closes back above the zone.
- SHORT comes from a swing-high liquidity zone retest that holds and closes back below the zone.
- Count/volume hit metrics describe how often delayed candles interacted with the zone after it formed.
- Prefer zones with multiple hits or meaningful volume, clean reaction close, and no thin-participation warning.
- A close fully through the level marks the zone crossed; crossed zones are not live-entry candidates.
- Treat deterministicQuality and approvalAllowedNow as the local normalized gate result.
`.trim();
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        MSLLiquidityZonesConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
