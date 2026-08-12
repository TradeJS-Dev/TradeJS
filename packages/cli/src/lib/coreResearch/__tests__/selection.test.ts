import { summarizeCoreResearchWindow } from '../metrics';
import { applyCoreResearchRobustnessGuardrails } from '../selection';
import type { CoreResearchVariantAnalysis } from '../types';
import { compareCoreResearchVariants } from '../comparison';
import {
  END,
  makeSpec,
  makeTrade,
  makeVariant,
  START,
} from '../__fixtures__/fixtures';

const analysis = (params: {
  id: string;
  role: 'control' | 'candidate';
  pnl: number;
  reconciliation?: CoreResearchVariantAnalysis['reconciliation'];
}): CoreResearchVariantAnalysis => {
  const trade = makeTrade({ netProfit: params.pnl });
  const window = summarizeCoreResearchWindow({
    trades: [trade],
    label: '1d',
    start: START,
    end: END,
  });
  return {
    variant: makeVariant({ id: params.id, role: params.role }),
    files: [],
    duplicateRowsDropped: 0,
    setupIdentitySources: {
      'research.setupIdentity': 1,
      'strategy-context': 0,
      'signal-time-fallback': 0,
    },
    reconciliation: params.reconciliation ?? {
      status: 'not_requested',
      runId: null,
      manifestStatus: null,
      plannedTests: null,
      completedTests: null,
      redis: null,
      export: { trades: 1, wins: 1, losses: 0, pnl: params.pnl },
      delta: null,
      pnlTolerance: null,
      reasons: [],
    },
    full: window,
    terminal: [window],
    folds: [window, window],
    monthly: [window],
    regimes: {},
    costStress: [{ extraRoundTripBps: 10, cohorts: window.cohorts }],
    traceFunnel: { events: {}, skipCounts: {} },
    latestSignalTimeRegime: null,
    supplemental: { coldStart: {}, stress: {}, confirmation: null },
  };
};

describe('core research robustness selection module', () => {
  it('localizes reconciliation, Holm, fold, terminal, and cost failures in one verdict', () => {
    const spec = makeSpec({
      selection: {
        minimumTrades: 1,
        minimumCadencePerDay: 0.2,
        targetRules: [],
        aggregateRules: [],
        nonTargetRules: [],
        maximumHolmPValue: 0.05,
        minimumPositiveFoldPct: 100,
        terminalRules: [{ metric: 'pnl', comparison: 'gt' }],
        costStressRules: [{ metric: 'pnl', comparison: 'gt' }],
      },
      robustness: {
        bootstrapIterations: 100,
        confidenceLevel: 0.9,
        clusterDays: 1,
        minimumFoldTrades: 2,
        costStressBps: [10],
      },
    });
    const control = analysis({ id: 'control', role: 'control', pnl: 5 });
    const candidate = analysis({
      id: 'candidate',
      role: 'candidate',
      pnl: -1,
      reconciliation: {
        status: 'mismatch',
        runId: 'candidate-run',
        manifestStatus: 'completed',
        plannedTests: 2,
        completedTests: 1,
        redis: { trades: 1, wins: 0, losses: 1, pnl: -1 },
        export: { trades: 1, wins: 0, losses: 1, pnl: -1 },
        delta: { trades: 0, wins: 0, losses: 0, pnl: 0 },
        pnlTolerance: 0.01,
        reasons: ['fixture mismatch'],
      },
    });
    const comparison = compareCoreResearchVariants({
      spec,
      control: {
        variant: control.variant,
        trades: [makeTrade({ netProfit: 5 })],
      },
      candidate: {
        variant: candidate.variant,
        trades: [makeTrade({ netProfit: -1 })],
      },
    });
    comparison.bootstrap.holmAdjustedPValue = 0.2;

    applyCoreResearchRobustnessGuardrails({
      spec,
      analyses: [control, candidate],
      comparisons: [comparison],
    });

    expect(comparison.selection).toMatchObject({
      passed: false,
      targetPassed: false,
      aggregatePassed: false,
    });
    expect(comparison.selection.warnings.join('\n')).toEqual(
      expect.stringContaining('Holm-adjusted p-value'),
    );
    expect(comparison.selection.warnings.join('\n')).toEqual(
      expect.stringContaining('reconciliation failed'),
    );
    expect(comparison.selection.warnings.join('\n')).toEqual(
      expect.stringContaining('target folds have fewer'),
    );
    expect(comparison.selection.warnings.join('\n')).toEqual(
      expect.stringContaining('Positive target folds'),
    );
    expect(comparison.selection.warnings.join('\n')).toEqual(
      expect.stringContaining('1d ALL.pnl failed'),
    );
    expect(comparison.selection.warnings.join('\n')).toEqual(
      expect.stringContaining('cost+10bps ALL.pnl failed'),
    );
  });
});
