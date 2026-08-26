import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  aggregateBenchmarkDiscoveryRows,
  applyBenchmarkEventSnapshots,
  balanceCrossStrategyRows,
  buildAblationReport,
  buildCrossStrategyReport,
  buildEquitySeries,
  buildMovingAverageVariants,
  calculateMovingAverageGrid,
  buildShiftedProfitLookups,
  classifyCrossStrategyFeature,
  collectSavedCrossStrategyFeatures,
  evaluateRule,
  evaluateCrossPocket,
  ensureRuntimeBuild,
  findFrameworkRepositoryRoot,
  findSourceRepositoryRoot,
  getSourceRepositoryKind,
  loadStandaloneStrategyEntries,
  filterSharedCrossStrategyFeatures,
  formatCrossStrategyMarkdown,
  formatMarkdownReport,
  isVariantSelected,
  latestDatasetGroupsByStrategy,
  matchesPocket,
  parseCliArgs,
  parseRuleExpression,
  parseVariant,
  partitionCrossStrategyFeatures,
  resolveArtifactProjectRoot,
  splitRowsByTimestamp,
  splitRowsByTimestampBounds,
  summarizeRows,
  summarizeMovingAverageRedundancy,
} from './ai-gate-ablation.mjs';

const createGitCheckout = async (t, prefix) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  return fsp.realpath(root);
};

const preserveResearchRoots = (t) => {
  const previousSourceRoot = process.env.TRADEJS_SOURCE_REPOSITORY_ROOT;
  const previousFrameworkRoot = process.env.TRADEJS_FRAMEWORK_REPOSITORY_ROOT;
  t.after(() => {
    for (const [name, value] of [
      ['TRADEJS_SOURCE_REPOSITORY_ROOT', previousSourceRoot],
      ['TRADEJS_FRAMEWORK_REPOSITORY_ROOT', previousFrameworkRoot],
    ]) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
  });
};

test('requires an explicit TradeJS source repository', (t) => {
  preserveResearchRoots(t);
  delete process.env.TRADEJS_SOURCE_REPOSITORY_ROOT;

  assert.throws(
    () => findSourceRepositoryRoot(),
    /TRADEJS_SOURCE_REPOSITORY_ROOT is required/,
  );
});

test('separates a real standalone strategy checkout from the framework runtime checkout', async (t) => {
  preserveResearchRoots(t);
  const strategyRoot = await createGitCheckout(t, 'tradejs-strategy-source-');
  const frameworkRoot = await createGitCheckout(t, 'tradejs-framework-source-');

  await Promise.all([
    fsp.mkdir(path.join(strategyRoot, 'src'), { recursive: true }),
    fsp.mkdir(path.join(strategyRoot, 'dist'), { recursive: true }),
    fsp.mkdir(path.join(frameworkRoot, 'packages/node'), { recursive: true }),
    fsp.mkdir(path.join(frameworkRoot, 'packages/cli'), { recursive: true }),
  ]);
  await Promise.all([
    fsp.writeFile(
      path.join(strategyRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: '@tradejs/strategy-fixture',
          type: 'module',
          exports: { '.': { import: './dist/index.js' } },
        },
        null,
        2,
      )}\n`,
    ),
    fsp.writeFile(
      path.join(strategyRoot, 'src/index.ts'),
      'export const strategyEntries = [];\n',
    ),
    fsp.writeFile(
      path.join(frameworkRoot, 'package.json'),
      '{"name":"tradejs-framework-fixture","private":true}\n',
    ),
  ]);
  await fsp.writeFile(
    path.join(strategyRoot, 'dist/index.js'),
    "export const strategyEntries = [{ manifest: { name: 'FixtureStrategy' } }];\n",
  );

  process.env.TRADEJS_SOURCE_REPOSITORY_ROOT = strategyRoot;
  delete process.env.TRADEJS_FRAMEWORK_REPOSITORY_ROOT;

  assert.equal(findSourceRepositoryRoot(), strategyRoot);
  assert.equal(getSourceRepositoryKind(strategyRoot), 'strategy');
  assert.throws(
    () => findFrameworkRepositoryRoot(strategyRoot),
    /TRADEJS_FRAMEWORK_REPOSITORY_ROOT is required/,
  );

  process.env.TRADEJS_FRAMEWORK_REPOSITORY_ROOT = frameworkRoot;
  assert.equal(findFrameworkRepositoryRoot(strategyRoot), frameworkRoot);
  const loaded = await loadStandaloneStrategyEntries(strategyRoot);
  assert.equal(loaded.packageName, '@tradejs/strategy-fixture');
  assert.equal(loaded.strategyEntries[0].manifest.name, 'FixtureStrategy');
});

test('uses a framework source checkout as its own runtime root', async (t) => {
  preserveResearchRoots(t);
  const frameworkRoot = await createGitCheckout(t, 'tradejs-framework-source-');
  await Promise.all([
    fsp.writeFile(
      path.join(frameworkRoot, 'package.json'),
      '{"name":"tradejs-framework-fixture","private":true}\n',
    ),
    fsp.mkdir(path.join(frameworkRoot, 'packages/node'), { recursive: true }),
    fsp.mkdir(path.join(frameworkRoot, 'packages/cli'), { recursive: true }),
  ]);
  process.env.TRADEJS_SOURCE_REPOSITORY_ROOT = frameworkRoot;
  delete process.env.TRADEJS_FRAMEWORK_REPOSITORY_ROOT;

  assert.equal(findSourceRepositoryRoot(), frameworkRoot);
  assert.equal(getSourceRepositoryKind(frameworkRoot), 'framework');
  assert.equal(findFrameworkRepositoryRoot(frameworkRoot), frameworkRoot);
});

test('requires the public registry runtime module for plugin loading', async () => {
  const projectRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'ai-gate-runtime-build-'),
  );
  const requiredFiles = [
    'packages/node/dist/ai.mjs',
    'packages/cli/dist/lib/aiPocketSearch.js',
  ];

  for (const relativePath of requiredFiles) {
    const filePath = path.join(projectRoot, relativePath);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, '', 'utf8');
  }

  await assert.rejects(
    ensureRuntimeBuild(projectRoot, null),
    /packages\/node\/dist\/registry\.mjs/,
  );

  const registryModulePath = path.join(
    projectRoot,
    'packages/node/dist/registry.mjs',
  );
  await fsp.writeFile(registryModulePath, '', 'utf8');
  const resolved = await ensureRuntimeBuild(projectRoot, null);
  assert.equal(resolved.registryModulePath, registryModulePath);
});

test('resolves datasets and reports from PROJECT_CWD independently of source cwd', () => {
  const previousProjectCwd = process.env.PROJECT_CWD;
  process.env.PROJECT_CWD = '/workspace/tradejs-project';
  assert.equal(
    resolveArtifactProjectRoot(),
    path.resolve('/workspace/tradejs-project'),
  );
  if (previousProjectCwd == null) delete process.env.PROJECT_CWD;
  else process.env.PROJECT_CWD = previousProjectCwd;
});

test('parses repeated variants and research windows', () => {
  const options = parseCliArgs([
    '--strategy',
    'LiquidityTails',
    '--variant',
    'near-ma::filter::trend.distance <= 1.2',
    '--variant=zones::exclude::structure.activeCount == 0',
    '--terminalWindows=180,90,30,7',
    '--qualityThresholds',
    '4,5',
    '--testSplit=0.2',
    '--tuningSince=2025-01-01T00:00:00.000Z',
    '--testSince=2025-07-01T00:00:00.000Z',
    '--capacities=1,3,5',
    '--maxLossValue=0.2',
  ]);

  assert.equal(options.strategy, 'LiquidityTails');
  assert.deepEqual(options.variants, [
    'near-ma::filter::trend.distance <= 1.2',
    'zones::exclude::structure.activeCount == 0',
  ]);
  assert.deepEqual(options.terminalWindows, [180, 90, 30, 7]);
  assert.deepEqual(options.qualityThresholds, [4, 5]);
  assert.equal(options.testSplit, 0.2);
  assert.equal(options.tuningSince, Date.UTC(2025, 0, 1));
  assert.equal(options.testSince, Date.UTC(2025, 6, 1));
  assert.deepEqual(options.capacities, [1, 3, 5]);
  assert.equal(options.maxLossValue, 0.2);
});

test('parses cross-strategy discovery limits', () => {
  const options = parseCliArgs([
    '--crossStrategy',
    '--validationSplit=0.2',
    '--testSplit=0.2',
    '--maxDepth=2',
    '--minSupport=80',
    '--minValidationSupport=40',
    '--maxRowsPerStrategy=1200',
    '--maxRowsPerEvent=2',
    '--minFeatureStrategies=6',
    '--minFeatureCoverage=0.6',
    '--minBenchmarkFeatureCoverage=0.15',
    '--portfolioCapacity=3',
  ]);

  assert.equal(options.crossStrategy, true);
  assert.equal(options.validationSplit, 0.2);
  assert.equal(options.testSplit, 0.2);
  assert.equal(options.minSupport, 80);
  assert.equal(options.minValidationSupport, 40);
  assert.equal(options.maxRowsPerStrategy, 1200);
  assert.equal(options.maxRowsPerEvent, 2);
  assert.equal(options.minFeatureStrategies, 6);
  assert.equal(options.minFeatureCoverage, 0.6);
  assert.equal(options.minBenchmarkFeatureCoverage, 0.15);
  assert.equal(options.portfolioCapacity, 3);
});

test('parses causal moving-average study options', () => {
  const options = parseCliArgs([
    '--movingAverageStudy',
    '--maPeriods=20,0.5,10,5,15',
    '--maLookbackBars=400',
    '--maBatchSize=250',
    '--maSqlTimeoutMs=120000',
  ]);

  assert.equal(options.movingAverageStudy, true);
  assert.deepEqual(options.maPeriods, [5, 10, 15, 20]);
  assert.equal(options.maLookbackBars, 400);
  assert.equal(options.maBatchSize, 250);
  assert.equal(options.maSqlTimeoutMs, 120000);
});

test('builds side, side-slope, and standalone variants for each MA', () => {
  const variants = buildMovingAverageVariants([5]);
  const aligned = {
    movingAverages: {
      SMA: {
        5: { directionalDistanceAtr: 0.1, directionalSlopeAtr5: 0.2 },
      },
    },
  };

  assert.equal(variants.length, 9);
  assert.deepEqual(
    variants.slice(0, 3).map((variant) => [variant.name, variant.mode]),
    [
      ['SMA5-side', 'filter'],
      ['SMA5-side-slope', 'filter'],
      ['SMA5-standalone', 'replace'],
    ],
  );
  assert.equal(variants[0].match(aligned), true);
  assert.equal(variants[1].match(aligned), true);
  assert.equal(variants[2].match(aligned), true);
});

test('calculates causal SMA, EMA, and WMA from newest-first closes', () => {
  const result = calculateMovingAverageGrid({
    closes: [6, 5, 4, 3, 2, 1],
    periods: [3],
    lookbackBars: 6,
    slopeBars: 1,
  });

  assert.equal(result.SMA[3].value, 5);
  assert.equal(result.SMA[3].previous5, 4);
  assert.equal(result.WMA[3].value, (6 * 3 + 5 * 2 + 4) / 6);
  assert.equal(result.WMA[3].previous5, (5 * 3 + 4 * 2 + 3) / 6);
  assert.ok(result.EMA[3].value > result.SMA[3].value);
  assert.ok(result.EMA[3].previous5 < result.EMA[3].value);
});

test('summarizes redundancy across adjacent periods and MA families', () => {
  const periods = [5, 10];
  const rows = [1, 2, 3, 4].map((value) => ({
    movingAverages: Object.fromEntries(
      ['SMA', 'EMA', 'WMA'].map((family) => [
        family,
        {
          5: { directionalDistanceAtr: value },
          10: { directionalDistanceAtr: value * 2 },
        },
      ]),
    ),
  }));

  const result = summarizeMovingAverageRedundancy(rows, periods);

  assert.equal(result.adjacentPeriods.pairs, 3);
  assert.equal(result.adjacentPeriods.min, 1);
  assert.equal(result.samePeriodAcrossFamilies.pairs, 6);
  assert.equal(result.samePeriodAcrossFamilies.median, 1);
});

test('selects the latest merged export independently per strategy', () => {
  const groups = [
    { strategyToken: 'Alpha', mergeId: '10', files: ['old'] },
    { strategyToken: 'Beta', mergeId: '12', files: ['beta'] },
    { strategyToken: 'alpha', mergeId: '15', files: ['new'] },
  ];

  assert.deepEqual(
    latestDatasetGroupsByStrategy(groups).map((group) => group.files[0]),
    ['new', 'beta'],
  );
});

test('classifies pooled features by provenance instead of a broad blacklist', () => {
  const source = {
    'signal.strategy': 'Alpha',
    'additionalIndicators.baseContext.regime.trend': 'up',
    'additionalIndicators.baseContext.regime.trend.psar.value': 100,
    'additionalIndicators.baseContext.structure.liquidityZones.nearestSupport.hitCount': 3,
    'additionalIndicators.baseContext.derivatives.intervals.15m.stale': true,
    'additionalIndicators.baseContext.derivatives.referenceContexts.BTCUSDT.intervals.1h.oiChangePct24h': 2,
    'additionalIndicators.baseContext.derivatives.source': 'cache',
    'additionalIndicators.baseContext.derivatives.referenceContexts.BTCUSDT.intervals.1h.openInterest': 100,
    'additionalIndicators.baseContext.gateFeatures.confirmations.count': 2,
    'additionalIndicators.baseContext.participation.volumeStructure.rowCount': 180,
    'additionalIndicators.baseContext.relative.cmcGlobal.totalMarketCapUsd': 1_000,
    'additionalIndicators.baseContext.relative.cmcGlobal.altMarketCapChange24hPct': 1.2,
    'additionalIndicators.baseContext.relative.cmcFearGreedValue': 45,
    'derived.stopDistanceBps': 50,
  };
  const profiles = partitionCrossStrategyFeatures(source);

  assert.deepEqual(profiles.universal, {
    'additionalIndicators.baseContext.regime.trend': 'up',
    'additionalIndicators.baseContext.structure.liquidityZones.nearestSupport.hitCount': 3,
    'derived.stopDistanceBps': 50,
  });
  assert.equal(
    profiles.benchmarkReference[
      'additionalIndicators.baseContext.derivatives.referenceContexts.BTCUSDT.intervals.1h.oiChangePct24h'
    ],
    2,
  );
  assert.equal(
    profiles.benchmarkReference[
      'additionalIndicators.baseContext.relative.cmcGlobal.altMarketCapChange24hPct'
    ],
    1.2,
  );
  assert.equal(
    profiles.rawNonstationary[
      'additionalIndicators.baseContext.derivatives.referenceContexts.BTCUSDT.intervals.1h.openInterest'
    ],
    100,
  );
  assert.equal(
    profiles.rawNonstationary[
      'additionalIndicators.baseContext.regime.trend.psar.value'
    ],
    100,
  );
  assert.equal(
    profiles.dataQuality[
      'additionalIndicators.baseContext.participation.volumeStructure.rowCount'
    ],
    180,
  );
  assert.equal(
    profiles.derivedPolicy[
      'additionalIndicators.baseContext.gateFeatures.confirmations.count'
    ],
    2,
  );
  assert.equal(
    classifyCrossStrategyFeature(
      'additionalIndicators.baseContext.relative.cmcGlobal.totalMarketCapUsd',
    ).transform,
    'change / dominance / share / ratio',
  );
  assert.deepEqual(filterSharedCrossStrategyFeatures(source), {
    'additionalIndicators.baseContext.regime.trend': 'up',
    'additionalIndicators.baseContext.structure.liquidityZones.nearestSupport.hitCount': 3,
    'derived.stopDistanceBps': 50,
    'additionalIndicators.baseContext.derivatives.referenceContexts.BTCUSDT.intervals.1h.oiChangePct24h': 2,
    'additionalIndicators.baseContext.relative.cmcGlobal.altMarketCapChange24hPct': 1.2,
    'additionalIndicators.baseContext.relative.cmcFearGreedValue': 45,
  });
});

test('collects cross-strategy features without flattening unrelated contexts', () => {
  const features = collectSavedCrossStrategyFeatures({
    signal: {
      direction: 'LONG',
      prices: {
        currentPrice: 100,
        stopLossPrice: 98,
        takeProfitPrice: 104,
      },
    },
    additionalIndicators: {
      strategyContext: { specialEdge: 99 },
      baseContext: {
        raw: {
          trend: { maFast: 99, maSlow: 101 },
          momentum: { macdHistogram: 0.2 },
        },
        regime: { trend: { direction: 'up' } },
        gateFeatures: { quality: 5, confirmations: { count: 2 } },
      },
    },
  });

  assert.equal(
    features['additionalIndicators.baseContext.regime.trend.direction'],
    'up',
  );
  assert.equal(
    features[
      'additionalIndicators.baseContext.gateFeatures.confirmations.count'
    ],
    2,
  );
  assert.equal(
    'additionalIndicators.strategyContext.specialEdge' in features,
    false,
  );
  assert.equal(
    'additionalIndicators.baseContext.gateFeatures.quality' in features,
    false,
  );
  assert.equal(features['derived.stopDistanceBps'], 200);
  assert.equal(features['derived.takeProfitDistanceBps'], 400);
  assert.equal(features['derived.maFastAligned'], true);
  assert.equal(features['derived.maSlowAligned'], false);
  assert.equal(features['derived.macdHistogramAligned'], true);
});

test('balances discovery rows by strategy and timestamp', () => {
  const rows = [
    ...Array.from({ length: 5 }, (_, index) => ({
      strategy: 'A',
      timestamp: index < 3 ? 1 : index,
      sequence: index,
      symbol: `A${index}`,
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      strategy: 'B',
      timestamp: index + 1,
      sequence: 10 + index,
      symbol: `B${index}`,
    })),
  ];
  const balanced = balanceCrossStrategyRows(rows, {
    maxRowsPerStrategy: 2,
    maxRowsPerEvent: 1,
  });

  assert.equal(balanced.filter((row) => row.strategy === 'A').length, 2);
  assert.equal(balanced.filter((row) => row.strategy === 'B').length, 2);
  assert.equal(
    balanced.filter((row) => row.strategy === 'A' && row.timestamp === 1)
      .length,
    1,
  );
});

test('deduplicates benchmark discovery to timestamp events with macro strategy profit', () => {
  const aggregation = aggregateBenchmarkDiscoveryRows([
    {
      strategy: 'A',
      timestamp: 1,
      sequence: 0,
      direction: 'LONG',
      profit: 1,
      rawProfit: 1,
      features: { shared: 2, conflict: 'a' },
    },
    {
      strategy: 'A',
      timestamp: 1,
      sequence: 1,
      direction: 'LONG',
      profit: 3,
      rawProfit: 3,
      features: { shared: 2, conflict: 'b' },
    },
    {
      strategy: 'B',
      timestamp: 1,
      sequence: 2,
      direction: 'LONG',
      profit: 5,
      rawProfit: 5,
      features: { shared: 2, conflict: 'a' },
    },
  ]);

  assert.equal(aggregation.rows.length, 1);
  assert.equal(aggregation.rows[0].profit, 3.5);
  assert.deepEqual(aggregation.rows[0].features, { shared: 2 });
  assert.equal(
    aggregation.consistency.find((entry) => entry.feature === 'conflict')
      .conflictEvents,
    1,
  );
});

test('weights benchmark consensus by strategy before symbol fan-out', () => {
  const rows = [
    ...Array.from({ length: 5 }, (_, sequence) => ({
      strategy: 'A',
      timestamp: 1,
      sequence,
      profit: 1,
      rawProfit: 1,
      features: { vote: 'fanout' },
    })),
    {
      strategy: 'B',
      timestamp: 1,
      sequence: 5,
      profit: 1,
      rawProfit: 1,
      features: { vote: 'majority' },
    },
    {
      strategy: 'C',
      timestamp: 1,
      sequence: 6,
      profit: 1,
      rawProfit: 1,
      features: { vote: 'majority' },
    },
  ];
  const aggregation = aggregateBenchmarkDiscoveryRows(rows, {
    minConsensusRatio: 0.6,
  });

  assert.equal(aggregation.rows[0].features.vote, 'majority');
});

test('reports benchmark conflicts that occur inside strategy events', () => {
  const aggregation = aggregateBenchmarkDiscoveryRows([
    {
      strategy: 'A',
      timestamp: 1,
      sequence: 0,
      profit: 1,
      rawProfit: 1,
      features: { conflict: 'a' },
    },
    {
      strategy: 'A',
      timestamp: 1,
      sequence: 1,
      profit: 1,
      rawProfit: 1,
      features: { conflict: 'b' },
    },
    {
      strategy: 'B',
      timestamp: 1,
      sequence: 2,
      profit: 1,
      rawProfit: 1,
      features: { conflict: 'a' },
    },
    {
      strategy: 'B',
      timestamp: 1,
      sequence: 3,
      profit: 1,
      rawProfit: 1,
      features: { conflict: 'b' },
    },
  ]);
  const consistency = aggregation.consistency.find(
    (entry) => entry.feature === 'conflict',
  );

  assert.deepEqual(aggregation.rows[0].features, {});
  assert.equal(consistency.observedEvents, 1);
  assert.equal(consistency.conflictEvents, 1);
  assert.equal(consistency.intraStrategyConflictEvents, 1);
  assert.equal(consistency.crossStrategyConflictEvents, 0);
});

test('circular-shift controls rotate whole strategy timestamp blocks', () => {
  const [lookup] = buildShiftedProfitLookups(
    [
      { strategy: 'A', timestamp: 1, sequence: 0, profit: 1 },
      { strategy: 'A', timestamp: 1, sequence: 1, profit: 3 },
      { strategy: 'A', timestamp: 2, sequence: 2, profit: 9 },
    ],
    { offsets: [1] },
  );

  assert.equal(lookup.get(0), 4.5);
  assert.equal(lookup.get(1), 4.5);
  assert.equal(lookup.get(2), 4);
});

test('applies one benchmark snapshot to every signal in an event', () => {
  const rows = [
    { timestamp: 1, sequence: 0, features: { shared: 'a' } },
    { timestamp: 1, sequence: 1, features: { shared: 'b' } },
    { timestamp: 2, sequence: 2, features: { shared: 'c' } },
  ];
  const applied = applyBenchmarkEventSnapshots(rows, [
    { timestamp: 1, features: { shared: 'consensus' } },
    { timestamp: 2, features: {} },
  ]);

  assert.deepEqual(
    applied.map((row) => row.features),
    [{ shared: 'consensus' }, { shared: 'consensus' }, {}],
  );
  assert.equal(
    applied.filter((row) =>
      matchesPocket(row, [
        { featureKey: 'shared', op: '==', value: 'consensus' },
      ]),
    ).length,
    2,
  );
});

test('rejects approval fan-out above configured portfolio capacity', () => {
  let sequence = 0;
  const buildPartition = (start) =>
    Array.from({ length: 25 }, (_, eventIndex) =>
      Array.from({ length: 6 }, (_, rowIndex) => ({
        timestamp: start + eventIndex * 24 * 60 * 60 * 1000,
        sequence: sequence++,
        strategy: rowIndex < 3 ? 'A' : 'B',
        symbol: `S${rowIndex}`,
        direction: 'LONG',
        profit: 1,
        rawProfit: 1,
        features: { keep: true },
      })),
    ).flat();
  const split = {
    train: buildPartition(Date.UTC(2025, 0, 1)),
    tuning: buildPartition(Date.UTC(2025, 2, 1)),
    test: buildPartition(Date.UTC(2025, 4, 1)),
  };
  const candidate = evaluateCrossPocket({
    pocket: {
      condition: 'keep == true',
      predicates: [{ featureKey: 'keep', op: '==', value: true }],
    },
    split,
    expectedSign: 1,
    testShiftLookups: [],
    minSharedStrategies: 2,
    portfolioCapacity: 5,
  });

  assert.equal(candidate.train.maxBatch, 6);
  assert.equal(candidate.checks.portfolioFanout, false);
});

test('builds a profiled cross-strategy report from tiny sharded exports', async (t) => {
  const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-cross-profile-'));
  t.after(() => fsp.rm(outDir, { recursive: true, force: true }));
  const start = Date.UTC(2025, 0, 1);
  const buildRows = (strategy, offset) =>
    Array.from({ length: 40 }, (_, index) => {
      const direction = index % 2 === 0 ? 'LONG' : 'SHORT';
      const timestamp = start + index * 15 * 60 * 1000;
      return JSON.stringify({
        timestamp,
        direction,
        profit: (index % 4 < 2 ? 1 : -0.8) + offset,
        strategyName: strategy,
        signalId: `${strategy}-${index}`,
        symbol: index % 3 === 0 ? 'ETHUSDT' : 'SOLUSDT',
        payload: {
          signal: {
            direction,
            prices: {
              currentPrice: 100,
              stopLossPrice: 99,
              takeProfitPrice: 102,
            },
          },
          additionalIndicators: {
            baseContext: {
              raw: {
                trend: { maFast: 99, maSlow: 101 },
                volatility: { atrPct: 1.2 },
              },
              regime: { trend: { bias: index % 4 ? 'bull' : 'bear' } },
              structure: {
                localRange: { rangePosition20: index / 40 },
                liquidityZones: { activeCount: index % 3 },
              },
              derivatives: {
                source: 'coinalyze',
                symbol: 'BTCUSDT',
                intervals: {
                  '15m': {
                    stale: false,
                    points: 100,
                    openInterest: 1_000_000 + index,
                    oiChangePct1h: index / 10,
                    fundingZScore: index % 5,
                    liqImbalance: 0.1,
                    liqSpikeRatio: 1.1,
                  },
                },
                summary: { pressure: index % 4 ? 'long' : 'short' },
              },
              relative: {
                cmcGlobal: {
                  stale: false,
                  totalMarketCapUsd: 1_000_000_000 + index,
                  altMarketCapChange24hPct: index / 20,
                },
              },
            },
          },
        },
      });
    }).join('\n');
  await Promise.all(
    [
      ['Alpha', 0],
      ['Beta', 0.1],
    ].map(([strategy, offset]) =>
      fsp.writeFile(
        path.join(outDir, `ai-dataset-${strategy}-merged-1.jsonl`),
        `${buildRows(strategy, offset)}\n`,
      ),
    ),
  );
  const groups = [
    {
      strategyToken: 'Alpha',
      mergeId: '1',
      files: [path.join(outDir, 'ai-dataset-Alpha-merged-1.jsonl')],
    },
    {
      strategyToken: 'Beta',
      mergeId: '1',
      files: [path.join(outDir, 'ai-dataset-Beta-merged-1.jsonl')],
    },
  ];
  const report = await buildCrossStrategyReport({
    projectRoot: process.cwd(),
    sourceRepositoryRoot: process.cwd(),
    frameworkRepositoryRoot: process.cwd(),
    searchAiPockets: () => ({
      positivePockets: [],
      negativePockets: [],
      stats: {},
    }),
    groups,
    validationSplit: 0.2,
    testSplit: 0.2,
    maxDepth: 1,
    minSupport: 1,
    minValidationSupport: 1,
    maxAtomicPredicates: 10,
    maxCombinations: 20,
    top: 2,
    maxRowsPerStrategy: 100,
    maxRowsPerEvent: 1,
    minFeatureStrategies: 2,
    minFeatureCoverage: 0.1,
    minBenchmarkFeatureCoverage: 0.1,
  });

  assert.equal(report.run.overlapRows, 80);
  assert.equal(
    report.datasets.reduce((sum, dataset) => sum + dataset.overlapRows, 0),
    80,
  );
  assert.ok(report.profiles.universal.directions.LONG.features.length > 0);
  assert.ok(
    report.profiles.benchmarkReference.directions.SHORT.features.length > 0,
  );
  assert.equal(report.run.acceptance.minSharedStrategies, 2);
  assert.equal(report.run.acceptance.portfolioCapacity, 5);
  assert.ok(
    report.profiles.benchmarkReference.directions.SHORT.featureConsistency.test,
  );
  assert.ok(report.audits.rawNonstationary.length > 0);
  assert.match(formatCrossStrategyMarkdown(report), /Data-Quality Guard Audit/);
});

test('evaluates generated pocket predicates against feature maps', () => {
  const row = { features: { trend: 'up', distance: 0.4 } };
  assert.equal(
    matchesPocket(row, [
      { featureKey: 'trend', op: '==', value: 'up' },
      { featureKey: 'distance', op: '<=', threshold: 0.5 },
    ]),
    true,
  );
  assert.equal(
    matchesPocket(row, [{ featureKey: 'distance', op: '>=', threshold: 0.5 }]),
    false,
  );
});

test('evaluates numeric, string, boolean, and null predicates with precedence', () => {
  const rule = parseRuleExpression(
    '(trend.distance <= 1.2 && structure.zone == active) || flags.recovery == true',
  );

  assert.equal(
    evaluateRule(rule, {
      'trend.distance': 1.1,
      'structure.zone': 'active',
      'flags.recovery': false,
    }),
    true,
  );
  assert.equal(
    evaluateRule(rule, {
      'trend.distance': 1.3,
      'structure.zone': 'active',
      'flags.recovery': true,
    }),
    true,
  );
  assert.equal(
    evaluateRule(parseRuleExpression('feature.value == null'), {
      'feature.value': null,
    }),
    true,
  );
  assert.equal(evaluateRule(rule, {}), false);
});

test('supports explicit pass-through and direction-aware policies', () => {
  assert.equal(evaluateRule(parseRuleExpression('true'), {}), true);
  assert.equal(evaluateRule(parseRuleExpression('false'), {}), false);

  const rule = parseRuleExpression(
    '(derived.direction == LONG && trend.distance <= 1) || (derived.direction == SHORT && structure.ageBars <= 47)',
  );
  assert.equal(
    evaluateRule(rule, {
      'derived.direction': 'SHORT',
      'structure.ageBars': 42,
      'trend.distance': 3,
    }),
    true,
  );
  assert.equal(
    evaluateRule(rule, {
      'derived.direction': 'LONG',
      'structure.ageBars': 42,
      'trend.distance': 3,
    }),
    false,
  );
});

test('parses variant mode and optional assigned quality', () => {
  const variant = parseVariant(
    'q3-recovery::add@4::context.bodyStrength >= 0.65',
  );

  assert.equal(variant.name, 'q3-recovery');
  assert.equal(variant.mode, 'add');
  assert.equal(variant.quality, 4);
  assert.throws(
    () => parseVariant('invalid::add@6::context.value == true'),
    /Invalid added quality/,
  );
});

test('parses and enforces an optional direction scope for gate repair', () => {
  const variant = parseVariant(
    'short-rescue::add@4[SHORT]::structure.ageBars <= 42',
  );

  assert.equal(variant.direction, 'SHORT');
  assert.equal(
    isVariantSelected({
      variant,
      baselineSelected: false,
      matches: true,
      direction: 'SHORT',
      threshold: 4,
      defaultQuality: 4,
    }),
    true,
  );
  assert.equal(
    isVariantSelected({
      variant,
      baselineSelected: false,
      matches: true,
      direction: 'LONG',
      threshold: 4,
      defaultQuality: 4,
    }),
    false,
  );
  assert.throws(
    () => parseVariant('bad::add@4[SIDEWAYS]::feature.value == true'),
    /Invalid direction scope/,
  );
  assert.equal(
    evaluateRule(parseVariant('short-pass::add@4[SHORT]::true').rule, {}),
    true,
  );
});

test('applies filter, exclude, add, and replace selection semantics', () => {
  const selected = (mode, baselineSelected, matches, quality = null) =>
    isVariantSelected({
      variant: { mode, quality },
      baselineSelected,
      matches,
      direction: 'LONG',
      threshold: 4,
      defaultQuality: 4,
    });

  assert.equal(selected('filter', true, true), true);
  assert.equal(selected('filter', true, false), false);
  assert.equal(selected('exclude', true, true), false);
  assert.equal(selected('exclude', true, false), true);
  assert.equal(selected('add', false, true), true);
  assert.equal(selected('add', false, true, 3), false);
  assert.equal(selected('replace', true, false), false);
  assert.equal(selected('replace', false, true), true);
});

test('calculates required profit, drawdown, strict-loss, and cadence metrics', () => {
  const rows = [
    {
      timestamp: Date.UTC(2026, 0, 1),
      profit: 10,
      symbol: 'A',
      direction: 'LONG',
    },
    {
      timestamp: Date.UTC(2026, 0, 2),
      profit: -4,
      symbol: 'B',
      direction: 'SHORT',
    },
    {
      timestamp: Date.UTC(2026, 0, 3),
      profit: -7,
      symbol: 'A',
      direction: 'LONG',
    },
    {
      timestamp: Date.UTC(2026, 1, 1),
      profit: 5,
      symbol: 'A',
      direction: 'LONG',
    },
  ];
  const summary = summarizeRows(rows, 31);

  assert.equal(summary.trades, 4);
  assert.equal(summary.totalProfit, 4);
  assert.equal(summary.winRate, 0.5);
  assert.equal(summary.profitFactor, 15 / 11);
  assert.equal(typeof summary.sharpeRatio, 'number');
  assert.equal(typeof summary.sortinoRatio, 'number');
  assert.equal(summary.calmarRatio, ((4 / 31) * 365) / 11);
  assert.equal(summary.maxDrawdown, 11);
  assert.equal(summary.largestLoss, -7);
  assert.equal(summary.maxLossStreak, 2);
  assert.equal(summary.losingMonths, 1);
  assert.deepEqual(summary.losingMonthValues, [{ month: '2026-01', pnl: -1 }]);
  assert.equal(summary.cadencePerDay, 4 / 31);
  assert.equal(summary.cadencePerWeek, (4 / 31) * 7);
  assert.equal(summary.averageProfitPerMonth, (4 / 31) * 30.4375);
  assert.equal(summary.events, 4);
  assert.equal(summary.eventsPerDay, 4 / 31);
  assert.equal(summary.activeDays, 4);
  assert.equal(summary.tradesPerEvent, 1);
  assert.equal(summary.p95Batch, 1);
  assert.equal(summary.maxBatch, 1);
});

test('groups split and fan-out metrics by decision timestamp', () => {
  const first = Date.UTC(2026, 0, 1);
  const second = Date.UTC(2026, 0, 2);
  const third = Date.UTC(2026, 0, 3);
  const rows = [
    { timestamp: first, profit: 3, symbol: 'A', direction: 'LONG' },
    { timestamp: first, profit: -1, symbol: 'B', direction: 'LONG' },
    { timestamp: first, profit: 2, symbol: 'C', direction: 'LONG' },
    { timestamp: second, profit: 4, symbol: 'A', direction: 'LONG' },
    { timestamp: third, profit: 5, symbol: 'A', direction: 'LONG' },
  ];
  const summary = summarizeRows(rows, 3, {
    capacities: [1, 3],
    maxLossValue: 0.2,
  });
  const split = splitRowsByTimestamp(rows, 1 / 3, 1 / 3);

  assert.equal(summary.events, 3);
  assert.equal(summary.tradesPerEvent, 5 / 3);
  assert.equal(summary.p95Batch, 3);
  assert.equal(summary.maxBatch, 3);
  assert.equal(summary.capacityStress['1'].accepted, 3);
  assert.equal(summary.capacityStress['1'].overflow, 2);
  assert.equal(summary.capacityStress['1'].overflowEvents, 1);
  assert.equal(summary.capacityStress['1'].maxSimultaneousStopRisk, 0.2);
  assert.ok(
    Math.abs(summary.capacityStress['3'].maxSimultaneousStopRisk - 0.6) <
      Number.EPSILON,
  );
  assert.deepEqual(
    [...new Set(split.train.map((row) => row.timestamp))],
    [first],
  );
  assert.deepEqual(
    [...new Set(split.tuning.map((row) => row.timestamp))],
    [second],
  );
  assert.deepEqual(
    [...new Set(split.test.map((row) => row.timestamp))],
    [third],
  );
});

test('uses exact calendar boundaries without splitting timestamp events', () => {
  const train = Date.UTC(2025, 0, 1);
  const tuning = Date.UTC(2025, 3, 1);
  const testStart = Date.UTC(2025, 6, 1);
  const rows = [
    { timestamp: train, id: 'train' },
    { timestamp: tuning, id: 'tuning-a' },
    { timestamp: tuning, id: 'tuning-b' },
    { timestamp: testStart, id: 'test' },
  ];

  const split = splitRowsByTimestampBounds(rows, tuning, testStart);

  assert.deepEqual(split.train.map((row) => row.id), ['train']);
  assert.deepEqual(split.tuning.map((row) => row.id), [
    'tuning-a',
    'tuning-b',
  ]);
  assert.deepEqual(split.test.map((row) => row.id), ['test']);
});

test('builds timestamp-grouped cumulative equity with common endpoints', () => {
  const start = Date.UTC(2025, 0, 1);
  const end = Date.UTC(2025, 0, 3);
  const rows = [
    { timestamp: start, profit: 2, keep: true },
    { timestamp: start, profit: -1, keep: true },
    { timestamp: Date.UTC(2025, 0, 2), profit: 10, keep: false },
    { timestamp: end, profit: 3, keep: true },
  ];

  assert.deepEqual(
    buildEquitySeries(rows, (row) => row.keep, start, end),
    [
      [start, 1],
      [end, 4],
    ],
  );
});

test('builds full and terminal period comparisons for a candidate', () => {
  const start = Date.UTC(2025, 0, 1);
  const variants = [parseVariant('keep::filter[SHORT]::feature.keep == true')];
  const rows = [
    {
      timestamp: start,
      profit: 10,
      symbol: 'A',
      direction: 'LONG',
      directionMatches: true,
      quality: 4,
      variantMatches: [true],
    },
    {
      timestamp: start + 200 * 24 * 60 * 60 * 1000,
      profit: -5,
      symbol: 'B',
      direction: 'SHORT',
      directionMatches: true,
      quality: 5,
      variantMatches: [false],
    },
  ];
  const report = buildAblationReport({
    rows,
    variants,
    minQuality: 4,
    qualityThresholds: [4, 5],
    terminalWindows: [180, 90, 30, 7],
    validationSplit: 0.25,
    testSplit: 0,
    maxLossValue: 0.2,
    filePaths: ['part1.jsonl'],
  });

  assert.deepEqual(Object.keys(report.baseline.periods), [
    'full',
    '180d',
    '90d',
    '30d',
    '7d',
  ]);
  assert.equal(report.baseline.periods.full.trades, 2);
  assert.equal(report.baseline.periodDirections.full.LONG.trades, 1);
  assert.equal(report.baseline.periodDirections.full.SHORT.trades, 1);
  assert.equal(report.baseline.periodDirections['180d'].LONG.trades, 0);
  assert.equal(report.baseline.periodDirections['180d'].SHORT.trades, 1);
  assert.equal(report.variants[0].periods.full.trades, 1);
  assert.equal(report.variants[0].periodDirections.full.LONG.trades, 1);
  assert.equal(report.variants[0].periodDirections.full.SHORT.trades, 0);
  assert.equal(report.variants[0].periodDirections['180d'].LONG.trades, 0);
  assert.equal(report.variants[0].periodDirections['180d'].SHORT.trades, 0);
  assert.equal(report.variants[0].direction, 'SHORT');
  assert.equal(report.variants[0].removed.trades, 1);
  assert.equal(report.run.trainEvents, 1);
  assert.equal(report.run.tuningEvents, 1);
  assert.equal(report.run.testEvents, 0);
  assert.deepEqual(report.run.partitions, {
    train: {
      rows: 1,
      events: 1,
      startTimestamp: new Date(start).toISOString(),
      endTimestamp: new Date(start).toISOString(),
    },
    tuning: {
      rows: 1,
      events: 1,
      startTimestamp: new Date(start + 200 * 24 * 60 * 60 * 1000).toISOString(),
      endTimestamp: new Date(start + 200 * 24 * 60 * 60 * 1000).toISOString(),
    },
    test: {
      rows: 0,
      events: 0,
      startTimestamp: null,
      endTimestamp: null,
    },
  });
  assert.match(formatMarkdownReport(report), /## Baseline/);
  assert.match(formatMarkdownReport(report), /Baseline Cadence and Fan-out/);
  assert.match(formatMarkdownReport(report), /Baseline Validation/);
  assert.match(formatMarkdownReport(report), /Approved Events/);
  assert.match(formatMarkdownReport(report), /## Variant: keep/);
});

test('uses inclusive UTC calendar days for terminal active-day ratio', () => {
  const start = Date.UTC(2026, 0, 1, 18);
  const rows = [
    {
      timestamp: start,
      profit: 10,
      symbol: 'A',
      direction: 'LONG',
      directionMatches: true,
      quality: 4,
      variantMatches: [],
    },
    {
      timestamp: start + 7 * 24 * 60 * 60 * 1000,
      profit: 5,
      symbol: 'B',
      direction: 'LONG',
      directionMatches: true,
      quality: 4,
      variantMatches: [],
    },
  ];
  const report = buildAblationReport({
    rows,
    variants: [],
    minQuality: 4,
    qualityThresholds: [4, 5],
    terminalWindows: [7],
    validationSplit: 0,
    testSplit: 0,
    filePaths: ['part1.jsonl'],
  });

  assert.equal(report.baseline.periods['7d'].activeDays, 2);
  assert.equal(report.baseline.periods['7d'].activeDayRatio, 0.25);
});
