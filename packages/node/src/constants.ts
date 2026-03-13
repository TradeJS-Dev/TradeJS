const { NODE_ENV } = process.env;

export const KLINE_CONCURRENCY_LIMIT = NODE_ENV === 'production' ? 5 : 10;
export const TG_CONCURRENCY_LIMIT = 3;
export const AI_CONCURRENCY_LIMIT = 3;
export const SCREENSHOT_CONCURRENCY_LIMIT = NODE_ENV === 'production' ? 1 : 2;
