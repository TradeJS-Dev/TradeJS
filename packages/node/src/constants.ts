const { NODE_ENV } = process.env;

const getPositiveIntegerEnv = (name: string, fallback: number) => {
  const rawValue = process.env[name];
  const parsedValue = Number(rawValue);

  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback;
};

const DEFAULT_KLINE_CONCURRENCY_LIMIT = NODE_ENV === 'production' ? 2 : 10;

export const KLINE_CONCURRENCY_LIMIT = getPositiveIntegerEnv(
  'KLINE_CONCURRENCY_LIMIT',
  DEFAULT_KLINE_CONCURRENCY_LIMIT,
);
export const TG_CONCURRENCY_LIMIT = 3;
export const AI_CONCURRENCY_LIMIT = 3;
export const SCREENSHOT_CONCURRENCY_LIMIT = NODE_ENV === 'production' ? 1 : 2;
