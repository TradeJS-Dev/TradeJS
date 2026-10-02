import type {
  JevFeature,
  JevFactProvenance,
  JevInput,
  Signal,
  JevScoreQuestion,
} from '@tradejs/types';
import { intervalToMs } from '@tradejs/core/data';
import { JEV_DIMENSIONS, JEV_QUESTION_SET } from '@tradejs/core/jev';

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
  if (!baseProblem) {
    const open = finite(at(base, 'candle', 'open'));
    const close = finite(at(base, 'candle', 'close'));
    const high = finite(at(base, 'candle', 'high'));
    const low = finite(at(base, 'candle', 'low'));
    const sign = signal.direction === 'LONG' ? 1 : -1;
    const candleFact = {
      knownAt: baseKnownAt!,
      scope: 'target' as const,
      source: 'baseContext.candle',
    };
    if (open != null && close != null && atr != null && atr > 0)
      put('entry.directionalBodyAtr', (sign * (close - open)) / atr, {
        ...candleFact,
        unit: 'ATR',
      });
    if (
      high != null &&
      low != null &&
      close != null &&
      high > low &&
      close >= low &&
      close <= high
    ) {
      put(
        'entry.directionalCloseLocation',
        signal.direction === 'LONG'
          ? (close - low) / (high - low)
          : (high - close) / (high - low),
        { ...candleFact, unit: 'ratio' },
      );
      if (atr != null && atr > 0)
        put('entry.rangeAtr', (high - low) / atr, {
          ...candleFact,
          unit: 'ATR',
        });
    }
  }
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
  const has = (key: string) => key in features;
  const setupKeys = Object.keys(features).filter((key) =>
    key.startsWith('setup.'),
  );
  const questions = JEV_DIMENSIONS.filter((dimension) => {
    switch (dimension) {
      case 'signalStrength':
        return has('signal.validLevels');
      case 'trend':
        return has('market.trendBias');
      case 'swing':
        return has('setup.retracementRatio');
      case 'participation':
        return has('market.volumeRel20');
      case 'setupParticipation':
        return setupKeys.some((key) =>
          /volume|delta|flow|liquidity|turnover/i.test(key),
        );
      case 'extension':
        return has('setup.breakoutDistanceAtr');
      case 'confirmation':
        return (
          has('entry.directionalBodyAtr') &&
          has('entry.directionalCloseLocation')
        );
      case 'setupStrength':
        return setupKeys.some((key) => /efficiencyRatio$/i.test(key));
      case 'geometry':
        return (
          geometryStatus !== 'invalid' &&
          Object.keys(features).some((key) => key.startsWith('geometry.'))
        );
    }
  });
  return {
    questionSet: JEV_QUESTION_SET,
    schema: 'tradejs-jev-input/v4',
    strategy: signal.strategy,
    symbol: signal.symbol,
    interval: String(signal.interval),
    timestamp: signal.timestamp,
    direction: signal.direction as 'LONG' | 'SHORT',
    features,
    provenance,
    missing,
    questions,
    geometryStatus,
  };
};

const JEV_COMPONENT_QUESTIONS = {
  trend: {
    type: 'score',
    instructions:
      'Rate agreement of market.trendBias and market.swingBias with signal.direction: bull supports LONG, bear supports SHORT; neutral/unknown is inconclusive. No profit prediction.',
    criteria: [
      'Both oppose.',
      'One opposes; other inconclusive.',
      'Biases conflict, or both inconclusive.',
      'One supports; other inconclusive.',
      'Both support.',
    ],
  },
  swing: {
    type: 'score',
    instructions:
      'Rate shallow correction using only setup.retracementRatio (correction / preceding impulse). Missing is inconclusive, not favorable.',
    criteria: [
      'Exceeds impulse (>1).',
      'Deep (>0.65 to 1).',
      'Moderate (>0.4 to 0.65), or missing.',
      'Contained (>0.2 to 0.4).',
      'Shallow (0 to 0.2).',
    ],
  },
  participation: {
    type: 'score',
    instructions:
      'Rate activity using only market.volumeRel20 (candle volume / trailing 20-candle mean). Not directional flow; ignore setup volume.',
    criteria: [
      'Very low (<0.5).',
      'Below ordinary (0.5 to <0.8).',
      'Ordinary (0.8 to <1.2), or missing.',
      'Elevated (1.2 to <2).',
      'Strong expansion (>=2).',
    ],
  },
  setupParticipation: {
    type: 'score',
    instructions:
      'Rate consolidation volume contraction using a supplied setup consolidation / preceding impulse volume ratio, e.g. setup.flagToPoleVolumeRatio. Smaller means stronger contraction. Ignore current volume and directional flow; unrelated setup semantics are inconclusive.',
    criteria: [
      'Exceeds impulse (>1.2).',
      'No contraction (>0.9 to 1.2).',
      'Mild (>0.7 to 0.9), or inconclusive.',
      'Clear (>0.4 to 0.7).',
      'Strong (0 to 0.4).',
    ],
  },
  extension: {
    type: 'score',
    instructions:
      'Rate absence of entry extension using only setup.breakoutDistanceAtr (distance past setup boundary in ATR). Stop/target distances are not extension.',
    criteria: [
      'Extreme (>2 ATR).',
      'Large (>1 to 2 ATR).',
      'Moderate (>0.5 to 1 ATR), or missing.',
      'Small (>0.2 to 0.5 ATR).',
      'Near boundary (0 to 0.2 ATR).',
    ],
  },
  confirmation: {
    type: 'score',
    instructions:
      'Rate closed entry candle conviction using entry.directionalBodyAtr (signed toward signal.direction) and entry.directionalCloseLocation (1=favorable extreme). Stage names alone prove neither conviction nor breakout retention.',
    criteria: [
      'Opposing body AND unfavorable-quarter close.',
      'Opposing body OR unfavorable-half close.',
      'Small body (<0.2 ATR), mixed or missing evidence.',
      'Supporting body (>=0.2 ATR) AND favorable-half close.',
      'Strong supporting body (>=0.5 ATR) AND favorable-quarter close.',
    ],
  },
  setupStrength: {
    type: 'score',
    instructions:
      'Rate impulse persistence using only supplied setup efficiency (absolute net move / sum of absolute bar moves), e.g. setup.poleEfficiencyRatio. Exclude size, volume, correction and geometry.',
    criteria: [
      'Highly choppy (<0.2).',
      'Weak (0.2 to <0.4).',
      'Mixed (0.4 to <0.6), or missing.',
      'Clear (0.6 to <0.8).',
      'Highly persistent (0.8 to 1).',
    ],
  },
  geometry: {
    type: 'score',
    instructions:
      'Rate fitted consolidation boundaries jointly: geometry.upperR2 and lowerR2 (1=best fit), slopeDivergenceRatio (0=parallel). Use the weaker fit; exclude depth, width, volume and profit. Missing equivalent geometry is inconclusive.',
    criteria: [
      'Fit <0.5 OR divergence >0.5.',
      'Fit <0.7 OR divergence >0.3.',
      'Fit <0.85 OR divergence >0.15, or missing.',
      'Both fits >=0.85 AND divergence <=0.15.',
      'Both fits >=0.95 AND divergence <=0.05.',
    ],
  },
} as const;

export const JEV_SIGNAL_STRENGTH_QUESTION: JevScoreQuestion = {
  type: 'score',
  instructions:
    'Rate overall support for entry now from signal-time facts: direction, market, setup, candle, placement, relevant geometry and stop/target plan. No other Jev answers, future prices or outcomes. Essential missing facts and conflicts weaken support; optional missing geometry alone does not disqualify. Invalid signal.validLevels cannot rate strong. Not win probability or execution permission. Criteria 1–10 map to API indices 0–9.',
  criteria: [
    '1: Invalid levels or decisive contrary evidence.',
    '2: Severe directional/setup conflicts; poor support.',
    '3: Substantial weaknesses outweigh support.',
    '4: Some support; material weakness makes entry unattractive.',
    '5: Balanced conflicts or essential evidence missing.',
    '6: Modest coherent support; reasonable but limited evidence.',
    '7: Convincing support from several facts; remaining weakness.',
    '8: Strong coherent support, suitable placement/plan; no material conflict.',
    '9: Very strong independent support; well-defined entry/stop/target plan.',
    '10: Exceptional coherent support and plan; no visible material weakness, profit uncertain.',
  ],
};

export const JEV_QUESTIONS = {
  ...JEV_COMPONENT_QUESTIONS,
  signalStrength: JEV_SIGNAL_STRENGTH_QUESTION,
} as const;

export const questionsForJevInput = (input: JevInput) => {
  if (input.questionSet !== JEV_QUESTION_SET)
    throw new Error(
      'Unsupported Jev recording question set; rerun the backtest with --jev',
    );
  return Object.fromEntries(
    input.questions.map((key) => {
      const question = JEV_QUESTIONS[key];
      if (!question) throw new Error('Unknown Jev question');
      return [key, question];
    }),
  );
};

/** Dotted fact paths remain readable without repeating their namespace per key. */
const groupJevFields = <T>(entries: [string, T][]) => {
  const groups = new Map<string, [string, T][]>();
  const flat: [string, T | Record<string, T>][] = [];
  for (const [key, value] of entries) {
    const separator = key.indexOf('.');
    if (separator < 0) {
      flat.push([key, value]);
      continue;
    }
    const namespace = key.slice(0, separator);
    const group = groups.get(namespace) ?? [];
    group.push([key.slice(separator + 1), value]);
    groups.set(namespace, group);
  }
  return Object.fromEntries([
    ...flat,
    ...Array.from(groups, ([key, fields]) => [key, Object.fromEntries(fields)]),
  ]);
};

/** Identity and full provenance stay in the recording, never in paid state. */
export const stateForJevInput = (input: JevInput) => ({
  strategy: input.strategy,
  facts: groupJevFields(Object.entries(input.features)),
  missing: groupJevFields(Object.entries(input.missing)),
  geometryStatus: input.geometryStatus,
  units: groupJevFields(
    Object.entries(input.provenance)
      .filter(([, detail]) => detail.unit != null)
      .map(([key, detail]) => [key, detail.unit!]),
  ),
});
