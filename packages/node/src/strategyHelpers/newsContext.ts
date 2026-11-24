import { intervalToMs } from '@tradejs/core/data';
import { readNewsArchive } from '@tradejs/infra/timescale/client';
import { getKlineCandlesRange } from '@tradejs/infra/timescale/candles';
import type {
  BaseStrategyContextSnapshot,
  NewsContext,
  Signal,
} from '@tradejs/types';
import {
  buildNewsSnapshot,
  newsReactionWindow,
  NEWS_LOOKAHEAD,
  NEWS_PUBLICATION_LOOKBACK,
} from './newsSnapshot';

const basket = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
const cache = new Map<
  number,
  { expires: number; value: Promise<NewsContext> }
>();
const reactionCache = new Map<
  string,
  { expires: number; value: Promise<number | null> }
>();
function cached<K, V>(
  store: Map<K, { expires: number; value: Promise<V> }>,
  key: K,
  capacity: number,
  load: () => Promise<V>,
): Promise<V> {
  const now = Date.now();
  const existing = store.get(key);
  if (existing && existing.expires > now) return existing.value;
  const value = load();
  store.set(key, { expires: now + 30_000, value });
  if (store.size > capacity) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
  return value;
}

function marketSnapshot(asOf: number) {
  return cached(cache, asOf, 512, async () => {
    try {
      const archive = await readNewsArchive(
        asOf,
        asOf - NEWS_PUBLICATION_LOOKBACK,
        asOf + NEWS_LOOKAHEAD,
      );
      return buildNewsSnapshot(archive, asOf);
    } catch {
      return buildNewsSnapshot(
        { schemaVersion: 1, events: [], coverage: [] },
        asOf,
      );
    }
  });
}

async function reaction(symbol: string, before: number, after: number) {
  const bars = await getKlineCandlesRange(
    'bybit',
    symbol,
    15,
    before,
    after + 1,
  );
  const first = bars.find((b) => b.timestamp === before)?.close;
  const last = bars.find((b) => b.timestamp === after)?.close;
  return first && first > 0 && last && last > 0
    ? 100 * (last / first - 1)
    : null;
}

export async function loadNewsContext(
  asOf: number,
  symbol: string,
): Promise<NewsContext> {
  const snapshot = await marketSnapshot(asOf);
  const window = newsReactionWindow(snapshot);
  if (!window) return snapshot;
  const symbols = [...new Set([...basket, symbol])];
  const returns = new Map(
    await Promise.all(
      symbols.map(
        async (key) =>
          [
            key,
            await cached(
              reactionCache,
              `${key}:${window.before}:${window.after}`,
              4096,
              () =>
                reaction(key, window.before, window.after).catch(() => null),
            ),
          ] as const,
      ),
    ),
  );
  const btc = returns.get('BTCUSDT') ?? null;
  const target = returns.get(symbol) ?? null;
  const values = basket.map((key) => returns.get(key) ?? null);
  return {
    ...snapshot,
    features: {
      ...snapshot.features,
      reactionBtcPct: btc,
      reactionRelativePct:
        target !== null && btc !== null ? target - btc : null,
      reactionBreadth: values.every((v) => v !== null)
        ? values.filter((v) => v! > 0).length / values.length
        : null,
    },
  };
}

export function withNewsContext(
  base: BaseStrategyContextSnapshot,
  news: NewsContext,
): BaseStrategyContextSnapshot {
  const {
    news: _news,
    gateFeatures: _gateFeatures,
    ...descriptors
  } = Object.getOwnPropertyDescriptors(base);
  const clone: BaseStrategyContextSnapshot = Object.create(
    Object.getPrototypeOf(base),
    descriptors,
  );
  Object.defineProperty(clone, 'news', {
    value: news,
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(clone, 'gateFeatures', {
    value: { ...base.gateFeatures, news: news.features },
    enumerable: true,
    configurable: true,
  });
  return clone;
}

export async function enrichSignalWithNews(
  signal: Signal,
  abortSignal?: AbortSignal,
): Promise<boolean> {
  const base = signal.additionalIndicators?.baseContext;
  if (!base) return false;
  const news =
    base.news ??
    (await loadNewsContext(
      signal.timestamp + intervalToMs(signal.interval),
      signal.symbol,
    ));
  if (abortSignal?.aborted) return false;
  signal.additionalIndicators = {
    ...signal.additionalIndicators,
    baseContext: withNewsContext(base, news),
  };
  return news.status !== 'unavailable';
}
