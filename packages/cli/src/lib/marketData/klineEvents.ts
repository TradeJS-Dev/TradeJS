import Redis from 'ioredis';
import { publishData } from '@tradejs/infra/redis';
import type { MarketKlineEvent } from '@tradejs/types';

export const MARKET_KLINE_CHANNEL = 'tradejs:market:kline';

const positiveInt = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const redisOptions = () => ({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: positiveInt(process.env.REDIS_PORT, 6379),
  connectTimeout: positiveInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 3_000),
  maxRetriesPerRequest: null,
  retryStrategy: (attempt: number) => Math.min(attempt * 200, 2_000),
});

export const buildMarketKlineTopic = (
  event: Pick<
    MarketKlineEvent,
    'provider' | 'universe' | 'symbol' | 'interval'
  >,
) =>
  [
    event.provider,
    event.universe,
    event.symbol.trim().toUpperCase(),
    event.interval,
  ].join(':');

export const publishMarketKlineEvent = (event: MarketKlineEvent) =>
  publishData(MARKET_KLINE_CHANNEL, event);

export const createMarketKlineSubscriber = () => new Redis(redisOptions());

export const parseMarketKlineEvent = (
  payload: string,
): MarketKlineEvent | null => {
  try {
    const event = JSON.parse(payload) as Partial<MarketKlineEvent>;
    if (
      !event ||
      typeof event.provider !== 'string' ||
      typeof event.universe !== 'string' ||
      typeof event.symbol !== 'string' ||
      typeof event.interval !== 'string' ||
      typeof event.confirm !== 'boolean' ||
      !event.candle ||
      !Number.isFinite(event.candle.timestamp)
    ) {
      return null;
    }
    return event as MarketKlineEvent;
  } catch {
    return null;
  }
};
