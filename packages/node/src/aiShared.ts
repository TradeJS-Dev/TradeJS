export const MAX_AI_SERIES_POINTS = 5;

const COMPACT_INDICATORS_SNAPSHOT_SYMBOL = Symbol.for(
  'tradejs.indicators.compactSnapshot',
);
const COMPACT_INDICATORS_SNAPSHOT_KEY = '__tradejsCompactIndicatorsSnapshot';

export const trimSeriesDeep = (value: any): any => {
  if (Array.isArray(value)) {
    const trimmed = value.slice(-MAX_AI_SERIES_POINTS);
    const isMatrix = trimmed.every((item) => Array.isArray(item));

    if (isMatrix) {
      return trimmed;
    }

    return trimmed.map((item) =>
      item && typeof item === 'object' ? trimSeriesDeep(item) : item,
    );
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        trimSeriesDeep(nested),
      ]),
    );
  }

  return value;
};

export const buildCompactAiIndicatorsSnapshot = (value: any): any => {
  const compactSnapshot =
    value && typeof value === 'object'
      ? value[COMPACT_INDICATORS_SNAPSHOT_SYMBOL] ??
        value[COMPACT_INDICATORS_SNAPSHOT_KEY]
      : undefined;

  if (typeof compactSnapshot === 'function') {
    return compactSnapshot({ limit: MAX_AI_SERIES_POINTS });
  }

  return trimSeriesDeep(value);
};
