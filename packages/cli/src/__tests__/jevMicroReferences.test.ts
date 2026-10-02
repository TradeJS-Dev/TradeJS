import { microReferenceFeatures } from '../lib/jevMicroReferences';
import type { JevInput } from '@tradejs/types';

const input = (features: JevInput['features']): JevInput => ({
  schema: 'tradejs-jev-input/v4',
  questionSet: 'micro-v3',
  strategy: 'AnyConsolidation',
  symbol: 'TESTUSDT',
  timestamp: 1000,
  interval: '15',
  direction: 'LONG',
  features,
  provenance: {},
  missing: {},
  questions: [],
  geometryStatus: 'absent',
});

it('keeps missing arithmetic controls absent rather than manufacturing market states', () => {
  expect(Object.values(microReferenceFeatures(input({})))).toEqual(
    Array(8).fill(null),
  );
  expect(
    microReferenceFeatures(
      input({ 'market.volumeRel20': -1, 'setup.impulseEfficiencyRatio': 1.1 }),
    ).volumeExpansion,
  ).toBeNull();
});

it('respects physical rubric boundaries and joint geometry/candle conditions', () => {
  const facts = {
    'setup.retracementRatio': 0.2,
    'market.volumeRel20': 0.5,
    'entry.directionalBodyAtr': 0.5,
    'entry.directionalCloseLocation': 0.75,
    'geometry.upperR2': 0.95,
    'geometry.lowerR2': 0.95,
    'geometry.slopeDivergenceRatio': 0.05,
  };
  expect(microReferenceFeatures(input(facts))).toMatchObject({
    correctionContainment: 1,
    volumeExpansion: 0.25,
    entryConviction: 1,
    boundaryRegularity: 1,
  });
  expect(
    microReferenceFeatures(
      input({
        ...facts,
        'setup.retracementRatio': 0.20001,
        'market.volumeRel20': 0.49999,
        'geometry.slopeDivergenceRatio': 0.05001,
        'entry.directionalCloseLocation': 0.74,
      }),
    ),
  ).toMatchObject({
    correctionContainment: 0.75,
    volumeExpansion: 0,
    entryConviction: 0.75,
    boundaryRegularity: 0.75,
  });
  expect(
    microReferenceFeatures(
      input({
        ...facts,
        'geometry.lowerR2': 0.6,
        'entry.directionalBodyAtr': -0.5,
        'entry.directionalCloseLocation': 0.2,
      }),
    ),
  ).toMatchObject({ entryConviction: 0, boundaryRegularity: 0.25 });
});
