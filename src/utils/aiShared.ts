export const MAX_AI_SERIES_POINTS = 5;

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
