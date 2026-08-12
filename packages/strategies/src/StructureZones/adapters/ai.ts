import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import {
  AiPayload,
  BaseStrategyContextSnapshot,
  StrategyAiAdapter,
} from '@tradejs/types';
import { StructureZonesConfig } from '../config';
import { StructureZonesSignalContext } from '../engine';
import { buildStructureZonesGuardrailContext } from '../guardrails';
import { withStrategyLocalAiGate } from '../../shared/localAiGate';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getStructureZonesContext = (payload: AiPayload) => {
  const additional = asRecord(payload.additionalIndicators);
  const signalContext = ((additional?.structureZonesContext ?? {}) ||
    {}) as Partial<StructureZonesSignalContext>;
  const baseContext = (additional?.baseContext ??
    null) as BaseStrategyContextSnapshot | null;

  return buildStructureZonesGuardrailContext({
    signalContext,
    baseContext,
  });
};

const structureZonesBaseAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => {
    const payload = {
      ...basePayload,
      additionalIndicators: {
        ...(basePayload.additionalIndicators as Record<string, unknown>),
        structureZonesContext: (
          signal.additionalIndicators as Record<string, unknown> | undefined
        )?.structureZonesContext,
      },
    };

    return {
      ...payload,
      additionalIndicators: {
        ...(payload.additionalIndicators as Record<string, unknown>),
        structureZonesContext: getStructureZonesContext(payload),
      },
    };
  },
  postProcessAnalysis: ({ payload, analysis }) => {
    const context = getStructureZonesContext(payload);
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
          ) || 'Structure Zones signal lacks confirmation.',
    };
  },
  buildHumanPromptAddon: ({ payload }) => {
    const context = getStructureZonesContext(payload);
    return `
Additional StructureZones context:
- signalDirection=${context.signalDirection ?? 'n/a'}
- signalKind=${context.signalKind ?? 'n/a'}
- marketState=${context.marketState ?? 'n/a'}
- structureBias=${context.structureBias ?? 'n/a'}
- zoneKind=${context.zoneKind ?? 'n/a'}
- zoneTop=${String(context.zoneTop ?? 'n/a')}
- zoneBottom=${String(context.zoneBottom ?? 'n/a')}
- zoneLevel=${String(context.zoneLevel ?? 'n/a')}
- zoneHeight=${String(context.zoneHeight ?? 'n/a')}
- supportTop=${String(context.supportTop ?? 'n/a')}
- supportBottom=${String(context.supportBottom ?? 'n/a')}
- resistanceTop=${String(context.resistanceTop ?? 'n/a')}
- resistanceBottom=${String(context.resistanceBottom ?? 'n/a')}
- lastHigh=${String(context.lastHigh ?? 'n/a')}
- lastLow=${String(context.lastLow ?? 'n/a')}
- atr=${String(context.atr ?? 'n/a')}
- reactionCloseDistancePct=${String(context.reactionCloseDistancePct ?? 'n/a')}
- reactionBodyAligned=${String(context.reactionBodyAligned ?? 'n/a')}
- currentPrice=${String(context.currentPrice ?? 'n/a')}
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

Interpretation rules for StructureZones:
- This strategy trades confirmed swing support/resistance zones and the derived Market State.
- Trend means higher-high/higher-low or lower-high/lower-low structure is intact.
- Range means structure is not directional enough; zone reactions are mean-reversion candidates.
- Transition means accepted closes beyond the opposite zone while prior structure is at risk.
- LONG can come from support reactions or resistance acceptance; SHORT can come from resistance reactions or support acceptance.
- Treat deterministicQuality and approvalAllowedNow as the local normalized gate result.
`.trim();
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        StructureZonesConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};

export const structureZonesAiAdapter = withStrategyLocalAiGate(
  structureZonesBaseAiAdapter,
  {
    id: 'structure_zones_disabled_2026_08_12',
    approves: () => false,
  },
);
