import {
  evaluateCoreResearchThresholdRule,
  getCoreResearchMetricValue,
} from '../rules';
import { summarizeCoreResearchTrades } from '../metrics';
import { makeTrade } from '../__fixtures__/fixtures';

describe('core research threshold rules', () => {
  it('treats a positive cohort without gross losses as infinite profit factor', () => {
    const control = summarizeCoreResearchTrades(
      [makeTrade({ netProfit: 5 })],
      1,
    );
    const candidate = summarizeCoreResearchTrades(
      [makeTrade({ netProfit: 6 })],
      1,
    );

    expect(getCoreResearchMetricValue(candidate, 'profitFactor')).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(
      evaluateCoreResearchThresholdRule({
        control,
        candidate,
        rule: {
          metric: 'profitFactor',
          comparison: 'gte',
          relativeToControl: true,
        },
      }),
    ).toMatchObject({ passed: true, actual: Infinity, expected: Infinity });
  });

  it('evaluates absolute and relative comparisons through one semantic seam', () => {
    const control = summarizeCoreResearchTrades(
      [makeTrade({ netProfit: 4 })],
      1,
    );
    const candidate = summarizeCoreResearchTrades(
      [makeTrade({ netProfit: 7 })],
      1,
    );

    expect(
      evaluateCoreResearchThresholdRule({
        control,
        candidate,
        rule: {
          metric: 'pnl',
          comparison: 'gt',
          value: 2,
          relativeToControl: true,
        },
      }),
    ).toMatchObject({ passed: true, actual: 7, control: 4, expected: 6 });
    expect(
      evaluateCoreResearchThresholdRule({
        control,
        candidate,
        rule: {
          metric: 'pnl',
          comparison: 'lte',
          value: 6,
          relativeToControl: false,
        },
      }),
    ).toMatchObject({ passed: false, actual: 7, expected: 6 });
  });

  it('fails unavailable metrics instead of coercing them to zero', () => {
    const empty = summarizeCoreResearchTrades([], 1);
    expect(
      evaluateCoreResearchThresholdRule({
        control: empty,
        candidate: empty,
        rule: {
          metric: 'pnlPerTrade',
          comparison: 'gte',
          value: 0,
          relativeToControl: false,
        },
      }),
    ).toMatchObject({ passed: false, actual: null });
  });
});
