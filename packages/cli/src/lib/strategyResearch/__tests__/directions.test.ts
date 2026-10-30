/** @jest-environment node */
import { selectResearchDirections } from '../directions';
import { createStrategyResearchSpec } from '../specification';
import { sampleResearchCurve, researchLineChart } from '../charts';
import {
  makeSpec,
  makeTrade,
  START,
  END,
} from '../../coreResearch/__fixtures__/fixtures';
import type { ResearchComposition, ResearchDataset } from '../types';

const fixture = (longProfit: number, shortProfit: number) => {
  const spec = createStrategyResearchSpec(makeSpec());
  spec.testSince = START + (END - START) * 0.6;
  spec.selection = {
    ...spec.selection,
    minimumEvents: 25,
    maximumSymbolShare: 1,
    maximumEventShare: 1,
    minimumCadencePerDay: 0,
    maximumLossStreak: 1000,
    maximumDrawdown: 10000,
  };
  const trades = Array.from({ length: 80 }, (_, index) =>
    (['LONG', 'SHORT'] as const).map((direction) =>
      makeTrade({
        signalId: `${index}-${direction}`,
        direction,
        symbol: 'AAAUSDT',
        signalTimestamp: START + index * 60_000,
        entryTimestamp: START + index * 60_000 + 1,
        exitTimestamp: START + index * 60_000 + 100,
        netProfit: direction === 'LONG' ? longProfit : shortProfit,
      }),
    ),
  ).flat();
  const dataset: ResearchDataset = {
    variant: spec.core.variants[0],
    trades,
    rows: [],
    samples: [],
    contextCoverage: {},
    purgedLabels: 0,
  };
  const composition: ResearchComposition = {
    id: 'baseline',
    coreId: 'control',
    role: 'baseline',
    policy: {
      schema: 'tradejs-research-entry-policy/v1',
      strategy: spec.core.strategy,
      mode: 'current-gate',
      minQuality: 4,
      rules: { LONG: null, SHORT: null },
    },
  };
  return { spec, dataset, composition };
};

it.each([
  [3, -2, ['LONG']],
  [-2, 3, ['SHORT']],
  [3, 3, ['LONG', 'SHORT']],
  [-2, -2, []],
])(
  'selects directions from supported DEV PnL %s / %s',
  (longProfit, shortProfit, expected) => {
    const f = fixture(longProfit as number, shortProfit as number);
    const result = selectResearchDirections(f.spec, f.dataset, f.composition);
    expect(result.composition.policy.directions).toEqual(expected);
    expect(result.selection.method).toBe('existing-dev-trades');
    expect(result.composition.id).toBe(
      expected.length === 2 ? 'baseline' : 'direction-baseline',
    );
  },
);

it('ignores TEST outcomes and immature DEV labels, and does not enable a blocked or sparse side', () => {
  const f = fixture(3, -2);
  const before = selectResearchDirections(f.spec, f.dataset, f.composition);
  f.dataset.trades.push(
    ...Array.from({ length: 100 }, (_, index) =>
      makeTrade({
        signalId: `future-${index}`,
        direction: 'SHORT',
        netProfit: 100000,
        signalTimestamp: f.spec.testSince + index,
        exitTimestamp: f.spec.testSince + index + 100,
      }),
    ),
    makeTrade({
      signalId: 'crossing',
      direction: 'SHORT',
      netProfit: 100000,
      signalTimestamp: f.spec.testSince - 100,
      exitTimestamp: f.spec.testSince + 100,
    }),
  );
  expect(selectResearchDirections(f.spec, f.dataset, f.composition)).toEqual(
    before,
  );
  f.composition.policy.directions = ['SHORT'];
  expect(
    selectResearchDirections(f.spec, f.dataset, f.composition).composition
      .policy.directions,
  ).toEqual([]);
  f.dataset.trades = f.dataset.trades.slice(0, 2);
  delete f.composition.policy.directions;
  expect(
    selectResearchDirections(f.spec, f.dataset, f.composition).composition
      .policy.directions,
  ).toEqual([]);
});

it('keeps exact authority while bounding rendered charts and retaining extrema and endpoints', () => {
  const points: Array<[number, number]> = Array.from(
    { length: 50000 },
    (_, i) => [START + i, i === 11000 ? 9999 : i === 11100 ? -9999 : 1],
  );
  const reduced = sampleResearchCurve(points, 600);
  expect(reduced.length).toBeLessThanOrEqual(600);
  expect(reduced).toContainEqual(points[11000]);
  expect(reduced).toContainEqual(points[11100]);
  expect(reduced[0]).toEqual(points[0]);
  expect(reduced.at(-1)).toEqual(points.at(-1));
  expect(points).toHaveLength(50000);
  expect(
    researchLineChart(
      [{ label: '<img>', points, color: '#265d97' }],
      '<script>',
    ),
  ).not.toContain('<script>');
  expect(researchLineChart([], 'Empty')).toContain('нет наблюдений');
});

it('uses a supported single side when their combined native-trade projection exceeds capacity', () => {
  const f = fixture(3, 3);
  f.spec.portfolio.maxConcurrentPositions = 1;
  const result = selectResearchDirections(f.spec, f.dataset, f.composition);
  expect(result.selection.sides.LONG.eligible).toBe(true);
  expect(result.selection.sides.SHORT.eligible).toBe(true);
  expect(result.composition.policy.directions).toEqual(['LONG']);
  expect(result.selection.reason).toContain('Совместный режим отклонён');
});
