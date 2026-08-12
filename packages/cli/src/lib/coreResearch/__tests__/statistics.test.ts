import {
  applyHolmCorrection,
  calendarClusterBootstrap,
  deflatedSharpeDiagnostic,
  probabilityOfBacktestOverfitting,
} from '../statistics';
import { DAY_MS, makeTrade, START } from '../__fixtures__/fixtures';

describe('core research statistical guardrails', () => {
  it('returns an explicit unavailable bootstrap for an empty experiment', () => {
    expect(
      calendarClusterBootstrap({
        control: [],
        candidate: [],
        clusterDays: 7,
        iterations: 100,
        confidenceLevel: 0.95,
        seed: 'empty',
      }),
    ).toEqual({
      method: 'calendar-cluster-bootstrap',
      clusterDays: 7,
      iterations: 100,
      confidenceLevel: 0.95,
      observedMeanPnlDelta: null,
      confidenceInterval: null,
      probabilityPositive: null,
      oneSidedPValue: null,
      holmAdjustedPValue: null,
    });
  });

  it('is deterministic by seed and resamples calendar clusters rather than trade rows', () => {
    const control = [
      makeTrade({ signalId: 'c1', exitTimestamp: START, netProfit: 1 }),
      makeTrade({ signalId: 'c2', exitTimestamp: START + 1, netProfit: 2 }),
      makeTrade({
        signalId: 'c3',
        exitTimestamp: START + DAY_MS,
        netProfit: 3,
      }),
    ];
    const candidate = [
      makeTrade({ signalId: 'x1', exitTimestamp: START, netProfit: 4 }),
      makeTrade({ signalId: 'x2', exitTimestamp: START + 1, netProfit: 5 }),
      makeTrade({
        signalId: 'x3',
        exitTimestamp: START + DAY_MS,
        netProfit: 4,
      }),
    ];
    const input = {
      control,
      candidate,
      clusterDays: 1,
      iterations: 400,
      confidenceLevel: 0.9,
      seed: 'fixed',
      start: START,
      end: START + 2 * DAY_MS,
    };
    const first = calendarClusterBootstrap(input);
    const second = calendarClusterBootstrap(input);
    expect(first).toEqual(second);
    // Day deltas are (9-3)=6 and (4-3)=1, so the observed cluster mean is 3.5.
    expect(first.observedMeanPnlDelta).toBe(3.5);
    expect(first.probabilityPositive).toBe(1);
    expect(first.confidenceInterval?.[0]).toBeGreaterThan(0);
  });

  it('includes zero-activity calendar clusters from the immutable window', () => {
    const result = calendarClusterBootstrap({
      control: [],
      candidate: [makeTrade({ netProfit: 7, exitTimestamp: START })],
      clusterDays: 1,
      iterations: 500,
      confidenceLevel: 0.9,
      seed: 'calendar-window',
      start: START,
      end: START + 7 * DAY_MS,
    });
    expect(result.observedMeanPnlDelta).toBe(1);
    expect(result.probabilityPositive).toBeLessThan(1);
  });

  it('applies monotone family-aware Holm correction without rewriting unavailable tests', () => {
    const result = (p: number | null) => ({
      method: 'calendar-cluster-bootstrap' as const,
      clusterDays: 1,
      iterations: 100,
      confidenceLevel: 0.95,
      observedMeanPnlDelta: 1,
      confidenceInterval: [0, 2] as [number, number],
      probabilityPositive: p == null ? null : 1 - p,
      oneSidedPValue: p,
      holmAdjustedPValue: null,
    });
    const results = [result(0.01), result(0.03), result(null), result(0.2)];
    applyHolmCorrection(results, 5);
    expect(results[0].holmAdjustedPValue).toBeCloseTo(0.05);
    expect(results[1].holmAdjustedPValue).toBeCloseTo(0.12);
    expect(results[2].holmAdjustedPValue).toBeNull();
    expect(results[3].holmAdjustedPValue).toBeCloseTo(0.6);
  });

  it('labels deflated-Sharpe diagnostics unavailable for insufficient or constant returns', () => {
    expect(deflatedSharpeDiagnostic([1, 2], 10)).toEqual({
      periods: 2,
      observedSharpe: null,
      expectedMaximumSharpe: null,
      probabilityAboveSelectionBias: null,
    });
    expect(deflatedSharpeDiagnostic([2, 2, 2, 2], 10)).toMatchObject({
      periods: 4,
      observedSharpe: null,
    });
    const diagnostic = deflatedSharpeDiagnostic([1, 2, -1, 4, 3, 2], 3);
    expect(diagnostic.observedSharpe).toBeGreaterThan(0);
    expect(diagnostic.expectedMaximumSharpe).toBeGreaterThan(0);
    expect(diagnostic.probabilityAboveSelectionBias).toBeGreaterThanOrEqual(0);
    expect(diagnostic.probabilityAboveSelectionBias).toBeLessThanOrEqual(1);
  });

  it('returns explicit PBO availability and a bounded CSCV probability', () => {
    expect(probabilityOfBacktestOverfitting([[1, 2, 3]])).toEqual({
      method: 'CSCV',
      combinations: 0,
      probability: null,
    });
    const result = probabilityOfBacktestOverfitting([
      [5, 5, -5, -5],
      [-5, -5, 5, 5],
      [1, 1, 1, 1],
    ]);
    expect(result.combinations).toBe(6);
    expect(result.probability).toBeGreaterThanOrEqual(0);
    expect(result.probability).toBeLessThanOrEqual(1);
    expect(
      probabilityOfBacktestOverfitting([
        [1, 1, 1, 1],
        [1, 1, 1, 1],
      ]),
    ).toEqual({ method: 'CSCV', combinations: 0, probability: null });
  });
});
