import { createBybitKlineStream } from '@tradejs/connectors';
import { logger } from '@tradejs/infra/logger';
import { toRows, upsertCandles } from '@tradejs/infra/timescale/candles';
import type {
  ConnectorConfig,
  Interval,
  KlineChartItem,
  MarketUniverse,
} from '@tradejs/types';
import { publishMarketKlineEvent } from '../marketData/klineEvents';

const FLUSH_DELAY_MS = 100;

export interface SignalsKlineFeed {
  setSubscriptions: (symbols: readonly string[]) => void;
  waitForClosed: (params: {
    symbols: readonly string[];
    timestamp: number;
    timeoutMs: number;
    signal?: AbortSignal;
  }) => Promise<string[]>;
  flush: () => Promise<void>;
  close: () => Promise<void>;
}

const normalizeSymbols = (symbols: readonly string[]) =>
  [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()))].filter(
    Boolean,
  );

export const createSignalsKlineFeed = async ({
  config,
  interval,
  universe,
  publish = publishMarketKlineEvent,
  persist = async (rows: Array<{ symbol: string; candle: KlineChartItem }>) => {
    const intervalMinutes = Number(interval);
    await upsertCandles(
      rows.flatMap(({ symbol, candle }) =>
        toRows('bybit', symbol, intervalMinutes, [candle]),
      ),
    );
  },
  streamFactory = createBybitKlineStream,
}: {
  config: ConnectorConfig;
  interval: Interval;
  universe: MarketUniverse;
  publish?: typeof publishMarketKlineEvent;
  persist?: (
    rows: Array<{ symbol: string; candle: KlineChartItem }>,
  ) => Promise<void>;
  streamFactory?: typeof createBybitKlineStream;
}): Promise<SignalsKlineFeed> => {
  const pending = new Map<string, { symbol: string; candle: KlineChartItem }>();
  const lastClosedTimestamp = new Map<string, number>();
  const waiters = new Set<() => void>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushPromise: Promise<void> | null = null;
  let closed = false;

  const notifyWaiters = () => {
    for (const notify of waiters) notify();
  };

  const flush = async () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (flushPromise) return flushPromise;
    const rows = [...pending.values()];
    if (!rows.length) return;
    pending.clear();
    flushPromise = persist(rows)
      .catch((error) => {
        for (const row of rows) {
          pending.set(`${row.symbol}:${row.candle.timestamp}`, row);
        }
        throw error;
      })
      .finally(() => {
        flushPromise = null;
      });
    return flushPromise;
  };

  const scheduleFlush = () => {
    if (flushTimer || closed) return;
    flushTimer = setTimeout(() => {
      void flush().catch((error) =>
        logger.error('websocket candle batch flush failed: %s', String(error)),
      );
    }, FLUSH_DELAY_MS);
  };

  const stream = await streamFactory({
    config,
    onEvent: (event) => {
      if (event.interval !== interval) return;
      void publish({
        provider: 'bybit',
        universe,
        symbol: event.symbol,
        interval,
        candle: event.candle,
        confirm: event.confirm,
        receivedAt: event.receivedAt,
      }).catch((error) =>
        logger.warn('websocket candle publish failed: %s', String(error)),
      );
      if (!event.confirm) return;
      pending.set(`${event.symbol}:${event.candle.timestamp}`, {
        symbol: event.symbol,
        candle: event.candle,
      });
      lastClosedTimestamp.set(event.symbol, event.candle.timestamp);
      scheduleFlush();
      notifyWaiters();
    },
  });

  return {
    setSubscriptions: (symbols) => {
      stream.setSubscriptions(normalizeSymbols(symbols), interval);
    },
    waitForClosed: async ({ symbols, timestamp, timeoutMs, signal }) => {
      const expected = normalizeSymbols(symbols);
      const getMissing = () =>
        expected.filter(
          (symbol) => (lastClosedTimestamp.get(symbol) ?? -1) < timestamp,
        );
      if (!getMissing().length || timeoutMs <= 0 || signal?.aborted) {
        return getMissing();
      }

      await new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        const finish = () => {
          clearTimeout(timer);
          waiters.delete(check);
          signal?.removeEventListener('abort', finish);
          resolve();
        };
        const check = () => {
          if (!getMissing().length) finish();
        };
        timer = setTimeout(finish, timeoutMs);
        waiters.add(check);
        signal?.addEventListener('abort', finish, { once: true });
      });
      return getMissing();
    },
    flush,
    close: async () => {
      if (closed) return;
      closed = true;
      await flush();
      await stream.close();
      waiters.clear();
    },
  };
};
