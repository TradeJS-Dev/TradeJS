import type { BaseStrategyContextSnapshot, Direction } from '@tradejs/types';
import type { GridSignalContext } from './engine';

export const GRID_AI_GATE_THRESHOLDS = {
  maxNegativeVenueSpread: -0.0012,
  minBenchmarkLiquidations15m: 2,
  minShortSolOiChangePct1h: 0.3,
} as const;

export type GridGateFeatures = {
  signalDirection: Direction | null;
  action: 'open' | 'increase' | null;
  regimeDirection: Direction | null;
  volatilityShock: boolean | null;
  venueSpread: number | null;
  benchmarkLiquidations15m: number | null;
  benchmarkDerivativesFresh15m: boolean;
  solOiChangePct1h: number | null;
  solDerivativesFresh15m: boolean;
  bnbDirectionAligned: boolean | null;
  bnbDerivativesFresh15m: boolean;
  longLiquidationDislocationPocket: boolean;
  shortSolOiExpansionPocket: boolean;
  shortBnbDirectionAlignmentPocket: boolean;
};

export type GridGuardrailContext = Partial<GridSignalContext> & {
  signalDirection: Direction | null;
  baseContextAvailable: boolean;
  gridGateFeatures: GridGateFeatures;
  approvalBlockReasons: string[];
  structuralHardBlockReasons: string[];
  riskAnnotations: string[];
  deterministicQuality: number;
  approvalAllowedNow: boolean;
};

const toFiniteNumberOrNull = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toDirectionOrNull = (value: unknown): Direction | null =>
  value === 'LONG' || value === 'SHORT' ? value : null;

const toActionOrNull = (value: unknown): GridGateFeatures['action'] =>
  value === 'open' || value === 'increase' ? value : null;

const getStructuralHardBlockReasons = ({
  signalContext,
  signalDirection,
  regimeDirection,
  action,
}: {
  signalContext: Partial<GridSignalContext>;
  signalDirection: Direction | null;
  regimeDirection: Direction | null;
  action: GridGateFeatures['action'];
}) => {
  const reasons: string[] = [];
  const level = toFiniteNumberOrNull(signalContext.level);
  const levelsFilled = toFiniteNumberOrNull(signalContext.levelsFilled);
  const positionQty = toFiniteNumberOrNull(signalContext.positionQty);
  const projectedQty = toFiniteNumberOrNull(signalContext.projectedQty);

  if (signalDirection == null) reasons.push('missing_signal_direction');
  if (regimeDirection == null) reasons.push('missing_regime_direction');
  if (
    signalDirection != null &&
    regimeDirection != null &&
    signalDirection !== regimeDirection
  ) {
    reasons.push('signal_regime_direction_mismatch');
  }
  if (signalContext.volatilityShock === true) {
    reasons.push('volatility_shock');
  }
  if (action == null) reasons.push('invalid_grid_action');

  if (action === 'open') {
    if (level !== 1 || levelsFilled !== 0 || positionQty !== 0) {
      reasons.push('invalid_open_level_state');
    }
  }
  if (action === 'increase') {
    if (
      level == null ||
      levelsFilled == null ||
      level !== levelsFilled + 1 ||
      levelsFilled < 1 ||
      positionQty == null ||
      positionQty <= 0 ||
      projectedQty == null ||
      projectedQty <= positionQty
    ) {
      reasons.push('invalid_increase_level_state');
    }
  }

  return reasons;
};

export const buildGridGuardrailContext = ({
  signalContext,
  baseContext,
}: {
  signalContext: Partial<GridSignalContext>;
  baseContext?: BaseStrategyContextSnapshot | null;
}): GridGuardrailContext => {
  const signalDirection = toDirectionOrNull(signalContext.entryDirection);
  const regimeDirection = toDirectionOrNull(signalContext.regimeDirection);
  const action = toActionOrNull(signalContext.action);
  const venueSpread = toFiniteNumberOrNull(
    baseContext?.relative?.execution?.venueSpread,
  );
  const benchmark15m = baseContext?.derivatives?.intervals?.['15m'];
  const benchmarkLiquidations15m = toFiniteNumberOrNull(benchmark15m?.liqTotal);
  const benchmarkDerivativesFresh15m = benchmark15m?.stale === false;
  const sol15m =
    baseContext?.derivatives?.referenceContexts?.SOLUSDT?.intervals?.['15m'];
  const solOiChangePct1h = toFiniteNumberOrNull(sol15m?.oiChangePct1h);
  const solDerivativesFresh15m = sol15m?.stale === false;
  const bnbContext =
    baseContext?.derivatives?.referenceContexts?.BNBUSDT ?? null;
  const bnbDirectionAligned =
    typeof bnbContext?.summary?.directionAligned === 'boolean'
      ? bnbContext.summary.directionAligned
      : null;
  const bnbDerivativesFresh15m =
    bnbContext?.intervals?.['15m']?.stale === false;

  const longLiquidationDislocationPocket =
    signalDirection === 'LONG' &&
    venueSpread != null &&
    venueSpread <= GRID_AI_GATE_THRESHOLDS.maxNegativeVenueSpread &&
    benchmarkLiquidations15m != null &&
    benchmarkLiquidations15m >=
      GRID_AI_GATE_THRESHOLDS.minBenchmarkLiquidations15m &&
    benchmarkDerivativesFresh15m;
  const shortSolOiExpansionPocket =
    signalDirection === 'SHORT' &&
    solOiChangePct1h != null &&
    solOiChangePct1h >= GRID_AI_GATE_THRESHOLDS.minShortSolOiChangePct1h &&
    solDerivativesFresh15m;
  const shortBnbDirectionAlignmentPocket =
    signalDirection === 'SHORT' &&
    bnbDirectionAligned === true &&
    bnbDerivativesFresh15m;
  const structuralHardBlockReasons = getStructuralHardBlockReasons({
    signalContext,
    signalDirection,
    regimeDirection,
    action,
  });
  const riskAnnotations: string[] = [];

  if (baseContext == null) riskAnnotations.push('missing_base_context');
  if (!benchmarkDerivativesFresh15m) {
    riskAnnotations.push('benchmark_derivatives_15m_unavailable_or_stale');
  }
  if (!solDerivativesFresh15m) {
    riskAnnotations.push('sol_derivatives_15m_unavailable_or_stale');
  }
  if (!bnbDerivativesFresh15m) {
    riskAnnotations.push('bnb_derivatives_15m_unavailable_or_stale');
  }

  const deterministicQuality =
    structuralHardBlockReasons.length > 0
      ? 2
      : longLiquidationDislocationPocket || shortSolOiExpansionPocket
        ? 5
        : shortBnbDirectionAlignmentPocket
          ? 4
          : 3;
  const approvalBlockReasons = [...structuralHardBlockReasons];
  if (structuralHardBlockReasons.length === 0 && deterministicQuality < 4) {
    approvalBlockReasons.push('validated_market_pocket_missing');
  }
  const approvalAllowedNow =
    deterministicQuality >= 4 && structuralHardBlockReasons.length === 0;
  const gridGateFeatures: GridGateFeatures = {
    signalDirection,
    action,
    regimeDirection,
    volatilityShock:
      typeof signalContext.volatilityShock === 'boolean'
        ? signalContext.volatilityShock
        : null,
    venueSpread,
    benchmarkLiquidations15m,
    benchmarkDerivativesFresh15m,
    solOiChangePct1h,
    solDerivativesFresh15m,
    bnbDirectionAligned,
    bnbDerivativesFresh15m,
    longLiquidationDislocationPocket,
    shortSolOiExpansionPocket,
    shortBnbDirectionAlignmentPocket,
  };

  return {
    ...signalContext,
    signalDirection,
    baseContextAvailable: baseContext != null,
    gridGateFeatures,
    approvalBlockReasons,
    structuralHardBlockReasons,
    riskAnnotations,
    deterministicQuality,
    approvalAllowedNow,
  };
};
