import type { Direction, StrategyConfig } from '@tradejs/types';

export class EntrySubmissionValidationError extends Error {
  override name = 'EntrySubmissionValidationError';
}

export interface EntryExecutionLimits {
  minimumNetRiskRatio?: number;
  maxLossValue?: number;
  feeRate: number;
  slippageBps: number;
}

export const resolveEntryExecutionLimits = (
  config: StrategyConfig,
  direction: Direction,
): EntryExecutionLimits | undefined => {
  const side: unknown = config[direction];
  const minimum: unknown =
    side && typeof side === 'object' && 'minRiskRatio' in side
      ? side.minRiskRatio
      : undefined;
  const maximum: unknown = config.MAX_LOSS_VALUE;
  if (minimum == null && maximum == null) return undefined;
  const minimumNetRiskRatio = minimum == null ? undefined : Number(minimum);
  const maxLossValue = maximum == null ? undefined : Number(maximum);
  const feeRate = Number(config.RISK_FEE_RATE ?? 0);
  const slippage = Number(config.RISK_SLIPPAGE_BPS ?? 0);
  const impact = Number(config.RISK_MARKET_IMPACT_BPS ?? 0);
  const slippageBps = slippage + impact;
  if (
    (minimumNetRiskRatio != null &&
      (!Number.isFinite(minimumNetRiskRatio) || minimumNetRiskRatio < 0)) ||
    (maxLossValue != null &&
      (!Number.isFinite(maxLossValue) || maxLossValue <= 0)) ||
    !Number.isFinite(feeRate) ||
    feeRate < 0 ||
    feeRate >= 1 ||
    !Number.isFinite(slippage) ||
    slippage < 0 ||
    !Number.isFinite(impact) ||
    impact < 0 ||
    !Number.isFinite(slippageBps) ||
    slippageBps < 0 ||
    slippageBps >= 10_000
  )
    throw new Error('INVALID_ENTRY_EXECUTION_LIMITS');
  return { minimumNetRiskRatio, maxLossValue, feeRate, slippageBps };
};

export const resolveEntryStopLossPrice = <TStop extends number | null>(
  direction: Direction,
  price: number,
  absoluteStop: TStop,
  distance?: number,
) =>
  distance == null
    ? absoluteStop
    : price + (direction === 'LONG' ? -distance : distance);

export const validateEntryExecution = ({
  direction,
  price,
  qty,
  stopLossPrice,
  takeProfitPrice,
  limits,
}: {
  direction: Direction;
  price: number;
  qty: number;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  limits: EntryExecutionLimits;
}) => {
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(qty) ||
    qty <= 0 ||
    stopLossPrice == null ||
    !Number.isFinite(stopLossPrice) ||
    stopLossPrice <= 0 ||
    (takeProfitPrice != null &&
      (!Number.isFinite(takeProfitPrice) || takeProfitPrice <= 0))
  )
    throw new EntrySubmissionValidationError(
      'ENTRY_ECONOMICS_INPUTS_UNAVAILABLE',
    );
  const side = direction === 'LONG' ? 1 : -1;
  if (
    side * (price - stopLossPrice) <= 0 ||
    (takeProfitPrice != null && side * (takeProfitPrice - price) <= 0)
  )
    throw new EntrySubmissionValidationError(
      'INVALID_ENTRY_PROTECTION_AT_SUBMISSION',
    );
  // Same one-way fee/slippage convention as strategy admission and sizing.
  const slippage = limits.slippageBps / 10_000;
  const cost = (value: number, sign: number) =>
    value * slippage + value * (1 + sign * slippage) * limits.feeRate;
  const entryCost = cost(price, side);
  const lossPerUnit =
    Math.abs(price - stopLossPrice) + entryCost + cost(stopLossPrice, -side);
  const rewardPerUnit =
    takeProfitPrice == null
      ? 0
      : Math.max(
          0,
          Math.abs(takeProfitPrice - price) -
            entryCost -
            cost(takeProfitPrice, -side),
        );
  const netRiskRatio = rewardPerUnit / lossPerUnit;
  const plannedLossValue = qty * lossPerUnit;
  if (!Number.isFinite(netRiskRatio) || !Number.isFinite(plannedLossValue))
    throw new EntrySubmissionValidationError(
      'ENTRY_ECONOMICS_INPUTS_UNAVAILABLE',
    );
  const belowMinimumNetRiskRatio =
    limits.minimumNetRiskRatio != null &&
    netRiskRatio <= limits.minimumNetRiskRatio;
  const riskExceeded =
    limits.maxLossValue != null &&
    plannedLossValue > limits.maxLossValue * (1 + 1e-9);
  return {
    netRiskRatio,
    plannedLossValue,
    riskExceeded,
    belowMinimumNetRiskRatio,
  };
};
