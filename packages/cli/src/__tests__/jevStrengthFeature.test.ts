import { collectAiPocketFeatures } from '../lib/aiPocketSearch/features';
import type { AiPayload } from '@tradejs/types';

it('retains the holistic score as a causal feature for gate research without outcome fields', () => {
  const features = collectAiPocketFeatures({
    payload: {
      indicators: {},
      additionalIndicators: {
        jev: { questionSet: 'micro-v3', scores: { signalStrength: 8.2 } },
        profit: 1000,
        aiApproved: true,
      },
    } as unknown as AiPayload,
    featurePolicy: 'causal-stationary',
  });
  expect(features['additionalIndicators.jev.scores.signalStrength']).toBe(8.2);
  expect(features['additionalIndicators.profit']).toBeUndefined();
  expect(features['additionalIndicators.aiApproved']).toBeUndefined();
});
