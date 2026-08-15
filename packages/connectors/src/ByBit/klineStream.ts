import { WebsocketClient, WSKlineEventV5, WSKlineV5 } from 'bybit-api';
import { formatUnix } from '@tradejs/core/time';
import type {
  ConnectorConfig,
  ConnectorRuntime,
  Interval,
  KlineChartItem,
} from '@tradejs/types';
import {
  getConnectorAccountResolver,
  getConnectorLogger,
} from '../shared/runtime';

const CATEGORY = 'linear' as const;
const SUBSCRIPTION_BATCH_SIZE = 100;
const KLINE_TOPIC_PATTERN = /^kline\.([^.]+)\.(.+)$/;

export type BybitKlineStreamEvent = {
  symbol: string;
  interval: Interval;
  candle: KlineChartItem;
  confirm: boolean;
  receivedAt: number;
};

export interface BybitKlineStream {
  setSubscriptions: (symbols: readonly string[], interval: Interval) => void;
  close: () => Promise<void>;
}

type WebsocketClientLike = Pick<
  WebsocketClient,
  'on' | 'subscribeV5' | 'unsubscribeV5' | 'closeAll'
>;

const chunk = <T>(items: T[], size: number) => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

const normalizeSymbols = (symbols: readonly string[]) =>
  [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()))].filter(
    Boolean,
  );

export const buildBybitKlineTopic = (symbol: string, interval: Interval) =>
  `kline.${interval}.${symbol.trim().toUpperCase()}` as const;

export const parseBybitKlineEvent = (
  value: unknown,
  receivedAt = Date.now(),
): BybitKlineStreamEvent[] => {
  if (!value || typeof value !== 'object') return [];
  const event = value as Partial<WSKlineEventV5>;
  const match = String(event.topic ?? '').match(KLINE_TOPIC_PATTERN);
  if (!match || !Array.isArray(event.data)) return [];

  const [, interval, symbol] = match;
  return event.data.flatMap((raw) => {
    const row = raw as WSKlineV5;
    const timestamp = Number(row.start);
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    const volume = Number(row.volume);
    const turnover = Number(row.turnover);
    if (
      ![timestamp, open, high, low, close, volume, turnover].every(
        Number.isFinite,
      ) ||
      timestamp < 0 ||
      high < Math.max(open, close) ||
      low > Math.min(open, close)
    ) {
      return [];
    }

    return [
      {
        symbol: symbol.toUpperCase(),
        interval: interval as Interval,
        candle: {
          dt: formatUnix(timestamp),
          timestamp,
          open,
          high,
          low,
          close,
          volume,
          turnover,
        },
        confirm: Boolean(row.confirm),
        receivedAt,
      },
    ];
  });
};

export const createBybitKlineStreamWithClient = ({
  client,
  onEvent,
  logger = getConnectorLogger(),
}: {
  client: WebsocketClientLike;
  onEvent: (event: BybitKlineStreamEvent) => Promise<void> | void;
  logger?: ReturnType<typeof getConnectorLogger>;
}): BybitKlineStream => {
  let topics = new Set<ReturnType<typeof buildBybitKlineTopic>>();
  let closed = false;

  client.on('update', (value) => {
    for (const event of parseBybitKlineEvent(value)) {
      void Promise.resolve(onEvent(event)).catch((error) => {
        logger.error('Bybit kline stream handler failed: %s', String(error));
      });
    }
  });
  client.on('reconnected', ({ wsKey }) => {
    logger.info('Bybit kline stream reconnected: %s', wsKey);
  });
  client.on('exception', (error) => {
    logger.error('Bybit kline stream exception: %s', String(error));
  });

  return {
    setSubscriptions: (symbols, interval) => {
      if (closed) return;
      const nextTopics = new Set(
        normalizeSymbols(symbols).map((symbol) =>
          buildBybitKlineTopic(symbol, interval),
        ),
      );
      const added = [...nextTopics].filter((topic) => !topics.has(topic));
      const removed = [...topics].filter((topic) => !nextTopics.has(topic));

      for (const batch of chunk(removed, SUBSCRIPTION_BATCH_SIZE)) {
        void Promise.all(client.unsubscribeV5(batch as any, CATEGORY)).catch(
          (error) =>
            logger.error('Bybit kline unsubscribe failed: %s', String(error)),
        );
      }
      for (const batch of chunk(added, SUBSCRIPTION_BATCH_SIZE)) {
        void Promise.all(client.subscribeV5(batch as any, CATEGORY)).catch(
          (error) =>
            logger.error('Bybit kline subscribe failed: %s', String(error)),
        );
      }
      topics = nextTopics;
      logger.info(
        'Bybit kline stream subscriptions: topics=%s added=%s removed=%s',
        topics.size,
        added.length,
        removed.length,
      );
    },
    close: async () => {
      if (closed) return;
      closed = true;
      const currentTopics = [...topics];
      topics.clear();
      for (const batch of chunk(currentTopics, SUBSCRIPTION_BATCH_SIZE)) {
        await Promise.allSettled(client.unsubscribeV5(batch as any, CATEGORY));
      }
      client.closeAll();
    },
  };
};

export const createBybitKlineStream = async ({
  config,
  onEvent,
  runtime,
}: {
  config: ConnectorConfig;
  onEvent: (event: BybitKlineStreamEvent) => Promise<void> | void;
  runtime?: ConnectorRuntime;
}): Promise<BybitKlineStream> => {
  const resolveTradingAccount = getConnectorAccountResolver(runtime);
  const account = config.accountId
    ? await resolveTradingAccount({
        userName: config.userName,
        accountId: config.accountId,
        provider: 'bybit',
        universe: config.universe,
      })
    : null;
  const client = new WebsocketClient({
    testnet: account?.environment === 'testnet',
    reconnectTimeout: Math.max(
      500,
      Number(process.env.BYBIT_WS_RECONNECT_TIMEOUT_MS ?? 1_000),
    ),
  });
  return createBybitKlineStreamWithClient({
    client,
    onEvent,
    logger: getConnectorLogger(runtime),
  });
};
