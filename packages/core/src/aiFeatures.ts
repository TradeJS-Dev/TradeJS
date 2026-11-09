import type {
  AiFeatureDefinition,
  AiFeaturePrimitive,
  AiFeatureSnapshot,
} from '@tradejs/types';

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const outcome =
  /^(tradeResult|backtestExecution|outcome|label|future|pnl|profit|exitPrice|exitTimestamp|aiApproved|deterministicQuality|approvalAllowedNow)$/i;
const readPath = (source: unknown, path: string): unknown => {
  let value = source;
  for (const part of path.split('.')) {
    if (
      forbidden.has(part) ||
      !value ||
      typeof value !== 'object' ||
      !Object.prototype.hasOwnProperty.call(value, part)
    )
      return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
};
const primitive = (value: unknown): AiFeaturePrimitive => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  return null;
};
export const validateAiFeatureDefinitions = (
  definitions: readonly AiFeatureDefinition[],
): void => {
  if (!Array.isArray(definitions))
    throw new Error('Invalid AI feature definitions');
  const ids = new Set<string>();
  for (const d of definitions) {
    if (
      !d ||
      typeof d !== 'object' ||
      typeof d.id !== 'string' ||
      typeof d.path !== 'string' ||
      typeof d.description !== 'string' ||
      typeof d.unit !== 'string' ||
      !['input', 'data-quality', 'metadata', 'outcome', 'policy'].includes(
        d.role,
      ) ||
      !['target', 'benchmark', 'global', 'setup'].includes(d.scope) ||
      (d.source !== undefined && !['signal', 'payload'].includes(d.source)) ||
      (d.reduction !== undefined &&
        !['last', 'mean', 'min', 'max', 'count'].includes(d.reduction)) ||
      (d.divideBy !== undefined && typeof d.divideBy !== 'string')
    )
      throw new Error('Invalid AI feature definition');
    if (
      !/^[a-zA-Z][\w.-]*$/.test(d.id) ||
      ids.has(d.id) ||
      !Number.isSafeInteger(d.version) ||
      d.version < 1 ||
      !d.description.trim() ||
      !d.unit.trim()
    )
      throw new Error(`Invalid or duplicate AI feature: ${d.id}`);
    for (const path of [d.path, ...(d.divideBy ? [d.divideBy] : [])]) {
      if (!path || path.split('.').some((p: string) => !p || forbidden.has(p)))
        throw new Error(`Invalid AI feature path: ${d.id}`);
      if (
        d.role === 'input' &&
        path.split('.').some((p: string) => outcome.test(p))
      )
        throw new Error(`Outcome/policy cannot be an input: ${d.id}`);
    }
    ids.add(d.id);
  }
};

/** The same pure projection is used before export and when reconstructing a gate. */
export const projectAiFeatures = (
  definitions: readonly AiFeatureDefinition[],
  sources: { signal: unknown; payload: unknown },
): AiFeatureSnapshot => {
  validateAiFeatureDefinitions(definitions);
  const values: Record<string, AiFeaturePrimitive> = {};
  for (const d of definitions) {
    const source = sources[d.source ?? 'payload'];
    let raw = readPath(source, d.path);
    if (d.reduction) {
      if (!Array.isArray(raw)) raw = null;
      else if (d.reduction === 'count') raw = raw.length;
      else if (d.reduction === 'last') raw = raw.at(-1);
      else {
        const numbers = raw.filter(
          (v): v is number => typeof v === 'number' && Number.isFinite(v),
        );
        raw =
          numbers.length !== raw.length || !numbers.length
            ? null
            : d.reduction === 'mean'
              ? numbers.reduce((s, v) => s + v, 0) / numbers.length
              : d.reduction === 'min'
                ? numbers.reduce((a, b) => Math.min(a, b), Infinity)
                : numbers.reduce((a, b) => Math.max(a, b), -Infinity);
      }
    }
    let value = primitive(raw);
    if (d.divideBy) {
      const denominator = primitive(readPath(source, d.divideBy));
      value =
        typeof value === 'number' &&
        typeof denominator === 'number' &&
        denominator !== 0
          ? primitive(value / denominator)
          : null;
    }
    values[d.id] = value;
  }
  return { schema: 'tradejs-ai-features/v1', definitions, values };
};

const profile = (
  id: string,
  field: string,
  unit: string,
  role: AiFeatureDefinition['role'] = 'input',
  stationary = true,
): AiFeatureDefinition => ({
  id: `ticker.${id}`,
  version: 1,
  path: `additionalIndicators.tickerProfile.${field}`,
  source: 'signal',
  role,
  stationary,
  scope: 'target',
  unit,
  description: `Monthly causal ticker profile: ${field}`,
});
export const TICKER_PROFILE_AI_FEATURES: readonly AiFeatureDefinition[] = [
  profile('turnover', 'dailyTurnoverUSDT', 'USDT/day', 'input', false),
  profile('volatility', 'dailyVolatilityPct', '%/day'),
  profile('btcCorrelation', 'correlationBTC', 'correlation'),
  profile('ethCorrelation', 'correlationETH', 'correlation'),
  profile('moneyGroup', 'moneyGroup', 'category'),
  profile('volatilityGroup', 'volatilityGroup', 'category'),
  profile('btcGroup', 'btcCorrelationGroup', 'category'),
  profile('ethGroup', 'ethCorrelationGroup', 'category'),
  profile('hours', 'hours', 'hours', 'data-quality'),
  profile('returnHours', 'returnHours', 'hours', 'data-quality'),
  profile('btcPairs', 'btcAlignedHours', 'hours', 'data-quality'),
  profile('ethPairs', 'ethAlignedHours', 'hours', 'data-quality'),
  profile('asOf', 'asOf', 'UTC ms', 'metadata'),
  profile('snapshotId', 'snapshotId', 'sha256', 'metadata'),
  profile('validUntil', 'validUntil', 'UTC ms', 'metadata'),
  profile('windowStart', 'windowStart', 'UTC ms', 'metadata'),
  profile('symbol', 'symbol', 'symbol', 'metadata'),
  profile('provider', 'provider', 'provider', 'metadata'),
  profile('universeId', 'universeId', 'identity', 'metadata'),
  profile('definition', 'definition', 'version', 'metadata'),
  profile('turnoverSource', 'turnoverSource', 'source', 'data-quality'),
];

export const validateAiFeatureSnapshot = (
  snapshot: AiFeatureSnapshot,
): void => {
  if (
    !snapshot ||
    snapshot.schema !== 'tradejs-ai-features/v1' ||
    !snapshot.values ||
    typeof snapshot.values !== 'object' ||
    Array.isArray(snapshot.values)
  )
    throw new Error('Invalid AI feature snapshot');
  validateAiFeatureDefinitions(snapshot.definitions);
  if (Object.keys(snapshot.values).length !== snapshot.definitions.length)
    throw new Error('AI feature snapshot does not match definitions');
  for (const d of snapshot.definitions) {
    const v = snapshot.values[d.id];
    if (
      !Object.prototype.hasOwnProperty.call(snapshot.values, d.id) ||
      (v !== null &&
        typeof v !== 'string' &&
        typeof v !== 'boolean' &&
        !(typeof v === 'number' && Number.isFinite(v)))
    )
      throw new Error(`Invalid feature value: ${d.id}`);
  }
};

/** Frozen pre-admission state, never the result of the candidate's own decision. */
export const PORTFOLIO_AI_FEATURES: readonly AiFeatureDefinition[] = [
  ...[
    'positionCount',
    'pendingEntryCount',
    'longCount',
    'shortCount',
    'grossUnrealizedPnlR',
    'openStopRiskR',
    'largestPositionShare',
  ].map((field) => ({
    id: `portfolio.${field}`,
    version: 1,
    source: 'signal' as const,
    path: `additionalIndicators.portfolioContext.${field}`,
    role: 'input' as const,
    scope: 'global' as const,
    stationary: true,
    unit: field.endsWith('R')
      ? 'R'
      : field.endsWith('Share')
        ? 'fraction'
        : 'count',
    description: `Pre-entry portfolio ${field}`,
  })),
  ...['asOf', 'policyId', 'pricesComplete', 'unknownOwnershipCount'].map(
    (field) => ({
      id: `portfolio.${field}`,
      version: 1,
      source: 'signal' as const,
      path: `additionalIndicators.portfolioContext.${field}`,
      role:
        field === 'asOf' || field === 'policyId'
          ? ('metadata' as const)
          : ('data-quality' as const),
      scope: 'global' as const,
      stationary: false,
      unit: field === 'asOf' ? 'ms' : 'category',
      description: `Portfolio observation ${field}`,
    }),
  ),
];
