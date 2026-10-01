import type {
  JevFeature,
  JevFactProvenance,
  JevInput,
  Signal,
} from '@tradejs/types';
import { intervalToMs } from '@tradejs/core/data';
import { JEV_DIMENSIONS } from '@tradejs/core/jev';

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
  const baseTimestamp = at(base, 'candle', 'timestamp');
  const baseKnownAt = finite(baseTimestamp);
  const baseProblem = !Object.keys(base).length
    ? 'no_base_context'
    : baseKnownAt == null
      ? 'missing_timestamp'
      : baseKnownAt > signal.timestamp
        ? 'future'
        : signal.timestamp - baseKnownAt > intervalToMs(signal.interval)
          ? 'stale'
          : null;
  const evidence = signal.jevEvidence;
  const features: Record<string, JevFeature> = {};
  const provenance: Record<string, JevFactProvenance> = {};
  const missing: Record<string, string> = {};
  const put = (
    key: string,
    value: unknown,
    details: JevFactProvenance,
    missingReason = 'missing_value',
  ) => {
    const normalized = fact(value);
    if (normalized != null) {
      features[key] = normalized;
      provenance[key] = details;
    } else {
      missing[key] = missingReason;
    }
  };
  const signalFact = {
    knownAt: signal.timestamp,
    scope: 'target' as const,
    source: 'signal',
  };
  put('signal.direction', signal.direction, signalFact);
  const marketKeys = [
    'market.trendBias',
    'market.swingBias',
    'market.volumeRel20',
    'market.deltaPct',
    'market.fastMaDistanceAtr',
  ];
  if (baseProblem) {
    for (const key of marketKeys) missing[key] = baseProblem;
  } else {
    const marketFact = {
      knownAt: baseKnownAt!,
      scope: 'target' as const,
      source: 'baseContext',
    };
    put('market.trendBias', at(base, 'regime', 'trend', 'bias'), marketFact);
    put('market.swingBias', at(base, 'structure', 'swing', 'bias'), marketFact);
    put(
      'market.volumeRel20',
      at(base, 'participation', 'volume', 'volumeRel20'),
      { ...marketFact, unit: 'ratio' },
    );
    const deltaSource = at(base, 'participation', 'delta', 'source');
    put(
      'market.deltaPct',
      at(base, 'participation', 'delta', 'deltaPct'),
      {
        ...marketFact,
        source:
          typeof deltaSource === 'string'
            ? `baseContext.participation.delta.${deltaSource}`
            : 'baseContext.participation.delta',
        unit: 'ratio',
      },
      deltaSource === 'ohlcv_proxy'
        ? 'ohlcv_proxy_no_taker_volume'
        : 'missing_value',
    );
    put(
      'market.fastMaDistanceAtr',
      at(base, 'regime', 'trend', 'priceDistanceToMaFastAtr'),
      { ...marketFact, unit: 'ATR' },
    );
  }
  const price = finite(signal.prices.currentPrice);
  const stop = finite(signal.prices.stopLossPrice);
  const target = finite(signal.prices.takeProfitPrice);
  const atr = baseProblem ? null : finite(at(base, 'raw', 'volatility', 'atr'));
  if (price == null || stop == null || target == null)
    throw new Error('Invalid Jev signal prices');
  put(
    'signal.validLevels',
    signal.direction === 'LONG'
      ? stop < price && price < target
      : target < price && price < stop,
    signalFact,
  );
  if (atr != null && atr > 0) {
    put('signal.stopDistanceAtr', Math.abs(price - stop) / atr, {
      ...signalFact,
      unit: 'ATR',
    });
    put('signal.targetDistanceAtr', Math.abs(price - target) / atr, {
      ...signalFact,
      unit: 'ATR',
    });
  } else {
    missing['signal.stopDistanceAtr'] = baseProblem ?? 'missing_atr';
    missing['signal.targetDistanceAtr'] = baseProblem ?? 'missing_atr';
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
    const strategyFact: JevFactProvenance = {
      knownAt: evidence.knownAt,
      scope: 'strategy' as const,
      source: 'strategy.jevEvidence',
    };
    const detailFor = (key: string): JevFactProvenance => {
      const detail: JevFactProvenance =
        evidence.factDetails?.[key] ?? strategyFact;
      if (
        !Number.isFinite(detail.knownAt) ||
        detail.knownAt > signal.timestamp ||
        !['target', 'strategy'].includes(detail.scope) ||
        (detail.unit != null &&
          !/^[a-zA-Z0-9%._/-]{1,20}$/.test(detail.unit)) ||
        (detail.source != null &&
          !/^[a-zA-Z0-9._/-]{1,60}$/.test(detail.source))
      )
        throw new Error('Invalid Jev fact provenance');
      return { ...strategyFact, ...detail };
    };
    put('setup.version', evidence.version, strategyFact);
    for (const [key, value] of Object.entries(evidence.facts)) {
      if (
        !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key) ||
        /^(?:profit|pnl|outcome|label|score|scores|quality|verdict|approval|decision|result)$/i.test(
          key,
        )
      )
        throw new Error('Invalid Jev evidence key');
      put(`setup.${key}`, value, detailFor(`setup.${key}`));
    }
    for (const [key, value] of Object.entries(evidence.geometry ?? {})) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key))
        throw new Error('Invalid Jev geometry key');
      put(`geometry.${key}`, value, detailFor(`geometry.${key}`));
    }
    if (
      Object.keys(evidence.factDetails ?? {}).some(
        (key) => !(key in provenance),
      )
    )
      throw new Error('Jev provenance references an unavailable fact');
  }
  if (
    evidence?.geometry &&
    Object.keys(evidence.geometry).length &&
    geometryStatus === 'absent'
  )
    geometryStatus = 'facts_only';
  if (geometryStatus === 'absent') missing['geometry.figures'] = 'no_geometry';
  if (geometryStatus === 'invalid')
    missing['geometry.figures'] = 'invalid_geometry';
  if (
    Object.keys(features).length > 40 ||
    JSON.stringify(features).length > 4000
  )
    throw new Error('Jev input exceeds the microdecision budget');
  return {
    schema: 'tradejs-jev-input/v4',
    strategy: signal.strategy,
    symbol: signal.symbol,
    interval: String(signal.interval),
    timestamp: signal.timestamp,
    direction: signal.direction as 'LONG' | 'SHORT',
    features,
    provenance,
    missing,
    questions: [...JEV_DIMENSIONS],
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
  missing: input.missing,
  geometryStatus: input.geometryStatus,
  units: Object.fromEntries(
    Object.entries(input.provenance)
      .filter(([, detail]) => detail.unit != null)
      .map(([key, detail]) => [key, detail.unit]),
  ),
  sources: Object.fromEntries(
    Object.entries(input.provenance)
      .filter(([, detail]) => detail.source != null)
      .map(([key, detail]) => [key, detail.source]),
  ),
});
