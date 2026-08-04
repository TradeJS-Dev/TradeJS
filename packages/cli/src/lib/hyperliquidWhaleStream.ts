import { WebSocket } from 'ws';
import {
  rebuildHyperliquidWhaleFlowRows,
  upsertHyperliquidWhaleTradeEvents,
} from '@tradejs/infra/timescale';
import {
  getHyperliquidPerpUniverseSnapshot,
  getHyperliquidWhaleRegistrySnapshot,
} from '@tradejs/node/strategies';
import type { HyperliquidWhaleTradeEventRow } from '@tradejs/types';
import {
  HYPERLIQUID_WHALE_BUCKET_MS,
  normalizeHyperliquidWsTrade,
  type HyperliquidWsTrade,
} from './hyperliquidWhaleData';

const DEFAULT_WS_URL = 'wss://api.hyperliquid.xyz/ws';
const EVENT_BATCH_SIZE = 500;
const FLUSH_INTERVAL_MS = 2_000;
const FINALIZE_INTERVAL_MS = 15_000;
const FINALIZE_LAG_MS = 5_000;
const REBUILD_LOOKBACK_MS = 10 * 60_000;
const RAW_EVENT_RETENTION_MS = 48 * 60 * 60_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

export const parseHyperliquidTradesMessage = (
  raw: string,
): HyperliquidWsTrade[] => {
  try {
    const message = JSON.parse(raw) as { channel?: unknown; data?: unknown };
    return message.channel === 'trades' && Array.isArray(message.data)
      ? (message.data as HyperliquidWsTrade[])
      : [];
  } catch {
    return [];
  }
};

export const runHyperliquidWhaleStream = async (params: {
  signal: AbortSignal;
  log?: (message: string) => void;
}) => {
  const universe = getHyperliquidPerpUniverseSnapshot();
  const whales = getHyperliquidWhaleRegistrySnapshot();
  const trackedSymbols = new Set(universe.symbols);
  const trackedWhales = new Set(whales.addresses);
  const identity = {
    universeFingerprint: universe.fingerprint,
    whaleRegistryFingerprint: whales.fingerprint,
  };
  const buffer: HyperliquidWhaleTradeEventRow[] = [];
  let writes = Promise.resolve();

  const flush = () => {
    if (!buffer.length) return writes;
    const batch = buffer.splice(0, buffer.length);
    writes = writes.then(() => upsertHyperliquidWhaleTradeEvents(batch));
    return writes;
  };
  const finalize = () => {
    const toMs =
      Math.floor((Date.now() - FINALIZE_LAG_MS) / HYPERLIQUID_WHALE_BUCKET_MS) *
      HYPERLIQUID_WHALE_BUCKET_MS;
    const fromMs = Math.max(0, toMs - REBUILD_LOOKBACK_MS);
    writes = writes.then(() =>
      rebuildHyperliquidWhaleFlowRows({
        fromMs,
        toMs,
        deleteEventsBeforeMs: toMs - RAW_EVENT_RETENTION_MS,
        ...identity,
      }).then((buckets) => {
        params.log?.(`Hyperliquid whale-flow finalized buckets=${buckets}`);
      }),
    );
    return writes;
  };

  const flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  const finalizeTimer = setInterval(
    () => void flush().then(finalize),
    FINALIZE_INTERVAL_MS,
  );
  let reconnectDelayMs = 1_000;

  try {
    while (!params.signal.aborted) {
      await new Promise<void>((resolve) => {
        const ws = new WebSocket(
          process.env.HYPERLIQUID_WS_URL?.trim() || DEFAULT_WS_URL,
        );
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ method: 'ping' }));
          }
        }, 30_000);
        const close = () => {
          clearInterval(pingTimer);
          if (ws.readyState === WebSocket.OPEN) ws.close();
          else if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
          finish();
        };
        params.signal.addEventListener('abort', close, { once: true });
        ws.on('open', () => {
          reconnectDelayMs = 1_000;
          for (const coin of universe.symbols) {
            ws.send(
              JSON.stringify({
                method: 'subscribe',
                subscription: { type: 'trades', coin },
              }),
            );
          }
          params.log?.(
            `Hyperliquid whale stream connected subscriptions=${universe.symbols.length}`,
          );
        });
        ws.on('message', (data) => {
          for (const trade of parseHyperliquidTradesMessage(data.toString())) {
            const event = normalizeHyperliquidWsTrade({
              trade,
              trackedSymbols,
              trackedWhales,
              identity,
            });
            if (event) buffer.push(event);
          }
          if (buffer.length >= EVENT_BATCH_SIZE) void flush();
        });
        ws.on('error', (error) => {
          params.log?.(`Hyperliquid whale stream error: ${String(error)}`);
          close();
        });
        ws.on('close', () => {
          clearInterval(pingTimer);
          params.signal.removeEventListener('abort', close);
          finish();
        });
      });
      if (!params.signal.aborted) {
        await sleep(reconnectDelayMs, params.signal);
        reconnectDelayMs = Math.min(30_000, reconnectDelayMs * 2);
      }
    }
  } finally {
    clearInterval(flushTimer);
    clearInterval(finalizeTimer);
    await flush();
    await finalize();
  }
};
