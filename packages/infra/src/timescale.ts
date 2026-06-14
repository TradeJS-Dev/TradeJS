import { Pool } from 'pg';
import {
  KlineChartData,
  DerivativesInterval,
  DerivativesRow,
  MarketBreadthRow,
  MarketFeatureInterval,
  MarketGlobalContextRow,
  MarketOrderBookDepthRow,
  MarketTradeFlowRow,
  OnchainFlowRow,
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
    const max = Number(process.env.PG_POOL_MAX ?? 10);
    const connectionTimeoutMillis = Number(
      process.env.PG_CONNECTION_TIMEOUT_MS ?? 30_000,
    );

    global.__pgPool__ = new Pool({
      host,
      port,
      user,
      password,
      database,
      max: Number.isFinite(max) && max > 0 ? Math.floor(max) : 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis:
        Number.isFinite(connectionTimeoutMillis) && connectionTimeoutMillis > 0
          ? Math.floor(connectionTimeoutMillis)
          : 30_000,
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
  takerBuyBaseVolume?: number | null;
  takerBuyQuoteVolume?: number | null;
  takerSellBaseVolume?: number | null;
  takerSellQuoteVolume?: number | null;
};

let candlesSchemaReady = false;
let derivativesSchemaReady = false;
let spreadSchemaReady = false;
let binanceMarketSchemaReady = false;
let onchainSchemaReady = false;
let candlesSchemaReadyPromise: Promise<void> | null = null;
let derivativesSchemaReadyPromise: Promise<void> | null = null;
let spreadSchemaReadyPromise: Promise<void> | null = null;
let binanceMarketSchemaReadyPromise: Promise<void> | null = null;
let onchainSchemaReadyPromise: Promise<void> | null = null;

export const closeTimescalePool = async (): Promise<void> => {
  const pool = global.__pgPool__;
  if (!pool) {
    return;
  }

  global.__pgPool__ = undefined;
  candlesSchemaReady = false;
  derivativesSchemaReady = false;
  spreadSchemaReady = false;
  binanceMarketSchemaReady = false;
  onchainSchemaReady = false;
  candlesSchemaReadyPromise = null;
  derivativesSchemaReadyPromise = null;
  spreadSchemaReadyPromise = null;
  binanceMarketSchemaReadyPromise = null;
  onchainSchemaReadyPromise = null;
  await pool.end();
};

const CANDLES_SCHEMA_LOCK_KEY = 610000;
const DERIVATIVES_SCHEMA_LOCK_KEY = 610001;
const SPREAD_SCHEMA_LOCK_KEY = 610002;
const BINANCE_MARKET_SCHEMA_LOCK_KEY = 610003;
const ONCHAIN_SCHEMA_LOCK_KEY = 610004;
const PG_SAFE_MAX_BIND_PARAMS = 30_000;

const normalizeCandleProvider = (provider: string) =>
  String(provider || '')
    .trim()
    .toLowerCase();

const normalizeCandleSymbol = (symbol: string) =>
  String(symbol || '')
    .trim()
    .toUpperCase();

const getSafeBulkInsertRows = (columnsCount: number) =>
  Math.max(1, Math.floor(PG_SAFE_MAX_BIND_PARAMS / columnsCount));

const withSchemaLock = async (lockKey: number, work: () => Promise<void>) => {
  const pool = getPool();
  await pool.query('SELECT pg_advisory_lock($1)', [lockKey]);
  try {
    await work();
  } finally {
    await pool.query('SELECT pg_advisory_unlock($1)', [lockKey]);
  }
};

const ensureCandlesSchema = async () => {
  if (candlesSchemaReady) return;
  if (candlesSchemaReadyPromise) {
    await candlesSchemaReadyPromise;
    return;
  }

  candlesSchemaReadyPromise = withSchemaLock(
    CANDLES_SCHEMA_LOCK_KEY,
    async () => {
      const pool = getPool();
      await pool.query(`
      ALTER TABLE candles
        ADD COLUMN IF NOT EXISTS taker_buy_base_volume double precision,
        ADD COLUMN IF NOT EXISTS taker_buy_quote_volume double precision,
        ADD COLUMN IF NOT EXISTS taker_sell_base_volume double precision,
        ADD COLUMN IF NOT EXISTS taker_sell_quote_volume double precision
    `);
      candlesSchemaReady = true;
    },
  ).finally(() => {
    candlesSchemaReadyPromise = null;
  });

  await candlesSchemaReadyPromise;
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

const ensureOnchainSchema = async () => {
  if (onchainSchemaReady) return;
  if (onchainSchemaReadyPromise) {
    await onchainSchemaReadyPromise;
    return;
  }

  const pool = getPool();
  onchainSchemaReadyPromise = withSchemaLock(
    ONCHAIN_SCHEMA_LOCK_KEY,
    async () => {
      if (onchainSchemaReady) return;
      await pool.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS onchain_flow_context (
          symbol text NOT NULL,
          interval text NOT NULL,
          ts timestamptz NOT NULL,
          whale_net_flow_usd double precision,
          smart_trader_net_flow_usd double precision,
          cex_deposit_usd double precision,
          cex_withdraw_usd double precision,
          dex_buy_usd double precision,
          dex_sell_usd double precision,
          entity_count double precision,
          confidence_weighted_bias double precision,
          source text,
          ingested_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (symbol, interval, ts)
        )
      `);
      await pool.query(`
        SELECT create_hypertable(
          'onchain_flow_context',
          'ts',
          if_not_exists => TRUE,
          chunk_time_interval => interval '14 days'
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS onchain_flow_context_symbol_tf_ts_idx
        ON onchain_flow_context (symbol, interval, ts DESC)
      `);
      onchainSchemaReady = true;
    },
  ).finally(() => {
    onchainSchemaReadyPromise = null;
  });

  await onchainSchemaReadyPromise;
};

const ensureBinanceMarketSchema = async () => {
  if (binanceMarketSchemaReady) return;
  if (binanceMarketSchemaReadyPromise) {
    await binanceMarketSchemaReadyPromise;
    return;
  }

  const pool = getPool();
  binanceMarketSchemaReadyPromise = withSchemaLock(
    BINANCE_MARKET_SCHEMA_LOCK_KEY,
    async () => {
      if (binanceMarketSchemaReady) return;
      await pool.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS market_trade_flow (
          symbol text NOT NULL,
          interval text NOT NULL,
          ts timestamptz NOT NULL,
          trades integer NOT NULL,
          buy_base_volume double precision,
          sell_base_volume double precision,
          buy_quote_volume double precision,
          sell_quote_volume double precision,
          net_base_delta double precision,
          net_quote_delta double precision,
          buy_pressure_pct double precision,
          source text,
          ingested_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (symbol, interval, ts)
        )
      `);
      await pool.query(`
        SELECT create_hypertable(
          'market_trade_flow',
          'ts',
          if_not_exists => TRUE,
          chunk_time_interval => interval '7 days'
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS market_trade_flow_symbol_tf_ts_idx
        ON market_trade_flow (symbol, interval, ts DESC)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS market_order_book_depth (
          venue text NOT NULL,
          symbol text NOT NULL,
          ts timestamptz NOT NULL,
          last_update_id bigint,
          bid double precision,
          ask double precision,
          mid double precision,
          spread_bps double precision,
          levels jsonb NOT NULL,
          raw_bid_levels integer,
          raw_ask_levels integer,
          source text,
          ingested_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (venue, symbol, ts)
        )
      `);
      await pool.query(`
        SELECT create_hypertable(
          'market_order_book_depth',
          'ts',
          if_not_exists => TRUE,
          chunk_time_interval => interval '7 days'
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS market_order_book_depth_venue_symbol_ts_idx
        ON market_order_book_depth (venue, symbol, ts DESC)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS market_breadth (
          universe text NOT NULL,
          interval text NOT NULL,
          ts timestamptz NOT NULL,
          symbols_count integer NOT NULL,
          advancers integer NOT NULL,
          decliners integer NOT NULL,
          unchanged integer NOT NULL,
          advance_decline_ratio double precision,
          pct_above_ma20 double precision,
          pct_above_ma50 double precision,
          equal_weighted_return double precision,
          volume_weighted_return double precision,
          dispersion double precision,
          btc_return_1h double precision,
          btc_return_4h double precision,
          btc_return_24h double precision,
          alt_basket_return_1h double precision,
          alt_basket_return_4h double precision,
          alt_basket_return_24h double precision,
          btc_vs_alt_return_1h double precision,
          btc_vs_alt_return_4h double precision,
          btc_vs_alt_return_24h double precision,
          btc_turnover_share_1h double precision,
          btc_turnover_share_24h double precision,
          btc_turnover_share_change_24h double precision,
          alt_vol_to_btc_vol_24h double precision,
          alt_dispersion_24h double precision,
          btc_alt_regime text,
          source text,
          ingested_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (universe, interval, ts)
        )
      `);
      await pool.query(`
        ALTER TABLE market_breadth
          ADD COLUMN IF NOT EXISTS btc_return_1h double precision,
          ADD COLUMN IF NOT EXISTS btc_return_4h double precision,
          ADD COLUMN IF NOT EXISTS btc_return_24h double precision,
          ADD COLUMN IF NOT EXISTS alt_basket_return_1h double precision,
          ADD COLUMN IF NOT EXISTS alt_basket_return_4h double precision,
          ADD COLUMN IF NOT EXISTS alt_basket_return_24h double precision,
          ADD COLUMN IF NOT EXISTS btc_vs_alt_return_1h double precision,
          ADD COLUMN IF NOT EXISTS btc_vs_alt_return_4h double precision,
          ADD COLUMN IF NOT EXISTS btc_vs_alt_return_24h double precision,
          ADD COLUMN IF NOT EXISTS btc_turnover_share_1h double precision,
          ADD COLUMN IF NOT EXISTS btc_turnover_share_24h double precision,
          ADD COLUMN IF NOT EXISTS btc_turnover_share_change_24h double precision,
          ADD COLUMN IF NOT EXISTS alt_vol_to_btc_vol_24h double precision,
          ADD COLUMN IF NOT EXISTS alt_dispersion_24h double precision,
          ADD COLUMN IF NOT EXISTS btc_alt_regime text
      `);
      await pool.query(`
        SELECT create_hypertable(
          'market_breadth',
          'ts',
          if_not_exists => TRUE,
          chunk_time_interval => interval '14 days'
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS market_breadth_universe_tf_ts_idx
        ON market_breadth (universe, interval, ts DESC)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS market_global_context (
          source text NOT NULL,
          ts timestamptz NOT NULL,
          updated_at_ts timestamptz,
          active_cryptocurrencies integer,
          markets integer,
          total_market_cap_usd double precision,
          total_volume_usd double precision,
          btc_dominance_pct double precision,
          eth_dominance_pct double precision,
          alt_market_cap_usd double precision,
          btc_to_alt_market_cap_ratio double precision,
          market_cap_change_pct_24h_usd double precision,
          ingested_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (source, ts)
        )
      `);
      await pool.query(`
        SELECT create_hypertable(
          'market_global_context',
          'ts',
          if_not_exists => TRUE,
          chunk_time_interval => interval '30 days'
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS market_global_context_source_ts_idx
        ON market_global_context (source, ts DESC)
      `);

      binanceMarketSchemaReady = true;
    },
  ).finally(() => {
    binanceMarketSchemaReadyPromise = null;
  });

  await binanceMarketSchemaReadyPromise;
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

export async function upsertOnchainFlowRows(rows: OnchainFlowRow[]) {
  if (!rows.length) return;
  await ensureOnchainSchema();

  const pool = getPool();
  const cols = [
    'symbol',
    'interval',
    'ts',
    'whale_net_flow_usd',
    'smart_trader_net_flow_usd',
    'cex_deposit_usd',
    'cex_withdraw_usd',
    'dex_buy_usd',
    'dex_sell_usd',
    'entity_count',
    'confidence_weighted_bias',
    'source',
  ] as const;

  const maxRows = Math.floor(65_535 / cols.length);
  if (rows.length > maxRows) {
    for (let i = 0; i < rows.length; i += maxRows) {
      await upsertOnchainFlowRows(rows.slice(i, i + maxRows));
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
    normalizeCandleSymbol(row.symbol),
    row.interval,
    row.ts,
    row.whaleNetFlowUsd ?? null,
    row.smartTraderNetFlowUsd ?? null,
    row.cexDepositUsd ?? null,
    row.cexWithdrawUsd ?? null,
    row.dexBuyUsd ?? null,
    row.dexSellUsd ?? null,
    row.entityCount ?? null,
    row.confidenceWeightedBias ?? null,
    row.source ?? 'arkham',
  ]);

  const sql = `
    INSERT INTO onchain_flow_context (${cols.join(',')})
    VALUES ${valuesSql}
    ON CONFLICT (symbol, interval, ts) DO UPDATE SET
      whale_net_flow_usd = COALESCE(EXCLUDED.whale_net_flow_usd, onchain_flow_context.whale_net_flow_usd),
      smart_trader_net_flow_usd = COALESCE(EXCLUDED.smart_trader_net_flow_usd, onchain_flow_context.smart_trader_net_flow_usd),
      cex_deposit_usd = COALESCE(EXCLUDED.cex_deposit_usd, onchain_flow_context.cex_deposit_usd),
      cex_withdraw_usd = COALESCE(EXCLUDED.cex_withdraw_usd, onchain_flow_context.cex_withdraw_usd),
      dex_buy_usd = COALESCE(EXCLUDED.dex_buy_usd, onchain_flow_context.dex_buy_usd),
      dex_sell_usd = COALESCE(EXCLUDED.dex_sell_usd, onchain_flow_context.dex_sell_usd),
      entity_count = COALESCE(EXCLUDED.entity_count, onchain_flow_context.entity_count),
      confidence_weighted_bias = COALESCE(EXCLUDED.confidence_weighted_bias, onchain_flow_context.confidence_weighted_bias),
      source = COALESCE(EXCLUDED.source, onchain_flow_context.source),
      ingested_at = now()
  `;

  await pool.query(sql, flat);
}

export async function getOnchainContextWindow(params: {
  symbol: string;
  intervals: MarketFeatureInterval[];
  endMs: number;
  lookbackMs: number;
}): Promise<Partial<Record<MarketFeatureInterval, OnchainFlowRow[]>>> {
  const { symbol, intervals, endMs, lookbackMs } = params;
  const normalizedSymbol = normalizeCandleSymbol(symbol);
  const normalizedIntervals = [...new Set(intervals)].filter(Boolean);

  if (!normalizedSymbol || !normalizedIntervals.length) {
    return {};
  }

  await ensureOnchainSchema();
  const startMs = endMs - Math.max(0, lookbackMs);
  const pool = getPool();
  const sql = `
    SELECT
      symbol,
      interval,
      ts,
      whale_net_flow_usd,
      smart_trader_net_flow_usd,
      cex_deposit_usd,
      cex_withdraw_usd,
      dex_buy_usd,
      dex_sell_usd,
      entity_count,
      confidence_weighted_bias,
      source
    FROM onchain_flow_context
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
  const rowsByInterval: Partial<
    Record<MarketFeatureInterval, OnchainFlowRow[]>
  > = {};

  for (const row of res.rows as Array<{
    symbol: string;
    interval: MarketFeatureInterval;
    ts: Date;
    whale_net_flow_usd: number | null;
    smart_trader_net_flow_usd: number | null;
    cex_deposit_usd: number | null;
    cex_withdraw_usd: number | null;
    dex_buy_usd: number | null;
    dex_sell_usd: number | null;
    entity_count: number | null;
    confidence_weighted_bias: number | null;
    source: string | null;
  }>) {
    const interval = row.interval;
    rowsByInterval[interval] ??= [];
    rowsByInterval[interval]?.push({
      symbol: row.symbol,
      interval,
      ts: row.ts,
      whaleNetFlowUsd: row.whale_net_flow_usd,
      smartTraderNetFlowUsd: row.smart_trader_net_flow_usd,
      cexDepositUsd: row.cex_deposit_usd,
      cexWithdrawUsd: row.cex_withdraw_usd,
      dexBuyUsd: row.dex_buy_usd,
      dexSellUsd: row.dex_sell_usd,
      entityCount: row.entity_count,
      confidenceWeightedBias: row.confidence_weighted_bias,
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

export async function upsertMarketTradeFlowRows(rows: MarketTradeFlowRow[]) {
  if (!rows.length) return;
  await ensureBinanceMarketSchema();

  const pool = getPool();
  const cols = [
    'symbol',
    'interval',
    'ts',
    'trades',
    'buy_base_volume',
    'sell_base_volume',
    'buy_quote_volume',
    'sell_quote_volume',
    'net_base_delta',
    'net_quote_delta',
    'buy_pressure_pct',
    'source',
  ] as const;

  const maxRows = getSafeBulkInsertRows(cols.length);
  if (rows.length > maxRows) {
    for (let i = 0; i < rows.length; i += maxRows) {
      await upsertMarketTradeFlowRows(rows.slice(i, i + maxRows));
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
    row.trades,
    row.buyBaseVolume ?? null,
    row.sellBaseVolume ?? null,
    row.buyQuoteVolume ?? null,
    row.sellQuoteVolume ?? null,
    row.netBaseDelta ?? null,
    row.netQuoteDelta ?? null,
    row.buyPressurePct ?? null,
    row.source ?? null,
  ]);

  await pool.query(
    `
      INSERT INTO market_trade_flow (${cols.join(',')})
      VALUES ${valuesSql}
      ON CONFLICT (symbol, interval, ts) DO UPDATE SET
        trades = EXCLUDED.trades,
        buy_base_volume = COALESCE(EXCLUDED.buy_base_volume, market_trade_flow.buy_base_volume),
        sell_base_volume = COALESCE(EXCLUDED.sell_base_volume, market_trade_flow.sell_base_volume),
        buy_quote_volume = COALESCE(EXCLUDED.buy_quote_volume, market_trade_flow.buy_quote_volume),
        sell_quote_volume = COALESCE(EXCLUDED.sell_quote_volume, market_trade_flow.sell_quote_volume),
        net_base_delta = COALESCE(EXCLUDED.net_base_delta, market_trade_flow.net_base_delta),
        net_quote_delta = COALESCE(EXCLUDED.net_quote_delta, market_trade_flow.net_quote_delta),
        buy_pressure_pct = COALESCE(EXCLUDED.buy_pressure_pct, market_trade_flow.buy_pressure_pct),
        source = COALESCE(EXCLUDED.source, market_trade_flow.source),
        ingested_at = now()
    `,
    flat,
  );
}

export async function upsertMarketOrderBookDepthRows(
  rows: MarketOrderBookDepthRow[],
) {
  if (!rows.length) return;
  await ensureBinanceMarketSchema();

  const pool = getPool();
  const cols = [
    'venue',
    'symbol',
    'ts',
    'last_update_id',
    'bid',
    'ask',
    'mid',
    'spread_bps',
    'levels',
    'raw_bid_levels',
    'raw_ask_levels',
    'source',
  ] as const;

  const maxRows = getSafeBulkInsertRows(cols.length);
  if (rows.length > maxRows) {
    for (let i = 0; i < rows.length; i += maxRows) {
      await upsertMarketOrderBookDepthRows(rows.slice(i, i + maxRows));
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
    row.venue,
    row.symbol,
    row.ts,
    row.lastUpdateId ?? null,
    row.bid ?? null,
    row.ask ?? null,
    row.mid ?? null,
    row.spreadBps ?? null,
    JSON.stringify(row.levels),
    row.rawBidLevels ?? null,
    row.rawAskLevels ?? null,
    row.source ?? null,
  ]);

  await pool.query(
    `
      INSERT INTO market_order_book_depth (${cols.join(',')})
      VALUES ${valuesSql}
      ON CONFLICT (venue, symbol, ts) DO UPDATE SET
        last_update_id = COALESCE(EXCLUDED.last_update_id, market_order_book_depth.last_update_id),
        bid = COALESCE(EXCLUDED.bid, market_order_book_depth.bid),
        ask = COALESCE(EXCLUDED.ask, market_order_book_depth.ask),
        mid = COALESCE(EXCLUDED.mid, market_order_book_depth.mid),
        spread_bps = COALESCE(EXCLUDED.spread_bps, market_order_book_depth.spread_bps),
        levels = EXCLUDED.levels,
        raw_bid_levels = COALESCE(EXCLUDED.raw_bid_levels, market_order_book_depth.raw_bid_levels),
        raw_ask_levels = COALESCE(EXCLUDED.raw_ask_levels, market_order_book_depth.raw_ask_levels),
        source = COALESCE(EXCLUDED.source, market_order_book_depth.source),
        ingested_at = now()
    `,
    flat,
  );
}

export async function upsertMarketBreadthRows(rows: MarketBreadthRow[]) {
  if (!rows.length) return;
  await ensureBinanceMarketSchema();

  const pool = getPool();
  const cols = [
    'universe',
    'interval',
    'ts',
    'symbols_count',
    'advancers',
    'decliners',
    'unchanged',
    'advance_decline_ratio',
    'pct_above_ma20',
    'pct_above_ma50',
    'equal_weighted_return',
    'volume_weighted_return',
    'dispersion',
    'btc_return_1h',
    'btc_return_4h',
    'btc_return_24h',
    'alt_basket_return_1h',
    'alt_basket_return_4h',
    'alt_basket_return_24h',
    'btc_vs_alt_return_1h',
    'btc_vs_alt_return_4h',
    'btc_vs_alt_return_24h',
    'btc_turnover_share_1h',
    'btc_turnover_share_24h',
    'btc_turnover_share_change_24h',
    'alt_vol_to_btc_vol_24h',
    'alt_dispersion_24h',
    'btc_alt_regime',
    'source',
  ] as const;

  const maxRows = getSafeBulkInsertRows(cols.length);
  if (rows.length > maxRows) {
    for (let i = 0; i < rows.length; i += maxRows) {
      await upsertMarketBreadthRows(rows.slice(i, i + maxRows));
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
    row.universe,
    row.interval,
    row.ts,
    row.symbolsCount,
    row.advancers,
    row.decliners,
    row.unchanged,
    row.advanceDeclineRatio ?? null,
    row.pctAboveMa20 ?? null,
    row.pctAboveMa50 ?? null,
    row.equalWeightedReturn ?? null,
    row.volumeWeightedReturn ?? null,
    row.dispersion ?? null,
    row.btcReturn1h ?? null,
    row.btcReturn4h ?? null,
    row.btcReturn24h ?? null,
    row.altBasketReturn1h ?? null,
    row.altBasketReturn4h ?? null,
    row.altBasketReturn24h ?? null,
    row.btcVsAltReturn1h ?? null,
    row.btcVsAltReturn4h ?? null,
    row.btcVsAltReturn24h ?? null,
    row.btcTurnoverShare1h ?? null,
    row.btcTurnoverShare24h ?? null,
    row.btcTurnoverShareChange24h ?? null,
    row.altVolToBtcVol24h ?? null,
    row.altDispersion24h ?? null,
    row.btcAltRegime ?? null,
    row.source ?? null,
  ]);

  await pool.query(
    `
      INSERT INTO market_breadth (${cols.join(',')})
      VALUES ${valuesSql}
      ON CONFLICT (universe, interval, ts) DO UPDATE SET
        symbols_count = EXCLUDED.symbols_count,
        advancers = EXCLUDED.advancers,
        decliners = EXCLUDED.decliners,
        unchanged = EXCLUDED.unchanged,
        advance_decline_ratio = COALESCE(EXCLUDED.advance_decline_ratio, market_breadth.advance_decline_ratio),
        pct_above_ma20 = COALESCE(EXCLUDED.pct_above_ma20, market_breadth.pct_above_ma20),
        pct_above_ma50 = COALESCE(EXCLUDED.pct_above_ma50, market_breadth.pct_above_ma50),
        equal_weighted_return = COALESCE(EXCLUDED.equal_weighted_return, market_breadth.equal_weighted_return),
        volume_weighted_return = COALESCE(EXCLUDED.volume_weighted_return, market_breadth.volume_weighted_return),
        dispersion = COALESCE(EXCLUDED.dispersion, market_breadth.dispersion),
        btc_return_1h = COALESCE(EXCLUDED.btc_return_1h, market_breadth.btc_return_1h),
        btc_return_4h = COALESCE(EXCLUDED.btc_return_4h, market_breadth.btc_return_4h),
        btc_return_24h = COALESCE(EXCLUDED.btc_return_24h, market_breadth.btc_return_24h),
        alt_basket_return_1h = COALESCE(EXCLUDED.alt_basket_return_1h, market_breadth.alt_basket_return_1h),
        alt_basket_return_4h = COALESCE(EXCLUDED.alt_basket_return_4h, market_breadth.alt_basket_return_4h),
        alt_basket_return_24h = COALESCE(EXCLUDED.alt_basket_return_24h, market_breadth.alt_basket_return_24h),
        btc_vs_alt_return_1h = COALESCE(EXCLUDED.btc_vs_alt_return_1h, market_breadth.btc_vs_alt_return_1h),
        btc_vs_alt_return_4h = COALESCE(EXCLUDED.btc_vs_alt_return_4h, market_breadth.btc_vs_alt_return_4h),
        btc_vs_alt_return_24h = COALESCE(EXCLUDED.btc_vs_alt_return_24h, market_breadth.btc_vs_alt_return_24h),
        btc_turnover_share_1h = COALESCE(EXCLUDED.btc_turnover_share_1h, market_breadth.btc_turnover_share_1h),
        btc_turnover_share_24h = COALESCE(EXCLUDED.btc_turnover_share_24h, market_breadth.btc_turnover_share_24h),
        btc_turnover_share_change_24h = COALESCE(EXCLUDED.btc_turnover_share_change_24h, market_breadth.btc_turnover_share_change_24h),
        alt_vol_to_btc_vol_24h = COALESCE(EXCLUDED.alt_vol_to_btc_vol_24h, market_breadth.alt_vol_to_btc_vol_24h),
        alt_dispersion_24h = COALESCE(EXCLUDED.alt_dispersion_24h, market_breadth.alt_dispersion_24h),
        btc_alt_regime = COALESCE(EXCLUDED.btc_alt_regime, market_breadth.btc_alt_regime),
        source = COALESCE(EXCLUDED.source, market_breadth.source),
        ingested_at = now()
    `,
    flat,
  );
}

export async function upsertMarketGlobalContextRows(
  rows: MarketGlobalContextRow[],
) {
  if (!rows.length) return;
  await ensureBinanceMarketSchema();

  const pool = getPool();
  const cols = [
    'source',
    'ts',
    'updated_at_ts',
    'active_cryptocurrencies',
    'markets',
    'total_market_cap_usd',
    'total_volume_usd',
    'btc_dominance_pct',
    'eth_dominance_pct',
    'alt_market_cap_usd',
    'btc_to_alt_market_cap_ratio',
    'market_cap_change_pct_24h_usd',
  ] as const;

  const maxRows = getSafeBulkInsertRows(cols.length);
  if (rows.length > maxRows) {
    for (let i = 0; i < rows.length; i += maxRows) {
      await upsertMarketGlobalContextRows(rows.slice(i, i + maxRows));
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
    row.source,
    row.ts,
    row.updatedAt ?? null,
    row.activeCryptocurrencies ?? null,
    row.markets ?? null,
    row.totalMarketCapUsd ?? null,
    row.totalVolumeUsd ?? null,
    row.btcDominancePct ?? null,
    row.ethDominancePct ?? null,
    row.altMarketCapUsd ?? null,
    row.btcToAltMarketCapRatio ?? null,
    row.marketCapChangePct24hUsd ?? null,
  ]);

  await pool.query(
    `
      INSERT INTO market_global_context (${cols.join(',')})
      VALUES ${valuesSql}
      ON CONFLICT (source, ts) DO UPDATE SET
        updated_at_ts = COALESCE(EXCLUDED.updated_at_ts, market_global_context.updated_at_ts),
        active_cryptocurrencies = COALESCE(EXCLUDED.active_cryptocurrencies, market_global_context.active_cryptocurrencies),
        markets = COALESCE(EXCLUDED.markets, market_global_context.markets),
        total_market_cap_usd = COALESCE(EXCLUDED.total_market_cap_usd, market_global_context.total_market_cap_usd),
        total_volume_usd = COALESCE(EXCLUDED.total_volume_usd, market_global_context.total_volume_usd),
        btc_dominance_pct = COALESCE(EXCLUDED.btc_dominance_pct, market_global_context.btc_dominance_pct),
        eth_dominance_pct = COALESCE(EXCLUDED.eth_dominance_pct, market_global_context.eth_dominance_pct),
        alt_market_cap_usd = COALESCE(EXCLUDED.alt_market_cap_usd, market_global_context.alt_market_cap_usd),
        btc_to_alt_market_cap_ratio = COALESCE(EXCLUDED.btc_to_alt_market_cap_ratio, market_global_context.btc_to_alt_market_cap_ratio),
        market_cap_change_pct_24h_usd = COALESCE(EXCLUDED.market_cap_change_pct_24h_usd, market_global_context.market_cap_change_pct_24h_usd),
        ingested_at = now()
    `,
    flat,
  );
}

export type MarketFeatureAsOf<T> = T & {
  ageMs: number | null;
  stale: boolean;
};

const toMarketFeatureAge = (rowTs: Date, atMs: number) => {
  const ageMs = atMs - rowTs.getTime();
  return Number.isFinite(ageMs) ? ageMs : null;
};

export async function getLatestMarketTradeFlow(params: {
  symbol: string;
  interval: MarketFeatureInterval;
  atMs: number;
  maxAgeMs?: number;
}): Promise<MarketFeatureAsOf<MarketTradeFlowRow> | null> {
  await ensureBinanceMarketSchema();
  const pool = getPool();
  const res = await pool.query(
    `
      SELECT
        symbol,
        interval,
        ts,
        trades::int AS trades,
        buy_base_volume AS "buyBaseVolume",
        sell_base_volume AS "sellBaseVolume",
        buy_quote_volume AS "buyQuoteVolume",
        sell_quote_volume AS "sellQuoteVolume",
        net_base_delta AS "netBaseDelta",
        net_quote_delta AS "netQuoteDelta",
        buy_pressure_pct AS "buyPressurePct",
        source
      FROM market_trade_flow
      WHERE symbol = $1
        AND interval = $2
        AND ts <= to_timestamp($3/1000.0)
      ORDER BY ts DESC
      LIMIT 1
    `,
    [params.symbol.toUpperCase(), params.interval, params.atMs],
  );
  const row = res.rows[0] as MarketTradeFlowRow | undefined;
  if (!row) return null;
  const ageMs = toMarketFeatureAge(row.ts, params.atMs);
  return {
    ...row,
    ageMs,
    stale:
      ageMs == null || (params.maxAgeMs != null && ageMs > params.maxAgeMs),
  };
}

export async function getLatestMarketOrderBookDepth(params: {
  venue: string;
  symbol: string;
  atMs: number;
  maxAgeMs?: number;
}): Promise<MarketFeatureAsOf<MarketOrderBookDepthRow> | null> {
  await ensureBinanceMarketSchema();
  const pool = getPool();
  const res = await pool.query(
    `
      SELECT
        venue,
        symbol,
        ts,
        last_update_id AS "lastUpdateId",
        bid,
        ask,
        mid,
        spread_bps AS "spreadBps",
        levels,
        raw_bid_levels AS "rawBidLevels",
        raw_ask_levels AS "rawAskLevels",
        source
      FROM market_order_book_depth
      WHERE venue = $1
        AND symbol = $2
        AND ts <= to_timestamp($3/1000.0)
      ORDER BY ts DESC
      LIMIT 1
    `,
    [params.venue.toLowerCase(), params.symbol.toUpperCase(), params.atMs],
  );
  const row = res.rows[0] as MarketOrderBookDepthRow | undefined;
  if (!row) return null;
  const ageMs = toMarketFeatureAge(row.ts, params.atMs);
  return {
    ...row,
    ageMs,
    stale:
      ageMs == null || (params.maxAgeMs != null && ageMs > params.maxAgeMs),
  };
}

export async function getLatestMarketBreadth(params: {
  universe: string;
  interval: MarketFeatureInterval;
  atMs: number;
  maxAgeMs?: number;
}): Promise<MarketFeatureAsOf<MarketBreadthRow> | null> {
  await ensureBinanceMarketSchema();
  const pool = getPool();
  const res = await pool.query(
    `
      SELECT
        universe,
        interval,
        ts,
        symbols_count::int AS "symbolsCount",
        advancers::int AS advancers,
        decliners::int AS decliners,
        unchanged::int AS unchanged,
        advance_decline_ratio AS "advanceDeclineRatio",
        pct_above_ma20 AS "pctAboveMa20",
        pct_above_ma50 AS "pctAboveMa50",
        equal_weighted_return AS "equalWeightedReturn",
        volume_weighted_return AS "volumeWeightedReturn",
        dispersion,
        btc_return_1h AS "btcReturn1h",
        btc_return_4h AS "btcReturn4h",
        btc_return_24h AS "btcReturn24h",
        alt_basket_return_1h AS "altBasketReturn1h",
        alt_basket_return_4h AS "altBasketReturn4h",
        alt_basket_return_24h AS "altBasketReturn24h",
        btc_vs_alt_return_1h AS "btcVsAltReturn1h",
        btc_vs_alt_return_4h AS "btcVsAltReturn4h",
        btc_vs_alt_return_24h AS "btcVsAltReturn24h",
        btc_turnover_share_1h AS "btcTurnoverShare1h",
        btc_turnover_share_24h AS "btcTurnoverShare24h",
        btc_turnover_share_change_24h AS "btcTurnoverShareChange24h",
        alt_vol_to_btc_vol_24h AS "altVolToBtcVol24h",
        alt_dispersion_24h AS "altDispersion24h",
        btc_alt_regime AS "btcAltRegime",
        source
      FROM market_breadth
      WHERE universe = $1
        AND interval = $2
        AND ts <= to_timestamp($3/1000.0)
      ORDER BY ts DESC
      LIMIT 1
    `,
    [params.universe, params.interval, params.atMs],
  );
  const row = res.rows[0] as MarketBreadthRow | undefined;
  if (!row) return null;
  const ageMs = toMarketFeatureAge(row.ts, params.atMs);
  return {
    ...row,
    ageMs,
    stale:
      ageMs == null || (params.maxAgeMs != null && ageMs > params.maxAgeMs),
  };
}

export async function getLatestMarketGlobalContext(params: {
  source?: MarketGlobalContextRow['source'];
  atMs: number;
  maxAgeMs?: number;
}): Promise<
  | (MarketFeatureAsOf<MarketGlobalContextRow> & {
      btcDominanceChange24hPct: number | null;
    })
  | null
> {
  await ensureBinanceMarketSchema();
  const pool = getPool();
  const source = params.source ?? 'coingecko_global';
  const res = await pool.query(
    `
      SELECT
        source,
        ts,
        updated_at_ts AS "updatedAt",
        active_cryptocurrencies::int AS "activeCryptocurrencies",
        markets::int AS markets,
        total_market_cap_usd AS "totalMarketCapUsd",
        total_volume_usd AS "totalVolumeUsd",
        btc_dominance_pct AS "btcDominancePct",
        eth_dominance_pct AS "ethDominancePct",
        alt_market_cap_usd AS "altMarketCapUsd",
        btc_to_alt_market_cap_ratio AS "btcToAltMarketCapRatio",
        market_cap_change_pct_24h_usd AS "marketCapChangePct24hUsd"
      FROM market_global_context
      WHERE source = $1
        AND ts <= to_timestamp($2/1000.0)
      ORDER BY ts DESC
      LIMIT 1
    `,
    [source, params.atMs],
  );
  const row = res.rows[0] as MarketGlobalContextRow | undefined;
  if (!row) return null;

  const previousRes = await pool.query(
    `
      SELECT btc_dominance_pct AS "btcDominancePct"
      FROM market_global_context
      WHERE source = $1
        AND ts <= $2::timestamptz - interval '24 hours'
        AND btc_dominance_pct IS NOT NULL
      ORDER BY ts DESC
      LIMIT 1
    `,
    [source, row.ts],
  );
  const previousDominance =
    previousRes.rows[0]?.btcDominancePct == null
      ? null
      : Number(previousRes.rows[0].btcDominancePct);
  const currentDominance =
    row.btcDominancePct == null ? null : Number(row.btcDominancePct);
  const ageMs = toMarketFeatureAge(row.ts, params.atMs);

  return {
    ...row,
    ageMs,
    stale:
      ageMs == null || (params.maxAgeMs != null && ageMs > params.maxAgeMs),
    btcDominanceChange24hPct:
      currentDominance != null && previousDominance != null
        ? currentDominance - previousDominance
        : null,
  };
}

export async function getMarketTradeFlowCoverage(params: {
  symbols: string[];
  interval: MarketFeatureInterval;
  startMs: number;
  endMs: number;
}): Promise<Map<string, { firstMs: number; lastMs: number; rows: number }>> {
  const symbols = [
    ...new Set(params.symbols.map((item) => item.toUpperCase())),
  ];
  if (!symbols.length) return new Map();
  await ensureBinanceMarketSchema();
  const pool = getPool();
  const res = await pool.query(
    `
      SELECT
        symbol,
        MIN(ts) AS first_ts,
        MAX(ts) AS last_ts,
        COUNT(*)::int AS rows
      FROM market_trade_flow
      WHERE symbol = ANY($1)
        AND interval = $2
        AND ts >= to_timestamp($3/1000.0)
        AND ts <= to_timestamp($4/1000.0)
      GROUP BY symbol
    `,
    [symbols, params.interval, params.startMs, params.endMs],
  );
  return new Map(
    res.rows.map((row) => [
      String(row.symbol).toUpperCase(),
      {
        firstMs: new Date(row.first_ts).getTime(),
        lastMs: new Date(row.last_ts).getTime(),
        rows: Number(row.rows) || 0,
      },
    ]),
  );
}

export async function getMarketBreadthCoverage(params: {
  universe: string;
  interval: MarketFeatureInterval;
  startMs: number;
  endMs: number;
}): Promise<{
  firstMs: number;
  lastMs: number;
  rows: number;
  btcAltMetricsRows: number;
} | null> {
  await ensureBinanceMarketSchema();
  const pool = getPool();
  const res = await pool.query(
    `
      SELECT
        MIN(ts) AS first_ts,
        MAX(ts) AS last_ts,
        COUNT(*)::int AS rows,
        COUNT(*) FILTER (
          WHERE btc_alt_regime IS NOT NULL
            AND btc_return_24h IS NOT NULL
            AND alt_basket_return_24h IS NOT NULL
        )::int AS btc_alt_metrics_rows
      FROM market_breadth
      WHERE universe = $1
        AND interval = $2
        AND ts >= to_timestamp($3/1000.0)
        AND ts <= to_timestamp($4/1000.0)
    `,
    [params.universe, params.interval, params.startMs, params.endMs],
  );
  const row = res.rows[0];
  if (!row?.first_ts || !row?.last_ts) return null;
  return {
    firstMs: new Date(row.first_ts).getTime(),
    lastMs: new Date(row.last_ts).getTime(),
    rows: Number(row.rows) || 0,
    btcAltMetricsRows: Number(row.btc_alt_metrics_rows) || 0,
  };
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
