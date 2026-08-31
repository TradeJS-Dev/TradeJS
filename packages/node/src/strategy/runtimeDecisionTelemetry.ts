import type {
  RuntimeAllocatorDecision,
  RuntimeRiskDecision,
} from '@tradejs/types';

const finitePositive = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const round = (value: number) => Number(value.toFixed(12));

export const assessRuntimeEntryRisk = ({
  qty,
  entryPrice,
  stopLossPrice,
  maxLossValue,
}: {
  qty: unknown;
  entryPrice: unknown;
  stopLossPrice: unknown;
  maxLossValue: unknown;
}): RuntimeRiskDecision => {
  const normalizedQty = finitePositive(qty);
  const normalizedEntryPrice = finitePositive(entryPrice);
  const normalizedStopLossPrice = finitePositive(stopLossPrice);
  const normalizedMaxLossValue = finitePositive(maxLossValue);
  const plannedLossValue =
    normalizedQty != null &&
    normalizedEntryPrice != null &&
    normalizedStopLossPrice != null
      ? round(
          Math.abs(normalizedEntryPrice - normalizedStopLossPrice) *
            normalizedQty,
        )
      : null;

  if (plannedLossValue == null) {
    return {
      stage: 'order_plan',
      status: 'unavailable',
      reason: 'ORDER_PLAN_RISK_INPUTS_UNAVAILABLE',
      plannedLossValue: null,
      maxLossValue: normalizedMaxLossValue,
      limitUtilization: null,
      enforced: false,
    };
  }
  if (normalizedMaxLossValue == null) {
    return {
      stage: 'order_plan',
      status: 'unavailable',
      reason: 'MAX_LOSS_VALUE_UNAVAILABLE',
      plannedLossValue,
      maxLossValue: null,
      limitUtilization: null,
      enforced: false,
    };
  }

  const limitUtilization = round(plannedLossValue / normalizedMaxLossValue);
  const withinLimit = plannedLossValue <= normalizedMaxLossValue * (1 + 1e-9);
  return {
    stage: 'order_plan',
    status: withinLimit ? 'approved' : 'rejected',
    reason: withinLimit
      ? 'PLANNED_LOSS_WITHIN_MAX_LOSS_VALUE'
      : 'PLANNED_LOSS_EXCEEDS_MAX_LOSS_VALUE',
    plannedLossValue,
    maxLossValue: normalizedMaxLossValue,
    limitUtilization,
    enforced: false,
  };
};

export const buildRuntimeAdmissionDecision = ({
  status,
  reason,
}: Pick<
  RuntimeAllocatorDecision,
  'status' | 'reason'
>): RuntimeAllocatorDecision => ({
  stage: 'runtime_admission',
  status,
  reason,
});
