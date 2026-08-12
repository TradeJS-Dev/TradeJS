import { compareCoreResearchVariants } from '../comparison';
import {
  makeSpec,
  makeTrade,
  makeVariant,
  START,
} from '../__fixtures__/fixtures';

describe('core research control/candidate comparison', () => {
  it('matches repeated causal setups by deterministic ordinal and attributes added/removed PnL', () => {
    const spec = makeSpec({
      hypothesis: {
        family: 'matching',
        claim: 'Improve LONG.',
        mechanism: 'Fixture matching.',
        target: 'LONG',
      },
      selection: {
        minimumTrades: 1,
        minimumCadencePerDay: 0,
        targetRules: [{ metric: 'pnl', comparison: 'gt' }],
        aggregateRules: [{ metric: 'pnl', comparison: 'gt' }],
        nonTargetRules: [{ metric: 'pnl', comparison: 'gte' }],
      },
    });
    const controlVariant = makeVariant({ id: 'control', role: 'control' });
    const candidateVariant = makeVariant({
      id: 'candidate',
      role: 'candidate',
    });
    const result = compareCoreResearchVariants({
      spec,
      control: {
        variant: controlVariant,
        trades: [
          makeTrade({
            signalId: 'control-2',
            setupIdentity: 'repeat',
            signalTimestamp: START + 2,
            netProfit: -4,
          }),
          makeTrade({
            signalId: 'control-1',
            setupIdentity: 'repeat',
            signalTimestamp: START + 1,
            netProfit: 2,
          }),
          makeTrade({
            signalId: 'removed',
            setupIdentity: 'removed',
            direction: 'SHORT',
            netProfit: -3,
          }),
        ],
      },
      candidate: {
        variant: candidateVariant,
        trades: [
          makeTrade({
            signalId: 'candidate-1',
            setupIdentity: 'repeat',
            signalTimestamp: START + 1,
            netProfit: 5,
          }),
          makeTrade({
            signalId: 'candidate-2',
            setupIdentity: 'repeat',
            signalTimestamp: START + 2,
            netProfit: 1,
          }),
          makeTrade({
            signalId: 'added',
            setupIdentity: 'added',
            direction: 'SHORT',
            netProfit: 4,
          }),
        ],
      },
    });

    expect(
      result.matchedPairs.map((pair) => [pair.identity, pair.pnlDelta]),
    ).toEqual([
      ['repeat#1', 3],
      ['repeat#2', 5],
    ]);
    expect(result).toMatchObject({
      matched: 2,
      controlOnly: 1,
      candidateOnly: 1,
    });
    expect(result.cohorts.ALL).toMatchObject({
      matchedPnlDelta: 8,
      controlOnlyPnl: -3,
      candidateOnlyPnl: 4,
    });
    expect(result.cohorts.SHORT).toMatchObject({
      matchedPnlDelta: 0,
      controlOnlyPnl: -3,
      candidateOnlyPnl: 4,
    });
  });

  it('keeps target, non-target, and aggregate verdicts independent', () => {
    const spec = makeSpec({
      hypothesis: {
        family: 'directional',
        claim: 'Improve LONG without harming SHORT.',
        mechanism: 'Direction-specific causal change.',
        target: 'LONG',
      },
      selection: {
        minimumTrades: 1,
        minimumCadencePerDay: 0,
        targetRules: [{ metric: 'pnl', comparison: 'gt' }],
        aggregateRules: [{ metric: 'pnl', comparison: 'gt' }],
        nonTargetRules: [{ metric: 'pnl', comparison: 'gte' }],
      },
    });
    const comparison = compareCoreResearchVariants({
      spec,
      control: {
        variant: makeVariant({ id: 'control', role: 'control' }),
        trades: [
          makeTrade({ setupIdentity: 'long', netProfit: -10 }),
          makeTrade({
            setupIdentity: 'short',
            signalId: 'short-control',
            direction: 'SHORT',
            netProfit: 10,
          }),
        ],
      },
      candidate: {
        variant: makeVariant({ id: 'candidate', role: 'candidate' }),
        trades: [
          makeTrade({ setupIdentity: 'long', netProfit: 5 }),
          makeTrade({
            setupIdentity: 'short',
            signalId: 'short-candidate',
            direction: 'SHORT',
            netProfit: -20,
          }),
        ],
      },
    });

    expect(comparison.selection).toMatchObject({
      passed: false,
      targetPassed: true,
      aggregatePassed: false,
      nonTargetPassed: false,
    });
    expect(comparison.selection.warnings).toContain(
      'Direction-targeted verdict uses LONG; aggregate portfolio guardrails remain independent.',
    );
  });

  it('enforces target trade/cadence floors and portfolio drawdown regression', () => {
    const spec = makeSpec({
      hypothesis: {
        family: 'guardrails',
        claim: 'Improve all trades.',
        mechanism: 'Fixture guardrails.',
        target: 'ALL',
      },
      selection: {
        minimumTrades: 3,
        minimumCadencePerDay: 0.4,
        targetRules: [],
        aggregateRules: [],
        nonTargetRules: [],
        maximumPortfolioDrawdownRegressionPct: 0,
      },
    });
    const comparison = compareCoreResearchVariants({
      spec,
      control: {
        variant: makeVariant({ id: 'control', role: 'control' }),
        trades: [
          makeTrade({ netProfit: 10 }),
          makeTrade({ signalId: 'c2', netProfit: -5 }),
        ],
      },
      candidate: {
        variant: makeVariant({ id: 'candidate', role: 'candidate' }),
        trades: [
          makeTrade({ netProfit: 10 }),
          makeTrade({ signalId: 'x2', netProfit: -8 }),
        ],
      },
    });

    expect(comparison.selection).toMatchObject({
      passed: false,
      targetPassed: false,
      aggregatePassed: false,
    });
    expect(comparison.selection.failedRules.map((rule) => rule.metric)).toEqual(
      expect.arrayContaining([
        'trades',
        'cadencePerDay',
        'realizedMaxDrawdown',
      ]),
    );
  });
});
