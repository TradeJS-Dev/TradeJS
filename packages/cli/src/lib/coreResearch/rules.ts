import type { CoreResearchMetrics, CoreResearchThresholdRule } from './types';

export const getCoreResearchMetricValue = (
  metrics: CoreResearchMetrics,
  metric: CoreResearchThresholdRule['metric'],
) => {
  if (
    metric === 'profitFactor' &&
    metrics.profitFactorStatus === 'infinite_no_gross_loss'
  ) {
    return Number.POSITIVE_INFINITY;
  }
  const value = metrics[metric];
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
};

const compareNumbers = (
  actual: number | null,
  expected: number,
  comparison: CoreResearchThresholdRule['comparison'],
) => {
  if (actual == null) return false;
  if (comparison === 'gt') return actual > expected;
  if (comparison === 'gte') return actual >= expected;
  if (comparison === 'lt') return actual < expected;
  return actual <= expected;
};

export const evaluateCoreResearchThresholdRule = (params: {
  control: CoreResearchMetrics;
  candidate: CoreResearchMetrics;
  rule: CoreResearchThresholdRule;
}) => {
  const actual = getCoreResearchMetricValue(
    params.candidate,
    params.rule.metric,
  );
  const control = getCoreResearchMetricValue(
    params.control,
    params.rule.metric,
  );
  const offset = params.rule.value ?? 0;
  const expected =
    params.rule.relativeToControl === false
      ? offset
      : control == null
        ? Number.NaN
        : control + offset;
  return {
    passed:
      !Number.isNaN(expected) &&
      compareNumbers(actual, expected, params.rule.comparison),
    actual,
    control,
    expected,
  };
};
