import type {
  JevConfig,
  JevDimension,
  JevFeature,
  JevScores,
  JevTree,
} from '@tradejs/types';

export const JEV_DIMENSIONS: JevDimension[] = [
  'structure',
  'participation',
  'timing',
  'geometry',
];
export const JEV_PROVIDERS = [
  {
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/alpha/decisions',
    model: 'typesafe/jev-1.13',
  },
  {
    label: 'TypeSafe',
    endpoint: 'https://api.typesafe.ai/v1/systemone',
    model: 'jev-1.13.0',
  },
] as const;

export const normalizeJevEndpoint = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
};

export const parseJevConfig = (value: unknown): JevConfig | undefined => {
  if (value == null || value === false) return undefined;
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('JEV must be a configuration object');
  const config = value as JevConfig;
  const keys = new Set([
    'source',
    'mode',
    'provider',
    'recordsDir',
    'modelFile',
    'modelSha256',
  ]);
  if (Object.keys(config).some((key) => !keys.has(key)))
    throw new Error('Unknown JEV configuration field');
  if (
    !['provider', 'recorded', 'local'].includes(config.source) ||
    config.mode !== 'observe'
  )
    throw new Error('JEV supports enrichment only (mode: observe)');
  if (
    config.provider &&
    (!normalizeJevEndpoint(config.provider.endpoint) ||
      !config.provider.model?.trim() ||
      Object.keys(config.provider).some(
        (key) => !['endpoint', 'model'].includes(key),
      ))
  )
    throw new Error('Invalid JEV provider');
  if (config.provider && /(?:latest|preview)$/i.test(config.provider.model))
    throw new Error('Pin a versioned Jev model instead of latest or preview');
  if (config.source === 'recorded' && !config.provider)
    throw new Error('Recorded Jev requires the original endpoint and model');
  if (
    config.source === 'local' &&
    (!config.modelFile || !/^[a-f0-9]{64}$/.test(config.modelSha256 ?? ''))
  )
    throw new Error('Local Jev gate requires modelFile and modelSha256');
  for (const key of ['recordsDir', 'modelFile'] as const)
    if (
      config[key] != null &&
      (typeof config[key] !== 'string' || !config[key]?.trim())
    )
      throw new Error(`Invalid JEV ${key}`);
  return {
    ...config,
    ...(config.provider
      ? {
          provider: {
            endpoint: normalizeJevEndpoint(config.provider.endpoint),
            model: config.provider.model.trim(),
          },
        }
      : {}),
  };
};

export const decideJev = (
  scores: JevScores,
  config: JevConfig,
  geometryStatus: 'available' | 'absent' | 'invalid',
  features: Record<string, JevFeature> | undefined,
  questions: JevDimension[],
) => {
  const reasons: string[] = [];
  if (features?.['signal.validLevels'] === false)
    reasons.push('INVALID_SIGNAL_LEVELS');
  if (geometryStatus === 'invalid') reasons.push('INVALID_GEOMETRY');
  if (!questions.length) reasons.push('NO_ELIGIBLE_QUESTIONS');
  if (config.requireGeometry && !questions.includes('geometry'))
    reasons.push('GEOMETRY_UNAVAILABLE');
  for (const dimension of questions) {
    const score = scores[dimension];
    if (score == null || !Number.isFinite(score))
      reasons.push(`${dimension.toUpperCase()}_UNAVAILABLE`);
    else if (score < (config.minScores?.[dimension] ?? 0.5))
      reasons.push(`${dimension.toUpperCase()}_BELOW_MIN`);
  }
  return { allowed: reasons.length === 0, reasons };
};

export const predictJevTree = (
  tree: JevTree,
  features: Record<string, JevFeature>,
): number => {
  if ('samples' in tree) return tree.value;
  const value = features[tree.feature];
  const left =
    value == null
      ? tree.missingLeft
      : tree.operator === 'lte'
        ? typeof value === 'number' && value <= (tree.value as number)
        : value === tree.value;
  return predictJevTree(left ? tree.left : tree.right, features);
};
