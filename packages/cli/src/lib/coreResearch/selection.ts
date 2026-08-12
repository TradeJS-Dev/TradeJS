import { evaluateCoreResearchThresholdRule } from './rules';
import type {
  CoreResearchComparison,
  CoreResearchSpec,
  CoreResearchVariantAnalysis,
} from './types';

export const applyCoreResearchRobustnessGuardrails = (params: {
  spec: CoreResearchSpec;
  analyses: CoreResearchVariantAnalysis[];
  comparisons: CoreResearchComparison[];
}) => {
  const { spec, analyses, comparisons } = params;
  const byVariantId = new Map(
    analyses.map((analysis) => [analysis.variant.id, analysis]),
  );
  const maximumHolmPValue = spec.selection.maximumHolmPValue;

  for (const comparison of comparisons) {
    if (maximumHolmPValue != null) {
      const adjusted = comparison.bootstrap.holmAdjustedPValue;
      if (adjusted == null || adjusted > maximumHolmPValue) {
        comparison.selection.passed = false;
        comparison.selection.targetPassed = false;
        comparison.selection.warnings.push(
          `Holm-adjusted p-value ${adjusted ?? 'n/a'} exceeds ${maximumHolmPValue}`,
        );
      }
    }

    const controlAnalysis = byVariantId.get(comparison.controlId);
    const candidateAnalysis = byVariantId.get(comparison.candidateId);
    const required = [
      controlAnalysis?.reconciliation,
      candidateAnalysis?.reconciliation,
    ].filter((value) => value?.runId);
    if (required.some((value) => value?.status !== 'match')) {
      comparison.selection.passed = false;
      comparison.selection.aggregatePassed = false;
      comparison.selection.warnings.push(
        'Run-scoped Redis/export reconciliation failed; selection is invalid.',
      );
    }

    if (!candidateAnalysis || !controlAnalysis) continue;
    const target = spec.hypothesis.target;
    const underpoweredFolds = candidateAnalysis.folds.filter(
      (window) =>
        window.cohorts[target].trades < spec.robustness.minimumFoldTrades,
    );
    if (underpoweredFolds.length) {
      comparison.selection.passed = false;
      comparison.selection.targetPassed = false;
      comparison.selection.warnings.push(
        `${underpoweredFolds.length}/${candidateAnalysis.folds.length} target folds have fewer than ${spec.robustness.minimumFoldTrades} trades`,
      );
    }

    const minimumPositiveFoldPct = spec.selection.minimumPositiveFoldPct;
    if (minimumPositiveFoldPct != null) {
      const positiveFoldPct = candidateAnalysis.folds.length
        ? (candidateAnalysis.folds.filter(
            (window) => window.cohorts[target].pnl > 0,
          ).length /
            candidateAnalysis.folds.length) *
          100
        : 0;
      if (positiveFoldPct < minimumPositiveFoldPct) {
        comparison.selection.passed = false;
        comparison.selection.targetPassed = false;
        comparison.selection.warnings.push(
          `Positive target folds ${positiveFoldPct.toFixed(2)}% < ${minimumPositiveFoldPct}%`,
        );
      }
    }

    for (const candidateWindow of candidateAnalysis.terminal) {
      const controlWindow = controlAnalysis.terminal.find(
        (window) => window.label === candidateWindow.label,
      );
      if (!controlWindow) continue;
      const minimumTerminalTrades = Math.ceil(
        candidateWindow.periodDays * spec.selection.minimumCadencePerDay,
      );
      if (candidateWindow.cohorts[target].trades < minimumTerminalTrades) {
        comparison.selection.passed = false;
        comparison.selection.targetPassed = false;
        comparison.selection.warnings.push(
          `${candidateWindow.label} ${target} has fewer than ${minimumTerminalTrades} trades`,
        );
      }
      for (const rule of spec.selection.terminalRules ?? []) {
        if (
          !evaluateCoreResearchThresholdRule({
            control: controlWindow.cohorts[target],
            candidate: candidateWindow.cohorts[target],
            rule,
          }).passed
        ) {
          comparison.selection.passed = false;
          comparison.selection.targetPassed = false;
          comparison.selection.warnings.push(
            `${candidateWindow.label} ${target}.${rule.metric} failed`,
          );
        }
      }
    }

    for (const candidateStress of candidateAnalysis.costStress) {
      const controlStress = controlAnalysis.costStress.find(
        (stress) =>
          stress.extraRoundTripBps === candidateStress.extraRoundTripBps,
      );
      if (!controlStress) continue;
      for (const rule of spec.selection.costStressRules ?? []) {
        if (
          !evaluateCoreResearchThresholdRule({
            control: controlStress.cohorts[target],
            candidate: candidateStress.cohorts[target],
            rule,
          }).passed
        ) {
          comparison.selection.passed = false;
          comparison.selection.targetPassed = false;
          comparison.selection.warnings.push(
            `cost+${candidateStress.extraRoundTripBps}bps ${target}.${rule.metric} failed`,
          );
        }
      }
    }
  }
};
