import { WebSocket } from 'ws';
import {
  rebuildHyperliquidWhaleFlowRows,
  upsertHyperliquidWhaleCoverageRows,
  upsertHyperliquidWhaleTradeEvents,
} from '@tradejs/infra/timescale';
import {
  getHyperliquidPerpUniverseSnapshot,
  getHyperliquidWhaleRegistrySnapshot,
} from '@tradejs/node/strategies';
import type { HyperliquidWhaleTradeEventRow } from '@tradejs/types';
import {
  HYPERLIQUID_WHALE_BUCKET_MS,
  normalizeHyperliquidUserFill,
  type HyperliquidWsTrade,
  type HyperliquidUserFill,
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

export type HyperliquidUserFillsMessage = {
  address: string;
  isSnapshot: boolean;
  fills: HyperliquidUserFill[];
};

export const parseHyperliquidUserFillsMessage = (
  raw: string,
): HyperliquidUserFillsMessage | null => {
  try {
    const message = JSON.parse(raw) as { channel?: unknown; data?: unknown };
    if (
      message.channel !== 'userFills' ||
      !message.data ||
      typeof message.data !== 'object' ||
      Array.isArray(message.data)
    ) {
      return null;
    }
    const data = message.data as {
      user?: unknown;
      isSnapshot?: unknown;
      fills?: unknown;
    };
    if (typeof data.user !== 'string' || !Array.isArray(data.fills)) {
      return null;
    }
    return {
      address: data.user,
      isSnapshot: data.isSnapshot === true,
      fills: data.fills as HyperliquidUserFill[],
    };
  } catch {
    return null;
  }
};

export const runHyperliquidWhaleStream = async (params: {
  signal: AbortSignal;
  log?: (message: string) => void;
}) => {
  const universe = getHyperliquidPerpUniverseSnapshot();
  const whales = getHyperliquidWhaleRegistrySnapshot();
  const trackedSymbols = new Set(universe.symbols);
  const identity = {
    universeFingerprint: universe.fingerprint,
    whaleRegistryFingerprint: whales.fingerprint,
  };
  const buffer: HyperliquidWhaleTradeEventRow[] = [];
  let writes = Promise.resolve();
  let streamCoverageFromMs: number | null = null;
  let streamCoverageToMs = 0;

  const flush = () => {
    if (!buffer.length) return writes;
    const batch = buffer.splice(0, buffer.length);
    writes = writes.then(() => upsertHyperliquidWhaleTradeEvents(batch));
    return writes;
  };
  const recordStreamCoverage = (toMs: number) => {
    if (streamCoverageFromMs == null) return writes;
    const fromMs = Math.max(streamCoverageFromMs, streamCoverageToMs);
    if (toMs <= fromMs) return writes;
    const rows = Array.from(
      { length: Math.floor((toMs - fromMs) / HYPERLIQUID_WHALE_BUCKET_MS) },
      (_, index) => ({
        ts: new Date(fromMs + index * HYPERLIQUID_WHALE_BUCKET_MS),
        coveredWhales: whales.addresses.length,
        expectedWhales: whales.addresses.length,
        coveragePct: 1,
        source: 'hyperliquid_user_fills_ws',
        ...identity,
      }),
    );
    streamCoverageToMs = toMs;
    writes = writes.then(() => upsertHyperliquidWhaleCoverageRows(rows));
    return writes;
  };
  const finalize = () => {
    const toMs =
      Math.floor((Date.now() - FINALIZE_LAG_MS) / HYPERLIQUID_WHALE_BUCKET_MS) *
      HYPERLIQUID_WHALE_BUCKET_MS;
    const fromMs = Math.max(0, toMs - REBUILD_LOOKBACK_MS);
    recordStreamCoverage(toMs);
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
          streamCoverageFromMs =
            Math.ceil(Date.now() / HYPERLIQUID_WHALE_BUCKET_MS) *
            HYPERLIQUID_WHALE_BUCKET_MS;
          streamCoverageToMs = streamCoverageFromMs;
          for (const address of whales.addresses) {
            ws.send(
              JSON.stringify({
                method: 'subscribe',
                subscription: { type: 'userFills', user: address },
              }),
            );
          }
          params.log?.(
            `Hyperliquid whale stream connected userFills subscriptions=${whales.addresses.length}`,
          );
        });
        ws.on('message', (data) => {
          const message = parseHyperliquidUserFillsMessage(data.toString());
          if (!message) return;
          for (const fill of message.fills) {
            const event = normalizeHyperliquidUserFill({
              fill,
              address: message.address,
              trackedSymbols,
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
          recordStreamCoverage(
            Math.floor(Date.now() / HYPERLIQUID_WHALE_BUCKET_MS) *
              HYPERLIQUID_WHALE_BUCKET_MS,
          );
          streamCoverageFromMs = null;
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
