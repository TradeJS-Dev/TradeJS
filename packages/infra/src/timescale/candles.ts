import type { KlineChartData } from '@tradejs/types';
import { logger } from '../logger';
import {
  getPool,
  normalizeCandleProvider,
  normalizeCandleSymbol,
  ensureCandlesSchema,
} from './internal';

export type CandleRow = {
  provider: string;
  symbol: string;
  interval: number;
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  turnover?: number | null;
  takerBuyBaseVolume?: number | null;
  takerBuyQuoteVolume?: number | null;
  takerSellBaseVolume?: number | null;
  takerSellQuoteVolume?: number | null;
};

const CANDLE_UPSERT_MAX_ATTEMPTS = 3;
const CANDLE_DEADLOCK_RETRY_DELAY_MS = 25;

const isPostgresDeadlock = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === '40P01';

const wait = (delayMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, delayMs));

const normalizeAndSortCandleRows = (rows: CandleRow[]): CandleRow[] =>
  rows
    .map((row) => ({
      ...row,
      provider: normalizeCandleProvider(row.provider),
      symbol: normalizeCandleSymbol(row.symbol),
    }))
    .sort(
      (left, right) =>
        left.provider.localeCompare(right.provider) ||
        left.symbol.localeCompare(right.symbol) ||
        left.interval - right.interval ||
        left.ts.getTime() - right.ts.getTime(),
    );

export const toRows = (
  provider: string,
  symbol: string,
  interval: number,
  data: KlineChartData,
): CandleRow[] => {
  const normalizedProvider = normalizeCandleProvider(provider);
  if (!normalizedProvider) {
    throw new Error('Candle provider is required');
  }
  const normalizedSymbol = normalizeCandleSymbol(symbol);

  return data.map((i) => ({
    provider: normalizedProvider,
    symbol: normalizedSymbol,
    interval,
    ts: new Date(i.timestamp), // ms -> Date
    open: i.open,
    high: i.high,
    low: i.low,
    close: i.close,
    volume: i.volume ?? null,
    turnover: i.turnover ?? null,
    takerBuyBaseVolume: i.takerBuyBaseVolume ?? null,
    takerBuyQuoteVolume: i.takerBuyQuoteVolume ?? null,
    takerSellBaseVolume: i.takerSellBaseVolume ?? null,
    takerSellQuoteVolume: i.takerSellQuoteVolume ?? null,
  }));
};

export async function upsertCandles(rows: CandleRow[]) {
  if (!rows.length) return;
  await ensureCandlesSchema();
  const pool = getPool();
  const normalizedRows = normalizeAndSortCandleRows(rows);

  const cols = [
    'provider',
    'symbol',
    'interval',
    'ts',
    'open',
    'high',
    'low',
    'close',
    'volume',
    'turnover',
    'taker_buy_base_volume',
    'taker_buy_quote_volume',
    'taker_sell_base_volume',
    'taker_sell_quote_volume',
  ] as const;
  const maxRows = Math.floor(65_535 / cols.length);
  for (let offset = 0; offset < normalizedRows.length; offset += maxRows) {
    const chunk = normalizedRows.slice(offset, offset + maxRows);
    const valuesSql = chunk
      .map(
        (_, i) =>
          `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(',')})`,
      )
      .join(',');
    const flat = chunk.flatMap((r) => [
      r.provider,
      r.symbol,
      r.interval,
      r.ts,
      r.open,
      r.high,
      r.low,
      r.close,
      r.volume ?? null,
      r.turnover ?? null,
      r.takerBuyBaseVolume ?? null,
      r.takerBuyQuoteVolume ?? null,
      r.takerSellBaseVolume ?? null,
      r.takerSellQuoteVolume ?? null,
    ]);
    const sql = `
    INSERT INTO candles (${cols.join(',')})
    VALUES ${valuesSql}
    ON CONFLICT (provider, symbol, interval, ts) DO UPDATE SET
      open = EXCLUDED.open,
      high = EXCLUDED.high,
      low  = EXCLUDED.low,
      close = EXCLUDED.close,
      volume = COALESCE(EXCLUDED.volume, candles.volume),
      turnover = COALESCE(EXCLUDED.turnover, candles.turnover),
      taker_buy_base_volume = COALESCE(EXCLUDED.taker_buy_base_volume, candles.taker_buy_base_volume),
      taker_buy_quote_volume = COALESCE(EXCLUDED.taker_buy_quote_volume, candles.taker_buy_quote_volume),
      taker_sell_base_volume = COALESCE(EXCLUDED.taker_sell_base_volume, candles.taker_sell_base_volume),
      taker_sell_quote_volume = COALESCE(EXCLUDED.taker_sell_quote_volume, candles.taker_sell_quote_volume)
  `;

    for (let attempt = 1; attempt <= CANDLE_UPSERT_MAX_ATTEMPTS; attempt += 1) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql, flat);
        await client.query('COMMIT');
        break;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (
          !isPostgresDeadlock(error) ||
          attempt === CANDLE_UPSERT_MAX_ATTEMPTS
        ) {
          throw error;
        }
        logger.warn(
          'candle upsert deadlock (40P01); retrying transaction (attempt=%s/%s rows=%s)',
          attempt + 1,
          CANDLE_UPSERT_MAX_ATTEMPTS,
          chunk.length,
        );
      } finally {
        client.release();
      }

      await wait(CANDLE_DEADLOCK_RETRY_DELAY_MS * 2 ** (attempt - 1));
    }
  }
}

export async function getCandlesRange(
  provider: string,
  symbol: string,
  interval: number,
  startMs: number,
  endMs: number,
) {
  await ensureCandlesSchema();
  const pool = getPool();
  const normalizedProvider = normalizeCandleProvider(provider);
  const normalizedSymbol = normalizeCandleSymbol(symbol);
  const sql = `
    SELECT symbol, interval, ts,
           open, high, low, close, volume, turnover,
           taker_buy_base_volume AS "takerBuyBaseVolume",
           taker_buy_quote_volume AS "takerBuyQuoteVolume",
           taker_sell_base_volume AS "takerSellBaseVolume",
           taker_sell_quote_volume AS "takerSellQuoteVolume"
    FROM candles
    WHERE provider = $1 AND symbol = $2 AND interval = $3
      AND ts >= to_timestamp($4/1000.0)
      AND ts <= to_timestamp($5/1000.0)
    ORDER BY ts ASC
  `;
  const res = await pool.query(sql, [
    normalizedProvider,
    normalizedSymbol,
    interval,
    startMs,
    endMs,
  ]);
  return res.rows;
}

export async function getDataEdges(
  provider: string,
  symbol: string,
  interval: number,
) {
  await ensureCandlesSchema();
  const pool = getPool();
  const normalizedProvider = normalizeCandleProvider(provider);
  const normalizedSymbol = normalizeCandleSymbol(symbol);
  const sqlMin = `
    SELECT extract(epoch from ts)*1000 AS ms
    FROM candles
    WHERE provider=$1 AND symbol=$2 AND interval=$3
    ORDER BY ts ASC
    LIMIT 1
  `;
  const sqlMax = `
    SELECT extract(epoch from ts)*1000 AS ms
    FROM candles
    WHERE provider=$1 AND symbol=$2 AND interval=$3
    ORDER BY ts DESC
    LIMIT 1
  `;
  const [minQ, maxQ] = await Promise.all([
    pool.query(sqlMin, [normalizedProvider, normalizedSymbol, interval]),
    pool.query(sqlMax, [normalizedProvider, normalizedSymbol, interval]),
  ]);
  const minRaw = minQ.rows[0]?.ms as number | string | undefined;
  const maxRaw = maxQ.rows[0]?.ms as number | string | undefined;
  const min = Number.isFinite(Number(minRaw)) ? Number(minRaw) : undefined;
  const max = Number.isFinite(Number(maxRaw)) ? Number(maxRaw) : undefined;
  return { min, max };
}

export async function getDataEdgesForSymbols(
  provider: string,
  symbols: string[],
  interval: number,
): Promise<Map<string, { min?: number; max?: number }>> {
  const normalizedSymbols = [
    ...new Set(symbols.map(normalizeCandleSymbol).filter(Boolean)),
  ];
  const result = new Map<string, { min?: number; max?: number }>();

  for (const symbol of normalizedSymbols) {
    result.set(symbol, {});
  }

  if (!normalizedSymbols.length) {
    return result;
  }

  await ensureCandlesSchema();
  const pool = getPool();
  const normalizedProvider = normalizeCandleProvider(provider);
  const sql = `
    WITH requested(symbol) AS (
      SELECT unnest($2::text[])
    )
    SELECT
      r.symbol,
      (
        SELECT extract(epoch from c.ts)*1000
        FROM candles c
        WHERE c.provider = $1 AND c.symbol = r.symbol AND c.interval = $3
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS min_ms,
      (
        SELECT extract(epoch from c.ts)*1000
        FROM candles c
        WHERE c.provider = $1 AND c.symbol = r.symbol AND c.interval = $3
        ORDER BY c.ts DESC
        LIMIT 1
      ) AS max_ms
    FROM requested r
  `;

  const response = await pool.query(sql, [
    normalizedProvider,
    normalizedSymbols,
    interval,
  ]);

  for (const row of response.rows) {
    const symbol = normalizeCandleSymbol(String(row.symbol || ''));
    if (!symbol) continue;

    const min = row.min_ms == null ? NaN : Number(row.min_ms);
    const max = row.max_ms == null ? NaN : Number(row.max_ms);
    result.set(symbol, {
      ...(Number.isFinite(min) ? { min } : {}),
      ...(Number.isFinite(max) ? { max } : {}),
    });
  }

  return result;
}

export async function waitForDbReady(
  attempts = 20,
  delayMs = 1_000,
): Promise<void> {
  const pool = getPool();
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw lastError;
}

export async function deleteCandles(
  provider: string,
  symbol: string,
  interval: number,
) {
  const pool = getPool();
  const normalizedProvider = normalizeCandleProvider(provider);
  const normalizedSymbol = normalizeCandleSymbol(symbol);
  const sql = `
    DELETE FROM candles
    WHERE provider = $1 AND symbol = $2 AND interval = $3
  `;
  await pool.query(sql, [normalizedProvider, normalizedSymbol, interval]);
}

export async function findContinuityGap(
  provider: string,
  symbol: string,
  interval: number,
) {
  const pool = getPool();
  const normalizedProvider = normalizeCandleProvider(provider);
  const normalizedSymbol = normalizeCandleSymbol(symbol);
  const expectedSeconds = interval * 60;
  const sql = `
    WITH ordered AS (
      SELECT
        ts,
        LAG(ts) OVER (ORDER BY ts) AS prev_ts
      FROM candles
      WHERE provider = $1 AND symbol = $2 AND interval = $3
    )
    SELECT
      ts,
      prev_ts,
      EXTRACT(EPOCH FROM (ts - prev_ts))::int AS diff_seconds
    FROM ordered
    WHERE prev_ts IS NOT NULL
      AND EXTRACT(EPOCH FROM (ts - prev_ts))::int <> $4
    ORDER BY ts ASC
    LIMIT 1
  `;
  const res = await pool.query(sql, [
    normalizedProvider,
    normalizedSymbol,
    interval,
    expectedSeconds,
  ]);
  const row = res.rows[0];
  if (!row) return null;
  return {
    ts: new Date(row.ts).getTime(),
    prevTs: new Date(row.prev_ts).getTime(),
    diffSeconds: row.diff_seconds as number,
  };
}
