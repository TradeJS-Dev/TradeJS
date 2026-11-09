import type { AiFeatureDefinition, AiPayload, Signal } from '@tradejs/types';
import { projectAiFeatures } from '@tradejs/core/aiFeatures';
import { collectAiPocketFeatureSnapshot } from '../lib/aiPocketSearch/features';
import { extractSignalFromAiDatasetRow } from '../lib/aiTrainDataset';
import { buildAiPayload as buildAiPayloadByStrategy } from '@tradejs/node/ai';
import {
  registerStrategyEntries,
  resetStrategyRegistryCache,
} from '@tradejs/node/registry';
const mockManifest = {
  mockReturnValue(manifest: {
    name: string;
    aiFeatures: AiFeatureDefinition[];
  }) {
    resetStrategyRegistryCache();
    registerStrategyEntries([
      {
        manifest,
        defaults: {},
        parseConfig: () => ({}),
        createCore: jest.fn(),
      },
    ]);
  },
};
const d: AiFeatureDefinition = {
  id: 'fixture.geometry',
  version: 1,
  path: 'additionalIndicators.deep.geometry.swings',
  source: 'signal',
  reduction: 'max',
  role: 'input',
  scope: 'setup',
  stationary: true,
  unit: 'ATR',
  description: 'Confirmed swings',
};
const signal = (): Signal => ({
  signalId: 's',
  strategy: 'Fixture',
  symbol: 'SOLUSDT',
  interval: '15',
  direction: 'LONG',
  timestamp: 1000,
  prices: {
    currentPrice: 10,
    stopLossPrice: 9,
    takeProfitPrice: 12,
    riskRatio: 2,
  },
  indicators: {},
  figures: {},
  additionalIndicators: {
    deep: { geometry: { swings: [99, 1, 2, 3, 4, 5, 6] } },
  },
});
beforeEach(() =>
  mockManifest.mockReturnValue({ name: 'Fixture', aiFeatures: [d] }),
);
it('preserves untrimmed registered features through export and native dataset reconstruction', () => {
  const s = signal();
  const payload = buildAiPayloadByStrategy(s);
  expect(payload.featureSnapshot?.values['fixture.geometry']).toBe(99);
  const replaySignal = extractSignalFromAiDatasetRow({
    signalId: 's',
    strategyName: 'Fixture',
    symbol: s.symbol,
    direction: 'LONG',
    timestamp: 1000,
    profit: 10,
    payload,
  });
  const replay = buildAiPayloadByStrategy(replaySignal);
  expect(replay.featureSnapshot).toEqual(payload.featureSnapshot);
  expect(
    collectAiPocketFeatureSnapshot({
      payload: replay,
      featureProfile: 'compact',
      featurePolicy: 'causal-stationary',
    }).features['registered.fixture.geometry'],
  ).toBe(99);
  mockManifest.mockReturnValue({
    name: 'Fixture',
    aiFeatures: [{ ...d, version: 2 }],
  });
  expect(() => buildAiPayloadByStrategy(replaySignal)).toThrow(
    'definition changed',
  );
});
it('exports quality and outcomes for audit but never discovers them as input predicates', () => {
  const definitions: AiFeatureDefinition[] = [
    d,
    {
      ...d,
      id: 'fixture.coverage',
      role: 'data-quality',
      path: 'hours',
      reduction: undefined,
    },
    {
      ...d,
      id: 'fixture.label',
      role: 'outcome',
      path: 'tradeResult.netProfit',
      reduction: undefined,
    },
  ];
  const payload = buildAiPayloadByStrategy(signal());
  payload.featureSnapshot = projectAiFeatures(definitions, {
    signal: { ...signal(), hours: 720, tradeResult: { netProfit: 12 } },
    payload,
  });
  const excluded: string[] = [];
  const result = collectAiPocketFeatureSnapshot({
    payload,
    onFeatureExcluded: (e) => excluded.push(e.path),
  });
  expect(result.features['registered.fixture.geometry']).toBe(99);
  expect(result.features).not.toHaveProperty('registered.fixture.coverage');
  expect(result.features).not.toHaveProperty('registered.fixture.label');
  expect(excluded).toEqual(
    expect.arrayContaining([
      'registered.fixture.coverage',
      'registered.fixture.label',
    ]),
  );
});
it('reports why legacy arrays and compact branches are not discoverable', () => {
  const excluded: string[] = [];
  const payload: AiPayload = {
    ...buildAiPayloadByStrategy(signal()),
    additionalIndicators: {
      baseContext: { structure: { pivots: { barsSinceSwingHigh: 5 } } },
      values: [1, 2],
    },
  };
  collectAiPocketFeatureSnapshot({
    payload,
    featureProfile: 'compact',
    onFeatureExcluded: (e) => excluded.push(e.classification),
  });
  expect(excluded).toEqual(
    expect.arrayContaining(['compact-profile', 'unprojected-array']),
  );
});
it('normalizes BTC and ETH through the same market projection without changing BTC values', () => {
  const s = signal();
  s.additionalIndicators = {
    baseContext: {
      relative: {
        targetVsBtc: {
          source: 'aligned_ohlcv',
          alphaVsBtc1h: 2,
          correlationToBtc20: 0.5,
        },
        targetVsEth: {
          source: 'aligned_ohlcv',
          alphaVsEth1h: 3,
          correlationToEth20: 0.7,
        },
      },
    },
  };
  expect(buildAiPayloadByStrategy(s).additionalIndicators).toMatchObject({
    marketContext: {
      relative: {
        targetVsBtc: { alphaVsBtc1h: 2, correlationToBtc20: 0.5 },
        targetVsEth: { alphaVsEth1h: 3, correlationToEth20: 0.7 },
      },
    },
  });
});
it.each(['nested', 'standalone'])(
  'does not leak %s profile metadata through legacy flattening',
  (placement) => {
    const payload = buildAiPayloadByStrategy(signal());
    payload.additionalIndicators = {
      baseContext: {
        tickerProfile: {
          hours: 720,
          btcAlignedHours: 700,
          windowStart: 1,
          validUntil: 2,
          dailyVolatilityPct: 5,
        },
      },
    };
    if (placement === 'standalone') {
      payload.additionalIndicators = {
        tickerProfile: { hours: 720, asOf: 1, dailyVolatilityPct: 5 },
      };
    }
    const result = collectAiPocketFeatureSnapshot({
      payload,
      featurePolicy: 'causal-stationary',
    });
    expect(
      Object.keys(result.features).filter((p) => p.includes('tickerProfile')),
    ).toEqual([]);
  },
);

it('round-trips a monthly profile and makes groups available to pocket search', () => {
  const s = signal();
  s.additionalIndicators = {
    ...s.additionalIndicators,
    baseContext: {
      tickerProfile: {
        symbol: 'SOLUSDT',
        asOf: 0,
        validUntil: 10000,
        windowStart: -10000,
        hours: 720,
        returnHours: 720,
        btcAlignedHours: 720,
        ethAlignedHours: 720,
        turnoverSource: 'quote',
        dailyTurnoverUSDT: 1000000,
        dailyVolatilityPct: 4,
        correlationBTC: 0.8,
        correlationETH: 0.7,
        moneyGroup: 'high',
        volatilityGroup: 'middle',
        btcCorrelationGroup: 'strong',
        ethCorrelationGroup: 'strong',
        definition: 'hourly-30d-monthly-terciles/v1',
        provider: 'bybit',
        universeId: 'fixture',
        snapshotId: 'fixture-hash',
      },
    },
  };
  const payload = buildAiPayloadByStrategy(s);
  // An adapter may omit the verbose profile while retaining the frozen projection.
  payload.additionalIndicators = {};
  const reconstructed = extractSignalFromAiDatasetRow({
    signalId: 's',
    strategyName: 'Fixture',
    symbol: s.symbol,
    direction: 'LONG',
    timestamp: 1000,
    profit: 10,
    payload,
  });
  const replay = buildAiPayloadByStrategy(reconstructed);
  expect(replay.featureSnapshot).toEqual(payload.featureSnapshot);
  const features = collectAiPocketFeatureSnapshot({
    payload: replay,
    featurePolicy: 'causal-stationary',
  }).features;
  expect(features['registered.ticker.moneyGroup']).toBe('high');
  expect(features).not.toHaveProperty('registered.ticker.hours');
  expect(features).not.toHaveProperty('registered.ticker.asOf');
});

it('refuses to reconstruct new features from a legacy trimmed export', () => {
  const payload = buildAiPayloadByStrategy(signal());
  delete payload.featureSnapshot;
  const replay = extractSignalFromAiDatasetRow({
    signalId: 's',
    strategyName: 'Fixture',
    symbol: 'SOLUSDT',
    direction: 'LONG',
    timestamp: 1000,
    profit: 10,
    payload,
  });
  expect(() => buildAiPayloadByStrategy(replay)).toThrow(
    'no frozen AI features',
  );
  mockManifest.mockReturnValue({ name: 'Fixture', aiFeatures: [] });
  expect(() => buildAiPayloadByStrategy(replay)).not.toThrow();
});
