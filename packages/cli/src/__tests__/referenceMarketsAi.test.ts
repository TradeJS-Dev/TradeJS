import { indexReferenceMarkets } from '@tradejs/core/data';
import { buildAiHumanPrompt, buildAiPayload } from '@tradejs/node/ai';
import type { AiDatasetRow, Signal } from '@tradejs/types';
import { collectAiPocketFeatureSnapshot } from '../lib/aiPocketSearch/features';
import { extractSignalFromAiDatasetRow } from '../lib/aiTrainDataset';

it('freezes reference features through the native dataset row and exposes only intended pocket inputs', () => {
  const timestamp = Date.parse('2026-10-05T20:00:00Z');
  const hour = 3_600_000;
  const referenceMarkets = indexReferenceMarkets([
    {
      symbol: 'SOLUSDT',
      interval: 60,
      timestamp: timestamp - 2 * hour,
      close: 100,
      volume: 1,
    },
    {
      symbol: 'SOLUSDT',
      interval: 60,
      timestamp: timestamp - hour,
      close: 101,
      volume: 1,
    },
  ])(timestamp);
  const signal: Signal = {
    signalId: 's1',
    timestamp,
    symbol: 'TESTUSDT',
    interval: '15',
    strategy: 'ReferenceMarketsTest',
    direction: 'SHORT',
    figures: {},
    indicators: {},
    prices: {
      currentPrice: 100,
      takeProfitPrice: 90,
      stopLossPrice: 105,
      riskRatio: 2,
    },
    additionalIndicators: {
      referenceMarkets,
      baseContext: {
        structure: {
          acceptance: { failedAcceptanceBars: 2, anotherField: 123 },
        },
        regime: { momentum: { roc4h: 3 } },
        participation: { volume: { turnoverRel20: 1.5 } },
      },
    },
  };
  const payload = buildAiPayload(signal);
  const legacySignal = {
    ...signal,
    additionalIndicators: {
      ...signal.additionalIndicators,
      referenceMarkets: undefined,
    },
  };
  expect(buildAiHumanPrompt(signal, payload)).toEqual(
    buildAiHumanPrompt(legacySignal),
  );
  const row = JSON.parse(JSON.stringify({ payload })) as AiDatasetRow;
  const restored = extractSignalFromAiDatasetRow(row);
  expect(buildAiPayload(restored).featureSnapshot).toEqual(
    payload.featureSnapshot,
  );
  const { features } = collectAiPocketFeatureSnapshot({
    payload,
    featureProfile: 'compact',
    featurePolicy: 'causal-stationary',
  });
  expect(features['registered.referenceMarkets.h1.SOLUSDT']).toBeCloseTo(
    Math.log(1.01) * 100,
  );
  expect(
    Object.keys(features).some((key) =>
      /closedAt|anotherField|referenceMarkets.*growthPct|\.frames\./.test(key),
    ),
  ).toBe(false);
  expect(
    features[
      'additionalIndicators.baseContext.structure.acceptance.failedAcceptanceBars'
    ],
  ).toBe(2);
  expect(
    features['additionalIndicators.baseContext.regime.momentum.roc4h'],
  ).toBe(3);
  expect(
    features[
      'additionalIndicators.baseContext.participation.volume.turnoverRel20'
    ],
  ).toBe(1.5);

  const legacy = buildAiPayload({ ...signal, additionalIndicators: undefined });
  expect(
    buildAiPayload(
      extractSignalFromAiDatasetRow({ payload: legacy } as AiDatasetRow),
    ).featureSnapshot,
  ).toBeUndefined();
});
