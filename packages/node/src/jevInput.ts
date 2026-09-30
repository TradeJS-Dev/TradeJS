import type {
  JevDimension,
  JevFeature,
  JevInput,
  Signal,
} from '@tradejs/types';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const at = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((current, key) => object(current)[key], value);
const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const fact = (value: unknown): JevFeature => {
  if (value == null || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'number') return finite(value);
  if (typeof value === 'string' && value.length <= 60) return value;
  throw new Error('Invalid Jev evidence fact');
};

/** Only explicitly selected signal-time facts enter the provider request. */
export const buildJevInput = (signal: Signal): JevInput => {
  if (
    !['LONG', 'SHORT'].includes(signal.direction ?? '') ||
    !Number.isFinite(signal.timestamp)
  )
    throw new Error('Jev requires a dated directional signal');
  const base = object(signal.additionalIndicators?.baseContext);
  // StrategyAPI carries optional strategy facts through additionalIndicators.
  const evidence =
    signal.jevEvidence ?? signal.additionalIndicators?.jevEvidence;
  const features: Record<string, JevFeature> = {};
  const put = (key: string, value: unknown) => {
    const normalized = fact(value);
    if (normalized != null) features[key] = normalized;
  };
  put('signal.direction', signal.direction);
  put('market.trendBias', at(base, 'regime', 'trend', 'bias'));
  put('market.swingBias', at(base, 'structure', 'swing', 'bias'));
  put('market.volumeRel20', at(base, 'participation', 'volume', 'volumeRel20'));
  put('market.deltaPct', at(base, 'participation', 'delta', 'deltaPct'));
  put(
    'market.fastMaDistanceAtr',
    at(base, 'regime', 'trend', 'priceDistanceToMaFastAtr'),
  );
  const price = finite(signal.prices.currentPrice);
  const stop = finite(signal.prices.stopLossPrice);
  const target = finite(signal.prices.takeProfitPrice);
  const atr = finite(at(base, 'raw', 'volatility', 'atr'));
  if (price == null || stop == null || target == null)
    throw new Error('Invalid Jev signal prices');
  features['signal.validLevels'] =
    signal.direction === 'LONG'
      ? stop < price && price < target
      : target < price && price < stop;
  if (atr != null && atr > 0) {
    features['signal.stopDistanceAtr'] = Math.abs(price - stop) / atr;
    features['signal.targetDistanceAtr'] = Math.abs(price - target) / atr;
  }
  let geometryStatus: JevInput['geometryStatus'] = 'absent';
  const figures = signal.figures;
  const groups = [figures?.lines, figures?.points, figures?.zones];
  const points = [
    ...(figures?.trendLine?.points ?? []),
    ...(figures?.trendLine?.touches ?? []),
    ...groups.flatMap((group) =>
      Array.isArray(group)
        ? group.flatMap((item) =>
            'points' in item
              ? item.points
              : 'start' in item
                ? [item.start, item.end]
                : [],
          )
        : [],
    ),
  ];
  if (
    points.length > 128 ||
    groups.some(
      (group) => group && (!Array.isArray(group) || group.length > 24),
    ) ||
    points.some(
      (point) =>
        !Number.isFinite(point.timestamp) ||
        !Number.isFinite(point.value) ||
        point.timestamp > signal.timestamp ||
        (object(point).knownAt != null &&
          (!Number.isFinite(object(point).knownAt) ||
            Number(object(point).knownAt) > signal.timestamp)),
    )
  )
    geometryStatus = 'invalid';
  else if (points.length) geometryStatus = 'available';
  if (evidence) {
    if (
      typeof evidence !== 'object' ||
      Array.isArray(evidence) ||
      !evidence.facts ||
      typeof evidence.facts !== 'object' ||
      Array.isArray(evidence.facts) ||
      (evidence.geometry != null &&
        (typeof evidence.geometry !== 'object' ||
          Array.isArray(evidence.geometry)))
    )
      throw new Error('Invalid Jev evidence');
    if (
      !/^[a-zA-Z0-9._-]{1,40}$/.test(evidence.version) ||
      !Number.isFinite(evidence.knownAt) ||
      evidence.knownAt > signal.timestamp ||
      Object.keys(evidence.facts ?? {}).length > 16 ||
      Object.keys(evidence.geometry ?? {}).length > 16
    )
      throw new Error('Invalid or oversized Jev evidence');
    put('setup.version', evidence.version);
    for (const [key, value] of Object.entries(evidence.facts)) {
      if (
        !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key) ||
        /^(?:profit|pnl|outcome|label|score|scores|quality|verdict|approval|decision|result)$/i.test(
          key,
        )
      )
        throw new Error('Invalid Jev evidence key');
      put(`setup.${key}`, value);
    }
    for (const [key, value] of Object.entries(evidence.geometry ?? {})) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key))
        throw new Error('Invalid Jev geometry key');
      put(`geometry.${key}`, value);
    }
  }
  const questions: JevDimension[] = [];
  if (
    features['market.trendBias'] != null ||
    features['market.swingBias'] != null ||
    (evidence?.facts && Object.keys(evidence.facts).length)
  )
    questions.push('structure');
  if (
    features['market.volumeRel20'] != null ||
    features['market.deltaPct'] != null
  )
    questions.push('participation');
  if (
    features['market.fastMaDistanceAtr'] != null ||
    evidence?.facts?.entryExtensionAtr != null
  )
    questions.push('timing');
  if (
    evidence?.geometry &&
    Object.keys(evidence.geometry).length &&
    geometryStatus === 'absent'
  )
    geometryStatus = 'available';
  if (
    geometryStatus === 'available' &&
    evidence?.geometry &&
    Object.keys(evidence.geometry).length
  )
    questions.push('geometry');
  if (
    Object.keys(features).length > 40 ||
    JSON.stringify(features).length > 4000
  )
    throw new Error('Jev input exceeds the microdecision budget');
  return {
    schema: 'tradejs-jev-input/v2',
    strategy: signal.strategy,
    symbol: signal.symbol,
    interval: String(signal.interval),
    timestamp: signal.timestamp,
    direction: signal.direction as 'LONG' | 'SHORT',
    features,
    questions,
    geometryStatus,
  };
};

const criteria = (subject: string) => [
  `${subject} is clearly contradicted by the supplied facts.`,
  `${subject} has a material conflict.`,
  `${subject} is uncertain from the supplied facts.`,
  `${subject} has adequate support.`,
  `${subject} has strong support without a material conflict.`,
];

export const JEV_QUESTIONS = {
  structure: {
    type: 'score',
    instructions:
      'Do the supplied trend, swing and setup facts support this signal direction? Use only these facts; do not predict returns or assume missing evidence.',
    criteria: criteria('Directional structure'),
  },
  participation: {
    type: 'score',
    instructions:
      'Does the supplied target-asset volume or delta support this signal direction? Do not infer missing flow.',
    criteria: criteria('Target-asset participation'),
  },
  timing: {
    type: 'score',
    instructions:
      'Do the supplied entry-extension facts indicate a timely entry rather than excessive extension? Do not do arithmetic or infer missing facts.',
    criteria: criteria('Entry timing'),
  },
  geometry: {
    type: 'score',
    instructions:
      'Do the supplied strategy-defined geometry facts support this signal? Do not infer unseen points or certify mathematical validity.',
    criteria: criteria('Setup geometry'),
  },
} as const;

export const questionsForJevInput = (input: JevInput) =>
  Object.fromEntries(input.questions.map((key) => [key, JEV_QUESTIONS[key]]));

/** Signal identity stays in the recording, never in the paid decision state. */
export const stateForJevInput = (input: JevInput) => ({
  schema: input.schema,
  strategy: input.strategy,
  direction: input.direction,
  facts: input.features,
});
