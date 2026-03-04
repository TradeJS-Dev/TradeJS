export const asPositiveInt = (value: unknown, fallback: number): number => {
  const next = Number(value);
  if (!Number.isFinite(next) || next <= 0) {
    return fallback;
  }
  return Math.floor(next);
};

export const asPositiveNumber = (value: unknown, fallback: number): number => {
  const next = Number(value);
  if (!Number.isFinite(next) || next <= 0) {
    return fallback;
  }
  return next;
};
