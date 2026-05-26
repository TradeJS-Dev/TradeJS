import { Pool } from 'pg';
import {
  KlineChartData,
  DerivativesInterval,
  DerivativesRow,
  SpreadRow,
} from '@tradejs/types';

declare global {
  // чтобы Next.js не создавал пул на каждый HMR
  // eslint-disable-next-line no-var
  var __pgPool__: Pool | undefined;
}

const getPool = () => {
  if (!global.__pgPool__) {
    const host = process.env.PG_HOST || '127.0.0.1';
    const port = Number(process.env.PG_PORT ?? 5432);
    const user = process.env.PG_USER || 'app';
    const password = String(process.env.PG_PASSWORD ?? 'app');
    const database = process.env.PG_DATABASE || process.env.PG_DB || 'app';

    global.__pgPool__ = new Pool({
      host,
      port,
      user,
      password,
      database,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return global.__pgPool__;
};

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
};

export type IndicatorCacheRow = {
  provider: string;
  symbol: string;
  interval: number;
  paramsHash: string;
  version: string;
  ts: Date;
  snapshot: unknown;
};

export type IndicatorCacheCheckpointRow = {
  provider: string;
  symbol: string;
  interval: number;
  paramsHash: string;
  version: string;
  ts: Date;
  snapshot: unknown;
};

export type IndicatorCacheCleanupTable = 'coverage' | 'checkpoint';
export type IndicatorCacheCleanupProgress = {
  table: IndicatorCacheCleanupTable;
  phase: 'index' | 'count' | 'delete' | 'done';
  deletedRows: number;
  totalRows: number;
  batchRows?: number;
};

type IndicatorCacheBulkRow = IndicatorCacheRow | IndicatorCacheCheckpointRow;

let derivativesSchemaReady = false;
let spreadSchemaReady = false;
let indicatorCacheSchemaReady = false;
let indicatorCacheCheckpointSchemaReady = false;
let derivativesSchemaReadyPromise: Promise<void> | null = null;
let spreadSchemaReadyPromise: Promise<void> | null = null;
let indicatorCacheSchemaReadyPromise: Promise<void> | null = null;
let indicatorCacheCheckpointSchemaReadyPromise: Promise<void> | null = null;

const INDICATOR_CACHE_JSONB_UPSERT_MAX_ROWS = 50_000;

export const closeTimescalePool = async (): Promise<void> => {
  const pool = global.__pgPool__;
  if (!pool) {
    return;
  }

  global.__pgPool__ = undefined;
  derivativesSchemaReady = false;
  spreadSchemaReady = false;
  indicatorCacheSchemaReady = false;
  indicatorCacheCheckpointSchemaReady = false;
  derivativesSchemaReadyPromise = null;
  spreadSchemaReadyPromise = null;
  indicatorCacheSchemaReadyPromise = null;
  indicatorCacheCheckpointSchemaReadyPromise = null;
  await pool.end();
};

const DERIVATIVES_SCHEMA_LOCK_KEY = 610001;
const SPREAD_SCHEMA_LOCK_KEY = 610002;
const INDICATOR_CACHE_SCHEMA_LOCK_KEY = 610003;
const INDICATOR_CACHE_CHECKPOINT_SCHEMA_LOCK_KEY = 610004;

const normalizeCandleProvider = (provider: string) =>
  String(provider || '')
    .trim()
    .toLowerCase();

const normalizeCandleSymbol = (symbol: string) =>
  String(symbol || '')
    .trim()
    .toUpperCase();

const withSchemaLock = async (lockKey: number, work: () => Promise<void>) => {
  const pool = getPool();
  await pool.query('SELECT pg_advisory_lock($1)', [lockKey]);
  try {
    await work();
  } finally {
    await pool.query('SELECT pg_advisory_unlock($1)', [lockKey]);
  }
};

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
  }));
};

export async function upsertCandles(rows: CandleRow[]) {
  if (!rows.length) return;
  const pool = getPool();

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
    normalizeCandleProvider(r.provider),
    normalizeCandleSymbol(r.symbol),
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
    ON CONFLICT (provider, symbol, interval, ts) DO UPDATE SET
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
  if (derivativesSchemaReadyPromise) {
    await derivativesSchemaReadyPromise;
    return;
  }

  const pool = getPool();
  derivativesSchemaReadyPromise = withSchemaLock(
    DERIVATIVES_SCHEMA_LOCK_KEY,
    async () => {
      if (derivativesSchemaReady) return;
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
      await pool.query(`
        CREATE TABLE IF NOT EXISTS derivatives_backfill_coverage (
          source text NOT NULL,
          symbol text NOT NULL,
          interval text NOT NULL,
          from_ts timestamptz NOT NULL,
          to_ts timestamptz NOT NULL,
          rows_count integer NOT NULL DEFAULT 0,
          checked_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (source, symbol, interval, from_ts, to_ts)
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS derivatives_backfill_coverage_lookup_idx
        ON derivatives_backfill_coverage (source, symbol, interval, from_ts, to_ts)
      `);
      derivativesSchemaReady = true;
    },
  ).finally(() => {
    derivativesSchemaReadyPromise = null;
  });

  await derivativesSchemaReadyPromise;
};

const ensureSpreadSchema = async () => {
  if (spreadSchemaReady) return;
  if (spreadSchemaReadyPromise) {
    await spreadSchemaReadyPromise;
    return;
  }

  const pool = getPool();
  spreadSchemaReadyPromise = withSchemaLock(
    SPREAD_SCHEMA_LOCK_KEY,
    async () => {
      if (spreadSchemaReady) return;
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
    },
  ).finally(() => {
    spreadSchemaReadyPromise = null;
  });

  await spreadSchemaReadyPromise;
};

const ensureIndicatorCacheSchema = async () => {
  if (indicatorCacheSchemaReady) return;
  if (indicatorCacheSchemaReadyPromise) {
    await indicatorCacheSchemaReadyPromise;
    return;
  }

  const pool = getPool();
  indicatorCacheSchemaReadyPromise = withSchemaLock(
    INDICATOR_CACHE_SCHEMA_LOCK_KEY,
    async () => {
      if (indicatorCacheSchemaReady) return;
      await pool.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS indicator_cache (
          provider text NOT NULL,
          symbol text NOT NULL,
          interval integer NOT NULL,
          params_hash text NOT NULL,
          version text NOT NULL,
          ts timestamptz NOT NULL,
          snapshot jsonb NOT NULL,
          ingested_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (provider, symbol, interval, params_hash, version, ts)
        )
      `);
      await pool.query(`
        SELECT create_hypertable(
          'indicator_cache',
          'ts',
          if_not_exists => TRUE,
          chunk_time_interval => interval '14 days'
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS indicator_cache_lookup_idx
        ON indicator_cache (
          provider,
          symbol,
          interval,
          params_hash,
          version,
          ts DESC
        )
      `);
      indicatorCacheSchemaReady = true;
    },
  ).finally(() => {
    indicatorCacheSchemaReadyPromise = null;
  });

  await indicatorCacheSchemaReadyPromise;
};

const ensureIndicatorCacheCheckpointSchema = async () => {
  if (indicatorCacheCheckpointSchemaReady) return;
  if (indicatorCacheCheckpointSchemaReadyPromise) {
    await indicatorCacheCheckpointSchemaReadyPromise;
    return;
  }

  const pool = getPool();
  indicatorCacheCheckpointSchemaReadyPromise = withSchemaLock(
    INDICATOR_CACHE_CHECKPOINT_SCHEMA_LOCK_KEY,
    async () => {
      if (indicatorCacheCheckpointSchemaReady) return;
      await pool.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS indicator_cache_checkpoint (
          provider text NOT NULL,
          symbol text NOT NULL,
          interval integer NOT NULL,
          params_hash text NOT NULL,
          version text NOT NULL,
          ts timestamptz NOT NULL,
          snapshot jsonb NOT NULL,
          ingested_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (provider, symbol, interval, params_hash, version, ts)
        )
      `);
      await pool.query(`
        SELECT create_hypertable(
          'indicator_cache_checkpoint',
          'ts',
          if_not_exists => TRUE,
          chunk_time_interval => interval '14 days'
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS indicator_cache_checkpoint_lookup_idx
        ON indicator_cache_checkpoint (
          provider,
          symbol,
          interval,
          params_hash,
          version,
          ts DESC
        )
      `);
      indicatorCacheCheckpointSchemaReady = true;
    },
  ).finally(() => {
    indicatorCacheCheckpointSchemaReadyPromise = null;
  });

  await indicatorCacheCheckpointSchemaReadyPromise;
};

export const ensureIndicatorCacheTables = async () => {
  await ensureIndicatorCacheSchema();
  await ensureIndicatorCacheCheckpointSchema();
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
  if (!symbols.length)
    return [] as Array<{
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

export async function getDerivativesDataEdgesForSymbols(
  symbols: string[],
  interval: DerivativesInterval,
) {
  const normalizedSymbols = [
    ...new Set(
      symbols
        .map((symbol) =>
          String(symbol || '')
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean),
    ),
  ];
  const edges = new Map<string, { min?: number; max?: number }>();
  if (!normalizedSymbols.length) return edges;

  await ensureDerivativesSchema();
  const pool = getPool();
  const sql = `
    SELECT
      symbol,
      extract(epoch from MIN(ts))*1000 AS min,
      extract(epoch from MAX(ts))*1000 AS max
    FROM derivatives_market
    WHERE symbol = ANY($1)
      AND interval = $2
    GROUP BY symbol
  `;
  const res = await pool.query(sql, [normalizedSymbols, interval]);

  for (const row of res.rows as Array<{
    symbol: string;
    min?: number | string | null;
    max?: number | string | null;
  }>) {
    const min = Number(row.min);
    const max = Number(row.max);
    edges.set(String(row.symbol).toUpperCase(), {
      min: Number.isFinite(min) ? min : undefined,
      max: Number.isFinite(max) ? max : undefined,
    });
  }

  return edges;
}

export async function getDerivativesBackfillCoverage(params: {
  source: string;
  symbols: string[];
  interval: DerivativesInterval;
  fromMs: number;
  toMs: number;
}) {
  const normalizedSource = String(params.source || '')
    .trim()
    .toLowerCase();
  const normalizedSymbols = [
    ...new Set(
      params.symbols
        .map((symbol) =>
          String(symbol || '')
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean),
    ),
  ];
  if (!normalizedSource || !normalizedSymbols.length) {
    return [] as Array<{
      symbol: string;
      interval: DerivativesInterval;
      fromMs: number;
      toMs: number;
      rowsCount: number;
    }>;
  }

  await ensureDerivativesSchema();
  const pool = getPool();
  const res = await pool.query(
    `
      SELECT
        symbol,
        interval,
        extract(epoch from from_ts)*1000 AS from_ms,
        extract(epoch from to_ts)*1000 AS to_ms,
        rows_count
      FROM derivatives_backfill_coverage
      WHERE source = $1
        AND symbol = ANY($2)
        AND interval = $3
        AND from_ts >= to_timestamp($4/1000.0)
        AND to_ts <= to_timestamp($5/1000.0)
    `,
    [
      normalizedSource,
      normalizedSymbols,
      params.interval,
      params.fromMs,
      params.toMs,
    ],
  );

  return (
    res.rows as Array<{
      symbol: string;
      interval: DerivativesInterval;
      from_ms: number | string;
      to_ms: number | string;
      rows_count: number | string;
    }>
  ).map((row) => ({
    symbol: String(row.symbol).toUpperCase(),
    interval: row.interval,
    fromMs: Number(row.from_ms),
    toMs: Number(row.to_ms),
    rowsCount: Number(row.rows_count ?? 0),
  }));
}

export async function upsertDerivativesBackfillCoverage(
  rows: Array<{
    source: string;
    symbol: string;
    interval: DerivativesInterval;
    fromMs: number;
    toMs: number;
    rowsCount: number;
  }>,
) {
  if (!rows.length) return;

  await ensureDerivativesSchema();
  const pool = getPool();
  const cols = [
    'source',
    'symbol',
    'interval',
    'from_ts',
    'to_ts',
    'rows_count',
  ] as const;
  const valuesSql = rows
    .map(
      (_, i) =>
        `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(',')})`,
    )
    .join(',');
  const flat = rows.flatMap((row) => [
    String(row.source || '')
      .trim()
      .toLowerCase(),
    String(row.symbol || '')
      .trim()
      .toUpperCase(),
    row.interval,
    new Date(row.fromMs),
    new Date(row.toMs),
    Math.max(0, Math.trunc(row.rowsCount)),
  ]);

  await pool.query(
    `
      INSERT INTO derivatives_backfill_coverage (${cols.join(',')})
      VALUES ${valuesSql}
      ON CONFLICT (source, symbol, interval, from_ts, to_ts) DO UPDATE SET
        rows_count = EXCLUDED.rows_count,
        checked_at = now()
    `,
    flat,
  );
}

export async function getDerivativesWindow(params: {
  symbol: string;
  intervals: DerivativesInterval[];
  endMs: number;
  lookbackMs: number;
}): Promise<Partial<Record<DerivativesInterval, DerivativesRow[]>>> {
  const { symbol, intervals, endMs, lookbackMs } = params;
  const normalizedSymbol = String(symbol || '')
    .trim()
    .toUpperCase();
  const normalizedIntervals = [...new Set(intervals)].filter(Boolean);

  if (!normalizedSymbol || !normalizedIntervals.length) {
    return {};
  }

  await ensureDerivativesSchema();
  const startMs = endMs - Math.max(0, lookbackMs);
  const pool = getPool();
  const sql = `
    SELECT symbol, interval, ts, open_interest, funding_rate, liq_long, liq_short, liq_total, source
    FROM derivatives_market
    WHERE symbol = $1
      AND interval = ANY($2)
      AND ts >= to_timestamp($3/1000.0)
      AND ts <= to_timestamp($4/1000.0)
    ORDER BY interval ASC, ts ASC
  `;
  const res = await pool.query(sql, [
    normalizedSymbol,
    normalizedIntervals,
    startMs,
    endMs,
  ]);
  const rowsByInterval: Partial<Record<DerivativesInterval, DerivativesRow[]>> =
    {};

  for (const row of res.rows as Array<{
    symbol: string;
    interval: DerivativesInterval;
    ts: Date;
    open_interest: number | null;
    funding_rate: number | null;
    liq_long: number | null;
    liq_short: number | null;
    liq_total: number | null;
    source: string | null;
  }>) {
    const interval = row.interval;
    rowsByInterval[interval] ??= [];
    rowsByInterval[interval]?.push({
      symbol: row.symbol,
      interval,
      ts: row.ts,
      openInterest: row.open_interest,
      fundingRate: row.funding_rate,
      liqLong: row.liq_long,
      liqShort: row.liq_short,
      liqTotal: row.liq_total,
      source: row.source,
    });
  }

  return rowsByInterval;
}

export async function getDerivativesSummary(
  hours = 24,
  limit = 500,
  symbols?: string[],
) {
  await ensureDerivativesSchema();
  const pool = getPool();
  const cappedHours = Math.max(1, Math.min(24 * 90, hours));
  const cappedLimit = Math.max(10, Math.min(1000, limit));
  const normalizedSymbols = Array.isArray(symbols)
    ? [...new Set(symbols.map(normalizeCandleSymbol).filter(Boolean))]
    : [];
  const symbolsFilterSql = normalizedSymbols.length
    ? 'AND symbol = ANY($3)'
    : '';

  const summaryQ = await pool.query(
    `
      WITH filtered AS (
        SELECT
          symbol,
          interval,
          ts,
          open_interest,
          funding_rate,
          liq_long,
          liq_short,
          liq_total
        FROM derivatives_market
        WHERE ts >= now() - ($1 || ' hours')::interval
          ${symbolsFilterSql}
      ),
      latest AS (
        SELECT DISTINCT ON (symbol, interval)
          symbol,
          interval,
          ts AS last_ts,
          open_interest AS latest_open_interest,
          funding_rate AS latest_funding_rate
        FROM filtered
        ORDER BY symbol ASC, interval ASC, ts DESC
      ),
      first AS (
        SELECT DISTINCT ON (symbol, interval)
          symbol,
          interval,
          ts AS first_ts,
          open_interest AS first_open_interest,
          funding_rate AS first_funding_rate
        FROM filtered
        ORDER BY symbol ASC, interval ASC, ts ASC
      ),
      aggregated AS (
        SELECT
          symbol,
          interval,
          COUNT(*)::int AS points,
          SUM(COALESCE(liq_long, 0)) AS sum_liq_long,
          SUM(COALESCE(liq_short, 0)) AS sum_liq_short,
          SUM(COALESCE(liq_total, 0)) AS sum_liq_total
        FROM filtered
        GROUP BY symbol, interval
      )
      SELECT
        aggregated.symbol,
        aggregated.interval,
        aggregated.points,
        latest.last_ts,
        first.first_ts,
        latest.latest_open_interest,
        first.first_open_interest,
        latest.latest_funding_rate,
        first.first_funding_rate,
        aggregated.sum_liq_long,
        aggregated.sum_liq_short,
        aggregated.sum_liq_total
      FROM aggregated
      JOIN latest
        ON latest.symbol = aggregated.symbol
       AND latest.interval = aggregated.interval
      JOIN first
        ON first.symbol = aggregated.symbol
       AND first.interval = aggregated.interval
      ORDER BY aggregated.sum_liq_total DESC, aggregated.symbol ASC
      LIMIT $2
    `,
    normalizedSymbols.length
      ? [String(cappedHours), cappedLimit, normalizedSymbols]
      : [String(cappedHours), cappedLimit],
  );

  const items = (
    summaryQ.rows as Array<{
      symbol: string;
      interval: string;
      points: number | string;
      last_ts: Date | string;
      first_ts: Date | string;
      latest_open_interest: number | string | null;
      first_open_interest: number | string | null;
      latest_funding_rate: number | string | null;
      first_funding_rate: number | string | null;
      sum_liq_long: number | string | null;
      sum_liq_short: number | string | null;
      sum_liq_total: number | string | null;
    }>
  ).map((row) => {
    const latestOpenInterest =
      row.latest_open_interest == null
        ? null
        : Number(row.latest_open_interest);
    const firstOpenInterest =
      row.first_open_interest == null ? null : Number(row.first_open_interest);
    const latestFundingRate =
      row.latest_funding_rate == null ? null : Number(row.latest_funding_rate);
    const firstFundingRate =
      row.first_funding_rate == null ? null : Number(row.first_funding_rate);
    const oiChange =
      latestOpenInterest != null && firstOpenInterest != null
        ? latestOpenInterest - firstOpenInterest
        : null;
    const oiChangePct =
      oiChange != null &&
      firstOpenInterest != null &&
      Number.isFinite(firstOpenInterest) &&
      Math.abs(firstOpenInterest) > 0
        ? (oiChange / Math.abs(firstOpenInterest)) * 100
        : null;
    const fundingChange =
      latestFundingRate != null && firstFundingRate != null
        ? latestFundingRate - firstFundingRate
        : null;

    return {
      symbol: row.symbol,
      interval: row.interval,
      points: Number(row.points || 0),
      last_ts: row.last_ts,
      first_ts: row.first_ts,
      latest_open_interest: latestOpenInterest,
      first_open_interest: firstOpenInterest,
      oi_change: oiChange,
      oi_change_pct: oiChangePct,
      latest_funding_rate: latestFundingRate,
      first_funding_rate: firstFundingRate,
      funding_change: fundingChange,
      sum_liq_long: row.sum_liq_long == null ? null : Number(row.sum_liq_long),
      sum_liq_short:
        row.sum_liq_short == null ? null : Number(row.sum_liq_short),
      sum_liq_total:
        row.sum_liq_total == null ? null : Number(row.sum_liq_total),
    };
  });

  return {
    hours: cappedHours,
    items,
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
  provider: string,
  symbol: string,
  interval: number,
  startMs: number,
  endMs: number,
) {
  const pool = getPool();
  const normalizedProvider = normalizeCandleProvider(provider);
  const normalizedSymbol = normalizeCandleSymbol(symbol);
  const sql = `
    SELECT symbol, interval, ts,
           open, high, low, close, volume, turnover
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

const dedupeIndicatorCacheRows = <TRow extends IndicatorCacheBulkRow>(
  rows: TRow[],
) =>
  Array.from(
    new Map(
      rows.map((row) => [
        [
          normalizeCandleProvider(row.provider),
          normalizeCandleSymbol(row.symbol),
          row.interval,
          String(row.paramsHash),
          String(row.version),
          row.ts.toISOString(),
        ].join(':'),
        row,
      ]),
    ).values(),
  );

const upsertIndicatorCacheRowsJsonb = async (
  tableName: 'indicator_cache' | 'indicator_cache_checkpoint',
  rows: IndicatorCacheBulkRow[],
) => {
  if (!rows.length) return;

  if (rows.length > INDICATOR_CACHE_JSONB_UPSERT_MAX_ROWS) {
    for (
      let i = 0;
      i < rows.length;
      i += INDICATOR_CACHE_JSONB_UPSERT_MAX_ROWS
    ) {
      await upsertIndicatorCacheRowsJsonb(
        tableName,
        rows.slice(i, i + INDICATOR_CACHE_JSONB_UPSERT_MAX_ROWS),
      );
    }
    return;
  }

  const pool = getPool();
  const payload = JSON.stringify(
    rows.map((row) => ({
      provider: normalizeCandleProvider(row.provider),
      symbol: normalizeCandleSymbol(row.symbol),
      interval: row.interval,
      params_hash: String(row.paramsHash),
      version: String(row.version),
      ts: row.ts.toISOString(),
      snapshot: row.snapshot ?? null,
    })),
  );

  const sql = `
    INSERT INTO ${tableName} (
      provider,
      symbol,
      interval,
      params_hash,
      version,
      ts,
      snapshot
    )
    SELECT
      provider,
      symbol,
      interval,
      params_hash,
      version,
      ts::timestamptz,
      snapshot
    FROM jsonb_to_recordset($1::jsonb) AS x(
      provider text,
      symbol text,
      interval integer,
      params_hash text,
      version text,
      ts text,
      snapshot jsonb
    )
    ON CONFLICT (provider, symbol, interval, params_hash, version, ts) DO UPDATE SET
      snapshot = EXCLUDED.snapshot,
      ingested_at = now()
  `;

  await pool.query(sql, [payload]);
};

export async function upsertIndicatorCacheCoverageRows(
  rows: IndicatorCacheRow[],
) {
  if (!rows.length) return;
  await ensureIndicatorCacheSchema();

  await upsertIndicatorCacheRowsJsonb(
    'indicator_cache',
    dedupeIndicatorCacheRows(rows),
  );
}

export async function upsertIndicatorCacheCheckpointRows(
  rows: IndicatorCacheCheckpointRow[],
) {
  if (!rows.length) return;
  await ensureIndicatorCacheCheckpointSchema();

  await upsertIndicatorCacheRowsJsonb(
    'indicator_cache_checkpoint',
    dedupeIndicatorCacheRows(rows),
  );
}

export async function deleteIndicatorCacheObsoleteVersions(params: {
  provider: string;
  symbol: string;
  interval: number;
  keepVersion: string;
}) {
  await Promise.all([
    ensureIndicatorCacheSchema(),
    ensureIndicatorCacheCheckpointSchema(),
  ]);

  const pool = getPool();
  const normalizedProvider = normalizeCandleProvider(params.provider);
  const normalizedSymbol = normalizeCandleSymbol(params.symbol);

  await pool.query(
    `
      DELETE FROM indicator_cache
      WHERE provider = $1
        AND symbol = $2
        AND interval = $3
        AND version <> $4
    `,
    [normalizedProvider, normalizedSymbol, params.interval, params.keepVersion],
  );

  await pool.query(
    `
      DELETE FROM indicator_cache_checkpoint
      WHERE provider = $1
        AND symbol = $2
        AND interval = $3
        AND version <> $4
    `,
    [normalizedProvider, normalizedSymbol, params.interval, params.keepVersion],
  );
}

const countObsoleteIndicatorCacheRows = async (params: {
  tableName: 'indicator_cache' | 'indicator_cache_checkpoint';
  keepVersion: string;
}) => {
  const pool = getPool();
  const result = await pool.query(
    `
      SELECT COUNT(*)::int AS count
      FROM ${params.tableName}
      WHERE version <> $1
    `,
    [params.keepVersion],
  );
  return Number(result.rows[0]?.count ?? 0);
};

const deleteObsoleteIndicatorCacheBatch = async (params: {
  tableName: 'indicator_cache' | 'indicator_cache_checkpoint';
  keepVersion: string;
  batchSize: number;
}) => {
  const pool = getPool();
  const result = await pool.query(
    `
      DELETE FROM ${params.tableName}
      WHERE (tableoid, ctid) IN (
        SELECT tableoid, ctid
        FROM ${params.tableName}
        WHERE version <> $1
        LIMIT $2
      )
    `,
    [params.keepVersion, params.batchSize],
  );
  return result.rowCount ?? 0;
};

const deleteObsoleteIndicatorCacheTable = async (params: {
  table: IndicatorCacheCleanupTable;
  tableName: 'indicator_cache' | 'indicator_cache_checkpoint';
  keepVersion: string;
  batchSize: number;
  onProgress?: (progress: IndicatorCacheCleanupProgress) => void;
}) => {
  params.onProgress?.({
    table: params.table,
    phase: 'count',
    deletedRows: 0,
    totalRows: 0,
  });
  const totalRows = await countObsoleteIndicatorCacheRows({
    tableName: params.tableName,
    keepVersion: params.keepVersion,
  });
  params.onProgress?.({
    table: params.table,
    phase: 'count',
    deletedRows: 0,
    totalRows,
  });

  let deletedRows = 0;
  while (deletedRows < totalRows) {
    const batchRows = await deleteObsoleteIndicatorCacheBatch({
      tableName: params.tableName,
      keepVersion: params.keepVersion,
      batchSize: params.batchSize,
    });
    if (batchRows <= 0) {
      break;
    }

    deletedRows += batchRows;
    params.onProgress?.({
      table: params.table,
      phase: 'delete',
      deletedRows,
      totalRows,
      batchRows,
    });

    if (batchRows < params.batchSize) {
      break;
    }
  }

  params.onProgress?.({
    table: params.table,
    phase: 'done',
    deletedRows,
    totalRows,
  });

  return deletedRows;
};

export async function deleteAllIndicatorCacheObsoleteVersions(params: {
  keepVersion: string;
  batchSize?: number;
  onProgress?: (progress: IndicatorCacheCleanupProgress) => void;
}) {
  await Promise.all([
    ensureIndicatorCacheSchema(),
    ensureIndicatorCacheCheckpointSchema(),
  ]);

  const pool = getPool();
  params.onProgress?.({
    table: 'coverage',
    phase: 'index',
    deletedRows: 0,
    totalRows: 2,
  });
  await pool.query(`
    CREATE INDEX IF NOT EXISTS indicator_cache_version_cleanup_idx
    ON indicator_cache (version)
  `);
  params.onProgress?.({
    table: 'coverage',
    phase: 'index',
    deletedRows: 1,
    totalRows: 2,
    batchRows: 1,
  });
  params.onProgress?.({
    table: 'checkpoint',
    phase: 'index',
    deletedRows: 1,
    totalRows: 2,
  });
  await pool.query(`
    CREATE INDEX IF NOT EXISTS indicator_cache_checkpoint_version_cleanup_idx
    ON indicator_cache_checkpoint (version)
  `);
  params.onProgress?.({
    table: 'checkpoint',
    phase: 'index',
    deletedRows: 2,
    totalRows: 2,
    batchRows: 1,
  });

  const batchSize = Math.max(1, Math.trunc(params.batchSize ?? 50_000));
  const coverageRows = await deleteObsoleteIndicatorCacheTable({
    table: 'coverage',
    tableName: 'indicator_cache',
    keepVersion: params.keepVersion,
    batchSize,
    onProgress: params.onProgress,
  });
  const checkpointRows = await deleteObsoleteIndicatorCacheTable({
    table: 'checkpoint',
    tableName: 'indicator_cache_checkpoint',
    keepVersion: params.keepVersion,
    batchSize,
    onProgress: params.onProgress,
  });

  return {
    coverageRows,
    checkpointRows,
  };
}

export async function resetIndicatorCacheTables() {
  const pool = getPool();

  await withSchemaLock(INDICATOR_CACHE_SCHEMA_LOCK_KEY, async () => {
    await withSchemaLock(
      INDICATOR_CACHE_CHECKPOINT_SCHEMA_LOCK_KEY,
      async () => {
        indicatorCacheSchemaReady = false;
        indicatorCacheCheckpointSchemaReady = false;
        indicatorCacheSchemaReadyPromise = null;
        indicatorCacheCheckpointSchemaReadyPromise = null;

        await pool.query(
          'DROP TABLE IF EXISTS indicator_cache_checkpoint CASCADE',
        );
        await pool.query('DROP TABLE IF EXISTS indicator_cache CASCADE');
      },
    );
  });

  await Promise.all([
    ensureIndicatorCacheSchema(),
    ensureIndicatorCacheCheckpointSchema(),
  ]);
}

export async function getIndicatorCacheCoverage(params: {
  provider: string;
  symbol: string;
  interval: number;
  paramsHash: string;
  version: string;
  startMs: number;
  endMs: number;
}) {
  await ensureIndicatorCacheSchema();

  const pool = getPool();
  const normalizedProvider = normalizeCandleProvider(params.provider);
  const normalizedSymbol = normalizeCandleSymbol(params.symbol);
  const sql = `
    SELECT
      extract(epoch from MIN(ts))*1000 AS min,
      extract(epoch from MAX(ts))*1000 AS max,
      COUNT(*)::int AS count
    FROM indicator_cache
    WHERE provider = $1
      AND symbol = $2
      AND interval = $3
      AND params_hash = $4
      AND version = $5
      AND ts >= to_timestamp($6/1000.0)
      AND ts <= to_timestamp($7/1000.0)
  `;
  const res = await pool.query(sql, [
    normalizedProvider,
    normalizedSymbol,
    params.interval,
    params.paramsHash,
    params.version,
    params.startMs,
    params.endMs,
  ]);
  const row = res.rows[0] as
    | {
        min?: number | string | null;
        max?: number | string | null;
        count?: number | string | null;
      }
    | undefined;
  const min = Number(row?.min);
  const max = Number(row?.max);
  const count = Number(row?.count);

  return {
    min: Number.isFinite(min) ? min : undefined,
    max: Number.isFinite(max) ? max : undefined,
    count: Number.isFinite(count) ? count : 0,
  };
}

export async function getIndicatorCacheRange(params: {
  provider: string;
  symbol: string;
  interval: number;
  paramsHash: string;
  version: string;
  startMs: number;
  endMs: number;
}) {
  await ensureIndicatorCacheSchema();

  const pool = getPool();
  const normalizedProvider = normalizeCandleProvider(params.provider);
  const normalizedSymbol = normalizeCandleSymbol(params.symbol);
  const sql = `
    SELECT ts, snapshot
    FROM indicator_cache
    WHERE provider = $1
      AND symbol = $2
      AND interval = $3
      AND params_hash = $4
      AND version = $5
      AND ts >= to_timestamp($6/1000.0)
      AND ts <= to_timestamp($7/1000.0)
    ORDER BY ts ASC
  `;
  const res = await pool.query(sql, [
    normalizedProvider,
    normalizedSymbol,
    params.interval,
    params.paramsHash,
    params.version,
    params.startMs,
    params.endMs,
  ]);

  return (res.rows as Array<{ ts: Date; snapshot: unknown }>).map((row) => ({
    ts: row.ts,
    snapshot: row.snapshot,
  }));
}

export async function getLatestIndicatorCacheCheckpointAtOrBefore(params: {
  provider: string;
  symbol: string;
  interval: number;
  paramsHash: string;
  version: string;
  tsMs: number;
}) {
  await ensureIndicatorCacheCheckpointSchema();

  const pool = getPool();
  const normalizedProvider = normalizeCandleProvider(params.provider);
  const normalizedSymbol = normalizeCandleSymbol(params.symbol);
  const sql = `
    SELECT ts, snapshot
    FROM indicator_cache_checkpoint
    WHERE provider = $1
      AND symbol = $2
      AND interval = $3
      AND params_hash = $4
      AND version = $5
      AND ts <= to_timestamp($6/1000.0)
    ORDER BY ts DESC
    LIMIT 1
  `;
  const res = await pool.query(sql, [
    normalizedProvider,
    normalizedSymbol,
    params.interval,
    params.paramsHash,
    params.version,
    params.tsMs,
  ]);

  const row = (res.rows as Array<{ ts: Date; snapshot: unknown }>)[0];
  if (!row) {
    return null;
  }

  return {
    ts: row.ts,
    snapshot: row.snapshot,
  };
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
