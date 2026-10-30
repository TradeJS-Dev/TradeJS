/** @jest-environment node */
import { freezeJevResearchPair, compareJevResearch } from '../jevComparison';
import { policyVariant, createStrategyResearchSpec } from '../specification';
import { evaluateResearchComposition } from '../evaluation';
import { discoverResearchGate } from '../gates';
import {
  makeSpec,
  makeTrade,
  START,
  END,
} from '../../coreResearch/__fixtures__/fixtures';
import { sha256Json } from '../../coreResearch/io';
import type { ResearchComposition, ResearchDataset } from '../types';

const fixture = (withProfit = 4, withoutProfit = 2) => {
  const spec = createStrategyResearchSpec(makeSpec());
  spec.testSince = START + (END - START) * 0.6;
  spec.selection = {
    ...spec.selection,
    minimumEvents: 25,
    maximumSymbolShare: 1,
    maximumEventShare: 1,
    maximumDrawdown: 10000,
    minimumCadencePerDay: 0,
    maximumLossStreak: 1000,
  };
  const core = spec.core.variants[0];
  core.resolvedConfig.JEV = {
    source: 'local',
    mode: 'observe',
    modelFile: 'fixture-model.json',
    modelSha256: 'f'.repeat(64),
  };
  core.configSha256 = sha256Json(core.resolvedConfig);
  const withArm: ResearchComposition = {
    id: 'with',
    coreId: core.id,
    role: 'candidate',
    jev: 'enabled',
    jevPairId: 'own-control',
    policy: {
      schema: 'tradejs-research-entry-policy/v1',
      strategy: spec.core.strategy,
      mode: 'rules',
      minQuality: 4,
      directions: ['LONG'],
      rules: { LONG: [], SHORT: null },
    },
  };
  const withoutArm: ResearchComposition = {
    ...withArm,
    id: 'without',
    jev: 'disabled',
  };
  const dataset = (
    arm: ResearchComposition,
    profit: number,
  ): ResearchDataset => {
    const trades = Array.from({ length: 80 }, (_, index) =>
      makeTrade({
        signalId: `event-${index}`,
        symbol: 'AAAUSDT',
        direction: 'LONG',
        signalTimestamp: spec.testSince + index * 3_600_000,
        entryTimestamp: spec.testSince + index * 3_600_000 + 1,
        exitTimestamp: spec.testSince + index * 3_600_000 + 100,
        netProfit: profit,
      }),
    );
    return {
      variant: policyVariant(spec, arm.coreId, arm.policy, arm.id, arm.jev),
      trades,
      rows: trades.map((trade): ResearchDataset['rows'][number] => ({
        signalId: trade.signalId,
        timestamp: trade.signalTimestamp,
        exitTimestamp: trade.exitTimestamp,
        direction: trade.direction,
        symbol: trade.symbol,
        profit,
        profitableTrade: profit > 0,
        quality: 4,
        aiApproved: true,
        features:
          arm.jev === 'enabled'
            ? { 'additionalIndicators.jev.scores.signalStrength': 8 }
            : {},
      })),
      samples: [],
      contextCoverage: {},
      purgedLabels: 0,
    };
  };
  const withData = dataset(withArm, withProfit),
    withoutData = dataset(withoutArm, withoutProfit);
  const evaluations = [
    evaluateResearchComposition({ spec, dataset: withData, ...withArm }),
    evaluateResearchComposition({ spec, dataset: withoutData, ...withoutArm }),
  ];
  const compositions = [withArm, withoutArm];
  const pair = freezeJevResearchPair(compositions, evaluations, 'with')!;
  const datasets = new Map([
    ['with', withData],
    ['without', withoutData],
  ]);
  return {
    spec,
    compositions,
    pair,
    evaluations,
    datasets,
    withData,
    withoutData,
  };
};

it.each([
  [4, 2, 'improved'],
  [2, 4, 'worse'],
  [2, 2, 'inconclusive'],
])(
  'compares matched native TEST economics %s / %s as %s',
  (withProfit, withoutProfit, status) => {
    const f = fixture(Number(withProfit), Number(withoutProfit));
    const result = compareJevResearch(
      f.spec,
      f.pair,
      f.evaluations,
      f.datasets,
      [],
      f.compositions,
      false,
    );
    expect(result.status).toBe(status);
    expect(result.pnlDelta).toBe(
      (Number(withProfit) - Number(withoutProfit)) * 80,
    );
    expect(result.pair?.preferredOnDev).toBe('enabled');
    expect(result.dailyPnlDeltaInterval95).not.toBeNull();
    expect(result.withJev?.cohorts.SHORT.trades).toBe(0);
  },
);

it('does not claim benefit without Jev scores, support or a configured model', () => {
  const f = fixture();
  f.withData.rows = [];
  expect(
    compareJevResearch(
      f.spec,
      f.pair,
      f.evaluations,
      f.datasets,
      [],
      f.compositions,
      true,
    ),
  ).toMatchObject({ status: 'inconclusive', evidence: 'retrospective' });
  expect(
    compareJevResearch(f.spec, null, [], new Map(), [], [], true).status,
  ).toBe('not-configured');
});

it('rejects comparison arms with different cores, directions or non-Jev config', () => {
  const f = fixture();
  const changed = structuredClone(f.pair);
  changed.withoutJev.policy.directions = ['SHORT'];
  expect(() =>
    compareJevResearch(
      f.spec,
      changed,
      f.evaluations,
      f.datasets,
      [],
      f.compositions,
      false,
    ),
  ).toThrow('same core');
  f.withoutData.variant.resolvedConfig.MAX_LOSS_VALUE = 99;
  expect(() =>
    compareJevResearch(
      f.spec,
      f.pair,
      f.evaluations,
      f.datasets,
      [],
      f.compositions,
      false,
    ),
  ).toThrow('non-Jev runtime');
});

it('keeps the original incumbent unchanged when the selected no-Jev arm has one direction', () => {
  const f = fixture();
  const baseline = {
    ...f.compositions[0],
    id: 'baseline',
    role: 'baseline' as const,
    policy: { ...f.compositions[0].policy, directions: undefined },
  };
  const pair = freezeJevResearchPair(
    [baseline, f.compositions[1]],
    [],
    f.compositions[1].id,
  )!;
  expect(pair.withJev.id).toBe('jev-compare-baseline');
  expect(pair.withJev.policy.directions).toEqual(['LONG']);
  expect(baseline.policy.directions).toBeUndefined();
  expect(pair.preferredOnDev).toBe('disabled');
});

it('removes Jev before discovery without mutating the original feature rows or exceeding the search budget', () => {
  const f = fixture();
  f.spec.testSince = END;
  f.withData.rows = Array.from({ length: 240 }, (_, index) => ({
    timestamp: START + index * 60_000,
    exitTimestamp: START + index * 60_000 + 100,
    direction: 'LONG' as const,
    symbol: index % 2 ? 'AAAUSDT' : 'BBBUSDT',
    profit: index % 2 ? 4 : -1,
    profitableTrade: index % 2 === 1,
    quality: 4,
    aiApproved: false,
    features: {
      'additionalIndicators.jev.scores.signalStrength': index % 2 ? 9 : 1,
    },
  }));
  const original = structuredClone(f.withData.rows);
  const withGate = discoverResearchGate(f.spec, f.withData, 'enabled');
  const withoutGate = discoverResearchGate(f.spec, f.withData, 'disabled');
  expect(
    withGate.policy.rules.LONG?.some((rule) => rule.path.includes('.jev.')),
  ).toBe(true);
  expect(withoutGate.policy.rules.LONG).toBeNull();
  expect(f.withData.rows).toEqual(original);
  expect(() =>
    policyVariant(
      f.spec,
      f.spec.core.variants[0].id,
      withGate.policy,
      'invalid-without',
      'disabled',
    ),
  ).toThrow('cannot depend');
  expect(
    withGate.discovery.LONG.stats.combinationsEvaluated +
      withoutGate.discovery.LONG.stats.combinationsEvaluated,
  ).toBeLessThanOrEqual(f.spec.budget.maxCombinations);
});
