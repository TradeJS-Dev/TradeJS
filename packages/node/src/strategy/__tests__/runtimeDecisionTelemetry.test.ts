import {
  assessRuntimeEntryRisk,
  buildRuntimeAdmissionDecision,
} from '../runtimeDecisionTelemetry';

describe('runtime decision telemetry', () => {
  it('assesses the declared order plan without changing execution behavior', () => {
    expect(
      assessRuntimeEntryRisk({
        qty: 0.2,
        entryPrice: 100,
        stopLossPrice: 95,
        maxLossValue: 1,
      }),
    ).toEqual({
      stage: 'order_plan',
      status: 'approved',
      reason: 'PLANNED_LOSS_WITHIN_MAX_LOSS_VALUE',
      plannedLossValue: 1,
      maxLossValue: 1,
      limitUtilization: 1,
      enforced: false,
    });

    expect(
      assessRuntimeEntryRisk({
        qty: 1,
        entryPrice: 100,
        stopLossPrice: 98,
        maxLossValue: 1,
      }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'PLANNED_LOSS_EXCEEDS_MAX_LOSS_VALUE',
      plannedLossValue: 2,
      limitUtilization: 2,
      enforced: false,
    });
  });

  it('records unavailable risk inputs and explicit runtime admission', () => {
    expect(
      assessRuntimeEntryRisk({
        qty: 1,
        entryPrice: 100,
        stopLossPrice: 99,
        maxLossValue: null,
      }),
    ).toEqual({
      stage: 'order_plan',
      status: 'unavailable',
      reason: 'MAX_LOSS_VALUE_UNAVAILABLE',
      plannedLossValue: 1,
      maxLossValue: null,
      limitUtilization: null,
      enforced: false,
    });
    expect(
      buildRuntimeAdmissionDecision({
        status: 'not_applicable',
        reason: 'ENTRY_POLICY_REJECTED',
      }),
    ).toEqual({
      stage: 'runtime_admission',
      status: 'not_applicable',
      reason: 'ENTRY_POLICY_REJECTED',
    });
  });
});
