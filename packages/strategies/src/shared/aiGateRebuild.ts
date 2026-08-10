import type { AiPayload, StrategyAiAdapter } from '@tradejs/types';
import {
  makeObservationOnlyAiAdapter,
  makePassThroughAiAdapter,
  makeRuleBasedAiAdapter,
  type RebuiltAiGateRule,
} from './aiGateObservation';

type AiGateRebuildMode = 'legacy' | 'observation' | 'pass-through' | 'rebuilt';

export type AiGateRebuildPolicy = {
  mode: AiGateRebuildMode;
  rule?: RebuiltAiGateRule;
};

const getPath = (payload: AiPayload, path: string): unknown =>
  path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return (value as Record<string, unknown>)[key];
  }, payload);

const getNumber = (payload: AiPayload, path: string): number | null => {
  const rawValue = getPath(payload, path);
  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue) ? rawValue : null;
  }
  if (typeof rawValue !== 'string' || !rawValue.trim()) return null;

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
};

const getString = (payload: AiPayload, path: string): string | null => {
  const value = getPath(payload, path);
  return typeof value === 'string' ? value : null;
};

const rebuiltRules: Record<string, RebuiltAiGateRule> = {
  AdaptiveMomentumRibbon: {
    id: 'adaptive_momentum_ribbon_long_breadth_poc',
    approves: ({ signal, payload }) => {
      const unchanged = getNumber(
        payload,
        'additionalIndicators.baseContext.relative.marketBreadths.top100.unchanged',
      );
      const pointOfControlVolumeShare = getNumber(
        payload,
        'additionalIndicators.baseContext.participation.volumeStructure.pointOfControlVolumeShare',
      );

      return (
        signal.direction === 'LONG' &&
        unchanged != null &&
        unchanged >= 10 &&
        pointOfControlVolumeShare != null &&
        pointOfControlVolumeShare <= 0.166
      );
    },
  },
  DoubleTap: {
    id: 'double_tap_long_dispersion_momentum',
    approves: ({ signal, payload }) => {
      const altDispersion24h = getNumber(
        payload,
        'additionalIndicators.doubleTapContext.altDispersion24h',
      );
      const roc1h = getNumber(
        payload,
        'additionalIndicators.baseContext.regime.momentum.roc1h',
      );

      return (
        signal.direction === 'LONG' &&
        altDispersion24h != null &&
        altDispersion24h >= 0.032 &&
        roc1h != null &&
        roc1h >= 0
      );
    },
  },
  RelativeRotation: {
    id: 'relative_rotation_short_channel_liquidations',
    approves: ({ signal, payload }) => {
      const centerlineSlope = getNumber(
        payload,
        'additionalIndicators.baseContext.regime.trend.adaptiveChannel.centerlineSlope',
      );
      const trxLiquidationImbalance = getNumber(
        payload,
        'additionalIndicators.baseContext.derivatives.referenceContexts.TRXUSDT.intervals.1h.liqImbalance',
      );

      return (
        signal.direction === 'SHORT' &&
        centerlineSlope != null &&
        centerlineSlope <= -0.0002 &&
        trxLiquidationImbalance != null &&
        trxLiquidationImbalance >= 0.17
      );
    },
  },
  StructureZones: {
    id: 'structure_zones_bull_mtf_breadth',
    approves: ({ payload }) => {
      const mtfAlignment = getString(
        payload,
        'additionalIndicators.baseContext.mtf.summary.mtfAlignment',
      );
      const decliners = getNumber(
        payload,
        'additionalIndicators.baseContext.relative.marketBreadths.top50.decliners',
      );

      return (
        mtfAlignment === 'aligned_bull' && decliners != null && decliners >= 1
      );
    },
  },
};

const passThroughStrategies = new Set(['Grid', 'TrendFollow', 'TrendLine']);

const observationStrategies = new Set([
  'LiquidityZones',
  'VolatilityCompressionBreakout',
]);

export const getAiGateRebuildPolicy = (
  strategyName: string,
): AiGateRebuildPolicy => {
  const rule = rebuiltRules[strategyName];
  if (rule) return { mode: 'rebuilt', rule };
  if (passThroughStrategies.has(strategyName)) return { mode: 'pass-through' };
  if (observationStrategies.has(strategyName)) return { mode: 'observation' };
  return { mode: 'legacy' };
};

export const applyAiGateRebuildPolicy = (
  strategyName: string,
  adapter: StrategyAiAdapter = {},
): StrategyAiAdapter => {
  const policy = getAiGateRebuildPolicy(strategyName);

  if (policy.mode === 'legacy') return adapter;
  if (policy.mode === 'pass-through') return makePassThroughAiAdapter(adapter);
  if (policy.mode === 'rebuilt' && policy.rule) {
    return makeRuleBasedAiAdapter(adapter, policy.rule);
  }

  return makeObservationOnlyAiAdapter(adapter);
};
