export const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const normalizePositiveNumber = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? value : fallback;
