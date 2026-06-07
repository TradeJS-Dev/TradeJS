import {
  BACKTEST_BASE_SLIPPAGE_BPS,
  BACKTEST_MARKET_IMPACT_BPS,
  BACKTEST_SPREAD_SLIPPAGE_MULTIPLIER,
} from '../constants';

export type ExecutionSlippageStage = 'entry' | 'exit';
export type ExecutionSlippageDirection = 'LONG' | 'SHORT';

export type ExecutionSlippageModelParams = {
  baseSlippageBps?: number | null;
  spreadBps?: number | null;
  spreadMultiplier?: number | null;
  marketImpactBps?: number | null;
};

export type ApplyExecutionSlippageParams = ExecutionSlippageModelParams & {
  price: number;
  direction: ExecutionSlippageDirection;
  stage: ExecutionSlippageStage;
};

const toNonNegativeFiniteNumber = (
  value: number | null | undefined,
  fallback = 0,
) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;

const toFiniteNumberOrNull = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;

const extractFreshTargetVenueSpreadBps = (
  targetVenue: Record<string, unknown> | null,
) => {
  if (!targetVenue) {
    return null;
  }

  if (targetVenue.stale === true || targetVenue.available === false) {
    return null;
  }

  return toFiniteNumberOrNull(targetVenue.spreadBps);
};

export const calculateEffectiveSlippageBps = ({
  baseSlippageBps = BACKTEST_BASE_SLIPPAGE_BPS,
  spreadBps,
  spreadMultiplier = BACKTEST_SPREAD_SLIPPAGE_MULTIPLIER,
  marketImpactBps = BACKTEST_MARKET_IMPACT_BPS,
}: ExecutionSlippageModelParams = {}) => {
  const base = toNonNegativeFiniteNumber(baseSlippageBps);
  const spread = toNonNegativeFiniteNumber(spreadBps);
  const multiplier = toNonNegativeFiniteNumber(spreadMultiplier);
  const marketImpact = toNonNegativeFiniteNumber(marketImpactBps);

  return base + spread * multiplier + marketImpact;
};

export const slippageBpsToRate = (slippageBps: number) =>
  toNonNegativeFiniteNumber(slippageBps) / 10_000;

export const applyExecutionSlippage = ({
  price,
  direction,
  stage,
  ...modelParams
}: ApplyExecutionSlippageParams) => {
  const slippageRate = slippageBpsToRate(
    calculateEffectiveSlippageBps(modelParams),
  );

  if (!slippageRate) {
    return price;
  }

  const sign =
    direction === 'LONG'
      ? stage === 'entry'
        ? 1
        : -1
      : stage === 'entry'
        ? -1
        : 1;

  return price * (1 + sign * slippageRate);
};

export const extractExecutionSpreadBps = (signal?: {
  additionalIndicators?: Record<string, unknown>;
}) => {
  const additionalIndicators = toRecord(signal?.additionalIndicators);
  const explicitSlippage = toRecord(additionalIndicators?.executionSlippage);
  const explicitSpread = toFiniteNumberOrNull(explicitSlippage?.spreadBps);
  if (explicitSpread != null) {
    return explicitSpread;
  }

  const marketContext = toRecord(additionalIndicators?.marketContext);
  const marketExecution = toRecord(marketContext?.execution);
  const marketTargetVenue = toRecord(marketExecution?.targetVenue);
  const marketTargetSpread =
    extractFreshTargetVenueSpreadBps(marketTargetVenue);
  if (marketTargetSpread != null) {
    return marketTargetSpread;
  }

  const baseContext = toRecord(additionalIndicators?.baseContext);
  const relative = toRecord(baseContext?.relative);
  const execution = toRecord(relative?.execution);
  const targetVenue = toRecord(execution?.targetVenue);
  return extractFreshTargetVenueSpreadBps(targetVenue);
};

export const extractExecutionMarketImpactBps = (signal?: {
  additionalIndicators?: Record<string, unknown>;
}) => {
  const additionalIndicators = toRecord(signal?.additionalIndicators);
  const explicitSlippage = toRecord(additionalIndicators?.executionSlippage);
  return toFiniteNumberOrNull(explicitSlippage?.marketImpactBps);
};
