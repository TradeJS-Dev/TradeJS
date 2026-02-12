import 'dotenv/config';
import { Pool } from 'pg';
import { KlineChartData } from '@types';

declare global {
  // чтобы Next.js не создавал пул на каждый HMR
  // eslint-disable-next-line no-var
  var __pgPool__: Pool | undefined;
}

const getPool = () => {
  if (!global.__pgPool__) {
    global.__pgPool__ = new Pool({
      host: process.env.PG_HOST,
      port: Number(process.env.PG_PORT ?? 5432),
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DATABASE,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return global.__pgPool__;
};

export type CandleRow = {
  symbol: string;
  interval: number;
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  turnover?: number | null;
};

export type DerivativesInterval = '15m' | '1h';

export type DerivativesRow = {
  symbol: string;
  interval: DerivativesInterval;
  ts: Date;
  openInterest?: number | null;
  fundingRate?: number | null;
  liqLong?: number | null;
  liqShort?: number | null;
  liqTotal?: number | null;
  source?: string | null;
};

export type SpreadRow = {
  symbol: string;
  interval: DerivativesInterval;
  ts: Date;
  binancePrice?: number | null;
  coinbasePrice?: number | null;
  spread?: number | null;
  source?: string | null;
};

let derivativesSchemaReady = false;
let spreadSchemaReady = false;

export const toRows = (
  symbol: string,
  interval: number,
  data: KlineChartData,
): CandleRow[] =>
  data.map((i) => ({
    symbol,
    interval,
    ts: new Date(i.timestamp), // ms -> Date
    open: i.open,
    high: i.high,
    low: i.low,
    close: i.close,
    volume: i.volume ?? null,
    turnover: i.turnover ?? null,
  }));

export async function upsertCandles(rows: CandleRow[]) {
  if (!rows.length) return;
  const pool = getPool();

  const cols = [
    'symbol',
    'interval',
    'ts',
    'open',
    'high',
    'low',
    'close',
    'volume',
    'turnover',
  ] as const;
  const maxRows = Math.floor(65_535 / cols.length);
  if (rows.length > maxRows) {
    for (let i = 0; i < rows.length; i += maxRows) {
      await upsertCandles(rows.slice(i, i + maxRows));
    }
    return;
  }

  const valuesSql = rows
    .map(
      (_, i) =>
        `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(',')})`,
    )
    .join(',');

  const flat = rows.flatMap((r) => [
    r.symbol,
    r.interval,
    r.ts,
    r.open,
    r.high,
    r.low,
    r.close,
    r.volume ?? null,
    r.turnover ?? null,
  ]);

  const sql = `
    INSERT INTO candles (${cols.join(',')})
    VALUES ${valuesSql}
    ON CONFLICT (symbol, interval, ts) DO UPDATE SET
      open = EXCLUDED.open,
      high = EXCLUDED.high,
      low  = EXCLUDED.low,
      close = EXCLUDED.close,
      volume = COALESCE(EXCLUDED.volume, candles.volume),
      turnover = COALESCE(EXCLUDED.turnover, candles.turnover)
  `;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql, flat);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

const ensureDerivativesSchema = async () => {
  if (derivativesSchemaReady) return;
  const pool = getPool();
  await pool.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS derivatives_market (
      symbol text NOT NULL,
      interval text NOT NULL,
      ts timestamptz NOT NULL,
      open_interest double precision,
      funding_rate double precision,
      liq_long double precision,
      liq_short double precision,
      liq_total double precision,
      source text,
      ingested_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (symbol, interval, ts)
    )
  `);
  await pool.query(`
    SELECT create_hypertable(
      'derivatives_market',
      'ts',
      if_not_exists => TRUE,
      chunk_time_interval => interval '14 days'
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS derivatives_market_symbol_tf_ts_idx
    ON derivatives_market (symbol, interval, ts DESC)
  `);
  derivativesSchemaReady = true;
};

const ensureSpreadSchema = async () => {
  if (spreadSchemaReady) return;
  const pool = getPool();
  await pool.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_spread (
      symbol text NOT NULL,
      interval text NOT NULL,
      ts timestamptz NOT NULL,
      binance_price double precision,
      coinbase_price double precision,
      spread double precision,
      source text,
      ingested_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (symbol, interval, ts)
    )
  `);
  await pool.query(`
    SELECT create_hypertable(
      'market_spread',
      'ts',
      if_not_exists => TRUE,
      chunk_time_interval => interval '14 days'
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS market_spread_symbol_tf_ts_idx
    ON market_spread (symbol, interval, ts DESC)
  `);
  spreadSchemaReady = true;
};

export async function upsertDerivatives(rows: DerivativesRow[]) {
  if (!rows.length) return;
  await ensureDerivativesSchema();

  const pool = getPool();
  const cols = [
    'symbol',
    'interval',
    'ts',
    'open_interest',
    'funding_rate',
    'liq_long',
    'liq_short',
    'liq_total',
    'source',
  ] as const;

  const maxRows = Math.floor(65_535 / cols.length);
  if (rows.length > maxRows) {
    for (let i = 0; i < rows.length; i += maxRows) {
      await upsertDerivatives(rows.slice(i, i + maxRows));
    }
    return;
  }

  const valuesSql = rows
    .map(
      (_, i) =>
        `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(',')})`,
    )
    .join(',');

  const flat = rows.flatMap((row) => [
    row.symbol,
    row.interval,
    row.ts,
    row.openInterest ?? null,
    row.fundingRate ?? null,
    row.liqLong ?? null,
    row.liqShort ?? null,
    row.liqTotal ?? null,
    row.source ?? null,
  ]);

  const sql = `
    INSERT INTO derivatives_market (${cols.join(',')})
    VALUES ${valuesSql}
    ON CONFLICT (symbol, interval, ts) DO UPDATE SET
      open_interest = COALESCE(EXCLUDED.open_interest, derivatives_market.open_interest),
      funding_rate = COALESCE(EXCLUDED.funding_rate, derivatives_market.funding_rate),
      liq_long = COALESCE(EXCLUDED.liq_long, derivatives_market.liq_long),
      liq_short = COALESCE(EXCLUDED.liq_short, derivatives_market.liq_short),
      liq_total = COALESCE(EXCLUDED.liq_total, derivatives_market.liq_total),
      source = COALESCE(EXCLUDED.source, derivatives_market.source),
      ingested_at = now()
  `;

  await pool.query(sql, flat);
}

export async function getDerivativesRangeForSymbols(
  symbols: string[],
  interval: DerivativesInterval,
  startMs: number,
  endMs: number,
) {
  if (!symbols.length) return [] as Array<{
    symbol: string;
    interval: DerivativesInterval;
    ts: Date;
    open_interest: number | null;
    funding_rate: number | null;
    liq_long: number | null;
    liq_short: number | null;
    liq_total: number | null;
  }>;
  await ensureDerivativesSchema();
  const pool = getPool();
  const sql = `
    SELECT symbol, interval, ts, open_interest, funding_rate, liq_long, liq_short, liq_total
    FROM derivatives_market
    WHERE symbol = ANY($1)
      AND interval = $2
      AND ts >= to_timestamp($3/1000.0)
      AND ts <= to_timestamp($4/1000.0)
    ORDER BY symbol ASC, ts ASC
  `;
  const res = await pool.query(sql, [symbols, interval, startMs, endMs]);
  return res.rows;
}

export async function getDerivativesSummary(hours = 24, limit = 500) {
  await ensureDerivativesSchema();
  const pool = getPool();
  const cappedHours = Math.max(1, Math.min(24 * 30, hours));
  const cappedLimit = Math.max(50, Math.min(5000, limit));

  const rowsQ = await pool.query(
    `
      SELECT symbol, interval, ts, open_interest, funding_rate, liq_long, liq_short, liq_total
      FROM derivatives_market
      WHERE ts >= now() - ($1 || ' hours')::interval
      ORDER BY ts DESC
      LIMIT $2
    `,
    [String(cappedHours), cappedLimit],
  );

  const aggQ = await pool.query(
    `
      SELECT
        symbol,
        interval,
        COUNT(*)::int AS points,
        MAX(ts) AS last_ts,
        AVG(open_interest) AS avg_open_interest,
        AVG(funding_rate) AS avg_funding_rate,
        SUM(COALESCE(liq_total, 0)) AS sum_liq_total
      FROM derivatives_market
      WHERE ts >= now() - ($1 || ' hours')::interval
      GROUP BY symbol, interval
      ORDER BY points DESC, symbol ASC
      LIMIT 500
    `,
    [String(cappedHours)],
  );

  return {
    rows: rowsQ.rows,
    aggregates: aggQ.rows,
    hours: cappedHours,
  };
}

export async function upsertSpreadRows(rows: SpreadRow[]) {
  if (!rows.length) return;
  await ensureSpreadSchema();

  const pool = getPool();
  const cols = [
    'symbol',
    'interval',
    'ts',
    'binance_price',
    'coinbase_price',
    'spread',
    'source',
  ] as const;

  const maxRows = Math.floor(65_535 / cols.length);
  if (rows.length > maxRows) {
    for (let i = 0; i < rows.length; i += maxRows) {
      await upsertSpreadRows(rows.slice(i, i + maxRows));
    }
    return;
  }

  const valuesSql = rows
    .map(
      (_, i) =>
        `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(',')})`,
    )
    .join(',');

  const flat = rows.flatMap((row) => [
    row.symbol,
    row.interval,
    row.ts,
    row.binancePrice ?? null,
    row.coinbasePrice ?? null,
    row.spread ?? null,
    row.source ?? null,
  ]);

  const sql = `
    INSERT INTO market_spread (${cols.join(',')})
    VALUES ${valuesSql}
    ON CONFLICT (symbol, interval, ts) DO UPDATE SET
      binance_price = COALESCE(EXCLUDED.binance_price, market_spread.binance_price),
      coinbase_price = COALESCE(EXCLUDED.coinbase_price, market_spread.coinbase_price),
      spread = COALESCE(EXCLUDED.spread, market_spread.spread),
      source = COALESCE(EXCLUDED.source, market_spread.source),
      ingested_at = now()
  `;

  await pool.query(sql, flat);
}

export async function getSpreadRangeForSymbols(
  symbols: string[],
  interval: DerivativesInterval,
  startMs: number,
  endMs: number,
) {
  if (!symbols.length) {
    return [] as Array<{
      symbol: string;
      interval: DerivativesInterval;
      ts: Date;
      binance_price: number | null;
      coinbase_price: number | null;
      spread: number | null;
    }>;
  }
  await ensureSpreadSchema();
  const pool = getPool();
  const sql = `
    SELECT symbol, interval, ts, binance_price, coinbase_price, spread
    FROM market_spread
    WHERE symbol = ANY($1)
      AND interval = $2
      AND ts >= to_timestamp($3/1000.0)
      AND ts <= to_timestamp($4/1000.0)
    ORDER BY symbol ASC, ts ASC
  `;
  const res = await pool.query(sql, [symbols, interval, startMs, endMs]);
  return res.rows;
}

export async function getSpreadSummary(hours = 24, limit = 500) {
  await ensureSpreadSchema();
  const pool = getPool();
  const cappedHours = Math.max(1, Math.min(24 * 30, hours));
  const cappedLimit = Math.max(50, Math.min(5000, limit));

  const rowsQ = await pool.query(
    `
      SELECT symbol, interval, ts, binance_price, coinbase_price, spread
      FROM market_spread
      WHERE ts >= now() - ($1 || ' hours')::interval
      ORDER BY ts DESC
      LIMIT $2
    `,
    [String(cappedHours), cappedLimit],
  );

  const aggQ = await pool.query(
    `
      SELECT
        symbol,
        interval,
        COUNT(*)::int AS points,
        MAX(ts) AS last_ts,
        AVG(spread) AS avg_spread,
        STDDEV_POP(spread) AS std_spread
      FROM market_spread
      WHERE ts >= now() - ($1 || ' hours')::interval
      GROUP BY symbol, interval
      ORDER BY points DESC, symbol ASC
      LIMIT 500
    `,
    [String(cappedHours)],
  );

  return {
    rows: rowsQ.rows,
    aggregates: aggQ.rows,
    hours: cappedHours,
  };
}

export async function getCandlesRange(
  symbol: string,
  interval: number,
  startMs: number,
  endMs: number,
) {
  const pool = getPool();
  const sql = `
    SELECT symbol, interval, ts,
           open, high, low, close, volume, turnover
    FROM candles
    WHERE symbol = $1 AND interval = $2
      AND ts >= to_timestamp($3/1000.0)
      AND ts <= to_timestamp($4/1000.0)
    ORDER BY ts ASC
  `;
  const res = await pool.query(sql, [symbol, interval, startMs, endMs]);
  return res.rows;
}

export async function getDataEdges(symbol: string, interval: number) {
  const pool = getPool();
  const sqlMin = `
    SELECT extract(epoch from ts)*1000 AS ms
    FROM candles
    WHERE symbol=$1 AND interval=$2
    ORDER BY ts ASC
    LIMIT 1
  `;
  const sqlMax = `
    SELECT extract(epoch from ts)*1000 AS ms
    FROM candles
    WHERE symbol=$1 AND interval=$2
    ORDER BY ts DESC
    LIMIT 1
  `;
  const [minQ, maxQ] = await Promise.all([
    pool.query(sqlMin, [symbol, interval]),
    pool.query(sqlMax, [symbol, interval]),
  ]);
  const minRaw = minQ.rows[0]?.ms as number | string | undefined;
  const maxRaw = maxQ.rows[0]?.ms as number | string | undefined;
  const min = Number.isFinite(Number(minRaw)) ? Number(minRaw) : undefined;
  const max = Number.isFinite(Number(maxRaw)) ? Number(maxRaw) : undefined;
  return { min, max };
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

export async function deleteCandles(symbol: string, interval: number) {
  const pool = getPool();
  const sql = `
    DELETE FROM candles
    WHERE symbol = $1 AND interval = $2
  `;
  await pool.query(sql, [symbol, interval]);
}

export async function findContinuityGap(symbol: string, interval: number) {
  const pool = getPool();
  const expectedSeconds = interval * 60;
  const sql = `
    WITH ordered AS (
      SELECT
        ts,
        LAG(ts) OVER (ORDER BY ts) AS prev_ts
      FROM candles
      WHERE symbol = $1 AND interval = $2
    )
    SELECT
      ts,
      prev_ts,
      EXTRACT(EPOCH FROM (ts - prev_ts))::int AS diff_seconds
    FROM ordered
    WHERE prev_ts IS NOT NULL
      AND EXTRACT(EPOCH FROM (ts - prev_ts))::int <> $3
    ORDER BY ts ASC
    LIMIT 1
  `;
  const res = await pool.query(sql, [symbol, interval, expectedSeconds]);
  const row = res.rows[0];
  if (!row) return null;
  return {
    ts: new Date(row.ts).getTime(),
    prevTs: new Date(row.prev_ts).getTime(),
    diffSeconds: row.diff_seconds as number,
  };
}
