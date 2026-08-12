import { CORE_RESEARCH_COHORTS, summarizeCoreResearchTrades } from './metrics';
import { evaluateCoreResearchThresholdRule } from './rules';
import { calendarClusterBootstrap } from './statistics';
import type {
  CoreResearchCohort,
  CoreResearchComparison,
  CoreResearchMetrics,
  CoreResearchSelectionResult,
  CoreResearchSpec,
  CoreResearchThresholdRule,
  CoreResearchTrade,
  CoreResearchVariant,
} from './types';

type VariantTrades = {
  variant: CoreResearchVariant;
  trades: CoreResearchTrade[];
};

const selectCohort = (
  trades: CoreResearchTrade[],
  cohort: CoreResearchCohort,
) =>
  cohort === 'ALL'
    ? trades
    : trades.filter((trade) => trade.direction === cohort);

const groupBySetup = (trades: CoreResearchTrade[]) => {
  const grouped = new Map<string, CoreResearchTrade[]>();
  for (const trade of trades) {
    const bucket = grouped.get(trade.setupIdentity) ?? [];
    bucket.push(trade);
    grouped.set(trade.setupIdentity, bucket);
  }
  for (const bucket of grouped.values()) {
    bucket.sort(
      (left, right) =>
        left.signalTimestamp - right.signalTimestamp ||
        left.entryTimestamp - right.entryTimestamp ||
        left.exitTimestamp - right.exitTimestamp,
    );
  }
  return grouped;
};

const evaluateRules = (params: {
  scope: CoreResearchCohort;
  control: CoreResearchMetrics;
  candidate: CoreResearchMetrics;
  rules: CoreResearchThresholdRule[];
  failedRules: CoreResearchSelectionResult['failedRules'];
}) => {
  let passed = true;
  for (const rule of params.rules) {
    const evaluation = evaluateCoreResearchThresholdRule({
      control: params.control,
      candidate: params.candidate,
      rule,
    });
    if (!evaluation.passed) {
      passed = false;
      params.failedRules.push({
        scope: params.scope,
        metric: rule.metric,
        expected:
          `${rule.comparison} ${rule.relativeToControl === false ? '' : 'control '}${rule.value ?? 0}`.trim(),
        actual: evaluation.actual,
        control: evaluation.control,
      });
    }
  }
  return passed;
};

const evaluateSelection = (params: {
  spec: CoreResearchSpec;
  cohorts: CoreResearchComparison['cohorts'];
}): CoreResearchSelectionResult => {
  const { spec, cohorts } = params;
  const target = spec.hypothesis.target;
  const nonTarget =
    target === 'LONG' ? 'SHORT' : target === 'SHORT' ? 'LONG' : null;
  const failedRules: CoreResearchSelectionResult['failedRules'] = [];
  const warnings: string[] = [];
  const targetMetrics = cohorts[target].candidate;
  let targetPassed = true;
  if (targetMetrics.trades < spec.selection.minimumTrades) {
    targetPassed = false;
    failedRules.push({
      scope: target,
      metric: 'trades',
      expected: `>= ${spec.selection.minimumTrades}`,
      actual: targetMetrics.trades,
      control: cohorts[target].control.trades,
    });
  }
  if (
    targetMetrics.cadencePerDay == null ||
    targetMetrics.cadencePerDay < spec.selection.minimumCadencePerDay
  ) {
    targetPassed = false;
    failedRules.push({
      scope: target,
      metric: 'cadencePerDay',
      expected: `>= ${spec.selection.minimumCadencePerDay}`,
      actual: targetMetrics.cadencePerDay,
      control: cohorts[target].control.cadencePerDay,
    });
  }
  targetPassed =
    evaluateRules({
      scope: target,
      control: cohorts[target].control,
      candidate: targetMetrics,
      rules: spec.selection.targetRules,
      failedRules,
    }) && targetPassed;
  let aggregatePassed = evaluateRules({
    scope: 'ALL',
    control: cohorts.ALL.control,
    candidate: cohorts.ALL.candidate,
    rules: spec.selection.aggregateRules,
    failedRules,
  });
  const maxDdRegression = spec.selection.maximumPortfolioDrawdownRegressionPct;
  if (maxDdRegression != null) {
    const controlDd = cohorts.ALL.control.realizedMaxDrawdown;
    const allowed = controlDd * (1 + maxDdRegression / 100);
    if (cohorts.ALL.candidate.realizedMaxDrawdown > allowed) {
      aggregatePassed = false;
      failedRules.push({
        scope: 'ALL',
        metric: 'realizedMaxDrawdown',
        expected: `<= control + ${maxDdRegression}%`,
        actual: cohorts.ALL.candidate.realizedMaxDrawdown,
        control: controlDd,
      });
    }
  }
  const nonTargetPassed = nonTarget
    ? evaluateRules({
        scope: nonTarget,
        control: cohorts[nonTarget].control,
        candidate: cohorts[nonTarget].candidate,
        rules: spec.selection.nonTargetRules,
        failedRules,
      })
    : true;
  if (target !== 'ALL') {
    warnings.push(
      `Direction-targeted verdict uses ${target}; aggregate portfolio guardrails remain independent.`,
    );
  }
  return {
    target,
    passed: targetPassed && aggregatePassed && nonTargetPassed,
    targetPassed,
    aggregatePassed,
    nonTargetPassed,
    failedRules,
    warnings,
  };
};

export const compareCoreResearchVariants = (params: {
  spec: CoreResearchSpec;
  control: VariantTrades;
  candidate: VariantTrades;
}): CoreResearchComparison => {
  const { spec, control, candidate } = params;
  const controlGrouped = groupBySetup(control.trades);
  const candidateGrouped = groupBySetup(candidate.trades);
  const setupKeys = new Set([
    ...controlGrouped.keys(),
    ...candidateGrouped.keys(),
  ]);
  const matchedPairs: CoreResearchComparison['matchedPairs'] = [];
  const controlOnly: CoreResearchTrade[] = [];
  const candidateOnly: CoreResearchTrade[] = [];
  for (const setupIdentity of [...setupKeys].sort()) {
    const controlBucket = controlGrouped.get(setupIdentity) ?? [];
    const candidateBucket = candidateGrouped.get(setupIdentity) ?? [];
    const matched = Math.min(controlBucket.length, candidateBucket.length);
    for (let index = 0; index < matched; index += 1) {
      const controlTrade = controlBucket[index];
      const candidateTrade = candidateBucket[index];
      matchedPairs.push({
        identity: `${setupIdentity}#${index + 1}`,
        control: controlTrade,
        candidate: candidateTrade,
        pnlDelta: candidateTrade.netProfit - controlTrade.netProfit,
        exitReasonChanged:
          candidateTrade.exitReason !== controlTrade.exitReason,
        entryTimestampDeltaMs:
          candidateTrade.entryTimestamp - controlTrade.entryTimestamp,
        exitTimestampDeltaMs:
          candidateTrade.exitTimestamp - controlTrade.exitTimestamp,
      });
    }
    controlOnly.push(...controlBucket.slice(matched));
    candidateOnly.push(...candidateBucket.slice(matched));
  }
  const periodDays =
    (spec.window.end - spec.window.start) / (24 * 60 * 60 * 1000);
  const cohorts = Object.fromEntries(
    CORE_RESEARCH_COHORTS.map((cohort) => {
      const controlMetrics = summarizeCoreResearchTrades(
        selectCohort(control.trades, cohort),
        periodDays,
      );
      const candidateMetrics = summarizeCoreResearchTrades(
        selectCohort(candidate.trades, cohort),
        periodDays,
      );
      const matched = matchedPairs.filter(
        (pair) => cohort === 'ALL' || pair.control.direction === cohort,
      );
      return [
        cohort,
        {
          control: controlMetrics,
          candidate: candidateMetrics,
          delta: {
            pnl: candidateMetrics.pnl - controlMetrics.pnl,
            pnlPerTrade:
              candidateMetrics.pnlPerTrade == null ||
              controlMetrics.pnlPerTrade == null
                ? null
                : candidateMetrics.pnlPerTrade - controlMetrics.pnlPerTrade,
            profitFactor:
              candidateMetrics.profitFactor == null ||
              controlMetrics.profitFactor == null
                ? null
                : candidateMetrics.profitFactor - controlMetrics.profitFactor,
            winRatePct:
              candidateMetrics.winRatePct == null ||
              controlMetrics.winRatePct == null
                ? null
                : candidateMetrics.winRatePct - controlMetrics.winRatePct,
            realizedMaxDrawdown:
              candidateMetrics.realizedMaxDrawdown -
              controlMetrics.realizedMaxDrawdown,
            cadencePerDay:
              candidateMetrics.cadencePerDay == null ||
              controlMetrics.cadencePerDay == null
                ? null
                : candidateMetrics.cadencePerDay - controlMetrics.cadencePerDay,
          },
          matchedPnlDelta: matched.reduce(
            (sum, pair) => sum + pair.pnlDelta,
            0,
          ),
          controlOnlyPnl: selectCohort(controlOnly, cohort).reduce(
            (sum, trade) => sum + trade.netProfit,
            0,
          ),
          candidateOnlyPnl: selectCohort(candidateOnly, cohort).reduce(
            (sum, trade) => sum + trade.netProfit,
            0,
          ),
        },
      ];
    }),
  ) as CoreResearchComparison['cohorts'];
  return {
    controlId: control.variant.id,
    candidateId: candidate.variant.id,
    matched: matchedPairs.length,
    controlOnly: controlOnly.length,
    candidateOnly: candidateOnly.length,
    matchedIdentityPctOfControl:
      control.trades.length > 0
        ? (matchedPairs.length / control.trades.length) * 100
        : null,
    matchedPairs,
    cohorts,
    bootstrap: calendarClusterBootstrap({
      control: control.trades,
      candidate: candidate.trades,
      clusterDays: spec.robustness.clusterDays,
      iterations: spec.robustness.bootstrapIterations,
      confidenceLevel: spec.robustness.confidenceLevel,
      seed: `${spec.researchId}:${candidate.variant.id}`,
      start: spec.window.start,
      end: spec.window.end,
    }),
    selection: evaluateSelection({ spec, cohorts }),
  };
};
