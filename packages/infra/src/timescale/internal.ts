import { closePool, getPool } from './pool';
import { queryMarketContext } from './query';
export { getPool } from './pool';
export {
  queryMarketContext,
  type TimescaleMarketContextQueryOptions,
} from './query';
export {
  getSafeBulkInsertRows,
  normalizeCandleProvider,
  normalizeCandleSymbol,
  toMarketFeatureAge,
  type MarketFeatureAsOf,
} from './values';

let candlesSchemaReady = false;
let derivativesSchemaReady = false;
let spreadSchemaReady = false;
let binanceMarketSchemaReady = false;
let hyperliquidWhaleSchemaReady = false;
let candlesSchemaReadyPromise: Promise<void> | null = null;
let derivativesSchemaReadyPromise: Promise<void> | null = null;
let spreadSchemaReadyPromise: Promise<void> | null = null;
let binanceMarketSchemaReadyPromise: Promise<void> | null = null;
let hyperliquidWhaleSchemaReadyPromise: Promise<void> | null = null;

export type TimescaleMarketContextSource =
  | 'binance'
  | 'coinmarketcap'
  | 'derivatives'
  | 'hyperliquidWhales';

let marketContextSchemaMode: 'ensure' | 'verify' = 'ensure';
const verifiedMarketContextSchemas = new Set<TimescaleMarketContextSource>();

export const configureTimescaleMarketContextSchemaMode = (
  mode: 'ensure' | 'verify',
) => {
  marketContextSchemaMode = mode;
  verifiedMarketContextSchemas.clear();
};

export const closeTimescalePool = async (): Promise<void> => {
  candlesSchemaReady = false;
  derivativesSchemaReady = false;
  spreadSchemaReady = false;
  binanceMarketSchemaReady = false;
  hyperliquidWhaleSchemaReady = false;
  candlesSchemaReadyPromise = null;
  derivativesSchemaReadyPromise = null;
  spreadSchemaReadyPromise = null;
  binanceMarketSchemaReadyPromise = null;
  hyperliquidWhaleSchemaReadyPromise = null;
  verifiedMarketContextSchemas.clear();
  await closePool();
};

const CANDLES_SCHEMA_LOCK_KEY = 610000;
const DERIVATIVES_SCHEMA_LOCK_KEY = 610001;
const SPREAD_SCHEMA_LOCK_KEY = 610002;
const BINANCE_MARKET_SCHEMA_LOCK_KEY = 610003;
const HYPERLIQUID_WHALE_SCHEMA_LOCK_KEY = 610004;
const withSchemaLock = async (lockKey: number, work: () => Promise<void>) => {
  const pool = getPool();
  await pool.query('SELECT pg_advisory_lock($1)', [lockKey]);
  try {
    await work();
  } finally {
    await pool.query('SELECT pg_advisory_unlock($1)', [lockKey]);
  }
};

export const ensureCandlesSchema = async () => {
  if (candlesSchemaReady) return;
  if (candlesSchemaReadyPromise) {
    await candlesSchemaReadyPromise;
    return;
  }

  candlesSchemaReadyPromise = withSchemaLock(
    CANDLES_SCHEMA_LOCK_KEY,
    async () => {
      const pool = getPool();
      await pool.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS candles (
          provider text NOT NULL DEFAULT 'bybit',
          symbol text NOT NULL,
          interval integer NOT NULL,
          ts timestamptz NOT NULL,
          open double precision NOT NULL,
          high double precision NOT NULL,
          low double precision NOT NULL,
          close double precision NOT NULL,
          volume double precision,
          turnover double precision,
          taker_buy_base_volume double precision,
          taker_buy_quote_volume double precision,
          taker_sell_base_volume double precision,
          taker_sell_quote_volume double precision,
          PRIMARY KEY (provider, symbol, interval, ts)
        )
      `);
      await pool.query(`
        SELECT create_hypertable(
          'candles',
          'ts',
          if_not_exists => TRUE,
          chunk_time_interval => interval '7 days'
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS candles_provider_symbol_interval_ts_idx
        ON candles (provider, symbol, interval, ts DESC)
      `);
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

export const ensureDerivativesSchema = async () => {
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
      await pool.query(`
        CREATE TABLE IF NOT EXISTS derivatives_metric_coverage (
          source text NOT NULL,
          metric text NOT NULL,
          symbol text NOT NULL,
          interval text NOT NULL,
          from_ts timestamptz NOT NULL,
          to_ts timestamptz NOT NULL,
          event_rows_count integer NOT NULL DEFAULT 0,
          zero_rows_count integer NOT NULL DEFAULT 0,
          checked_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (source, metric, symbol, interval, from_ts, to_ts)
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS derivatives_metric_coverage_lookup_idx
        ON derivatives_metric_coverage (
          source,
          metric,
          symbol,
          interval,
          from_ts,
          to_ts
        )
      `);
      derivativesSchemaReady = true;
    },
  ).finally(() => {
    derivativesSchemaReadyPromise = null;
  });

  await derivativesSchemaReadyPromise;
};

export const ensureSpreadSchema = async () => {
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

export const ensureBinanceMarketSchema = async () => {
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
          active_exchanges integer,
          active_market_pairs integer,
          markets integer,
          total_market_cap_usd double precision,
          total_volume_usd double precision,
          total_volume_reported_usd double precision,
          btc_dominance_pct double precision,
          eth_dominance_pct double precision,
          alt_market_cap_usd double precision,
          alt_volume_usd double precision,
          alt_volume_reported_usd double precision,
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
      await pool.query(`
        ALTER TABLE market_global_context
          ADD COLUMN IF NOT EXISTS active_exchanges integer,
          ADD COLUMN IF NOT EXISTS active_market_pairs integer,
          ADD COLUMN IF NOT EXISTS total_volume_reported_usd double precision,
          ADD COLUMN IF NOT EXISTS alt_volume_usd double precision,
          ADD COLUMN IF NOT EXISTS alt_volume_reported_usd double precision
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS market_reference_asset_context (
          source text NOT NULL,
          symbol text NOT NULL,
          cmc_id integer NOT NULL,
          interval text NOT NULL,
          ts timestamptz NOT NULL,
          open_usd double precision,
          high_usd double precision,
          low_usd double precision,
          close_usd double precision,
          volume_usd double precision,
          market_cap_usd double precision,
          ingested_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (source, symbol, interval, ts)
        )
      `);
      await pool.query(`
        SELECT create_hypertable(
          'market_reference_asset_context',
          'ts',
          if_not_exists => TRUE,
          chunk_time_interval => interval '30 days'
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS market_reference_asset_context_lookup_idx
        ON market_reference_asset_context (source, symbol, interval, ts DESC)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS market_cmc_exchange_liquidity_context (
          source text NOT NULL,
          interval text NOT NULL,
          ts timestamptz NOT NULL,
          exchanges_count integer NOT NULL,
          total_volume_usd double precision,
          binance_volume_usd double precision,
          binance_volume_share double precision,
          top_exchange_volume_share double precision,
          liquidity_regime text,
          ingested_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (source, interval, ts)
        )
      `);
      await pool.query(`
        SELECT create_hypertable(
          'market_cmc_exchange_liquidity_context',
          'ts',
          if_not_exists => TRUE,
          chunk_time_interval => interval '30 days'
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS market_cmc_exchange_liquidity_context_lookup_idx
        ON market_cmc_exchange_liquidity_context (source, interval, ts DESC)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS market_cmc_fear_greed_context (
          source text NOT NULL,
          interval text NOT NULL,
          ts timestamptz NOT NULL,
          value integer NOT NULL,
          classification text NOT NULL,
          sentiment_regime text NOT NULL,
          ingested_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (source, interval, ts)
        )
      `);
      await pool.query(`
        SELECT create_hypertable(
          'market_cmc_fear_greed_context',
          'ts',
          if_not_exists => TRUE,
          chunk_time_interval => interval '30 days'
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS market_cmc_fear_greed_context_lookup_idx
        ON market_cmc_fear_greed_context (source, interval, ts DESC)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS market_cmc_index_context (
          source text NOT NULL,
          index_slug text NOT NULL,
          interval text NOT NULL,
          ts timestamptz NOT NULL,
          value double precision NOT NULL,
          constituents_count integer,
          top_constituent_symbol text,
          top_constituent_weight_pct double precision,
          constituents jsonb,
          ingested_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (source, index_slug, interval, ts)
        )
      `);
      await pool.query(`
        SELECT create_hypertable(
          'market_cmc_index_context',
          'ts',
          if_not_exists => TRUE,
          chunk_time_interval => interval '30 days'
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS market_cmc_index_context_lookup_idx
        ON market_cmc_index_context (source, index_slug, interval, ts DESC)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS market_context_backfill_coverage (
          source text NOT NULL,
          scope text NOT NULL,
          interval text NOT NULL,
          from_ts timestamptz NOT NULL,
          to_ts timestamptz NOT NULL,
          rows_count integer NOT NULL DEFAULT 0,
          checked_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (source, scope, interval, from_ts, to_ts)
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS market_context_backfill_coverage_lookup_idx
        ON market_context_backfill_coverage (source, scope, interval, from_ts, to_ts)
      `);

      binanceMarketSchemaReady = true;
    },
  ).finally(() => {
    binanceMarketSchemaReadyPromise = null;
  });

  await binanceMarketSchemaReadyPromise;
};

export const ensureHyperliquidWhaleSchema = async () => {
  if (hyperliquidWhaleSchemaReady) return;
  if (hyperliquidWhaleSchemaReadyPromise) {
    await hyperliquidWhaleSchemaReadyPromise;
    return;
  }

  hyperliquidWhaleSchemaReadyPromise = withSchemaLock(
    HYPERLIQUID_WHALE_SCHEMA_LOCK_KEY,
    async () => {
      if (hyperliquidWhaleSchemaReady) return;
      const pool = getPool();
      await pool.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS hyperliquid_whale_trade_events (
          symbol text NOT NULL,
          ts timestamptz NOT NULL,
          tid text NOT NULL,
          price double precision NOT NULL,
          size double precision NOT NULL,
          notional_usd double precision NOT NULL,
          buyer_address text,
          seller_address text,
          buyer_tracked boolean NOT NULL,
          seller_tracked boolean NOT NULL,
          buyer_start_position double precision,
          buyer_end_position double precision,
          buyer_position_action text,
          buyer_closed_pnl double precision,
          buyer_liquidation boolean,
          seller_start_position double precision,
          seller_end_position double precision,
          seller_position_action text,
          seller_closed_pnl double precision,
          seller_liquidation boolean,
          universe_fingerprint text NOT NULL,
          whale_registry_fingerprint text NOT NULL,
          source text,
          ingested_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (
            universe_fingerprint,
            whale_registry_fingerprint,
            symbol,
            ts,
            tid
          )
        )
      `);
      await pool.query(`
        ALTER TABLE hyperliquid_whale_trade_events
          ADD COLUMN IF NOT EXISTS buyer_start_position double precision,
          ADD COLUMN IF NOT EXISTS buyer_end_position double precision,
          ADD COLUMN IF NOT EXISTS buyer_position_action text,
          ADD COLUMN IF NOT EXISTS buyer_closed_pnl double precision,
          ADD COLUMN IF NOT EXISTS buyer_liquidation boolean,
          ADD COLUMN IF NOT EXISTS seller_start_position double precision,
          ADD COLUMN IF NOT EXISTS seller_end_position double precision,
          ADD COLUMN IF NOT EXISTS seller_position_action text,
          ADD COLUMN IF NOT EXISTS seller_closed_pnl double precision,
          ADD COLUMN IF NOT EXISTS seller_liquidation boolean
      `);
      await pool.query(`
        SELECT create_hypertable(
          'hyperliquid_whale_trade_events',
          'ts',
          if_not_exists => TRUE,
          chunk_time_interval => interval '1 day'
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS hyperliquid_whale_events_lookup_idx
        ON hyperliquid_whale_trade_events (
          universe_fingerprint,
          whale_registry_fingerprint,
          symbol,
          ts DESC
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS hyperliquid_whale_flow (
          symbol text NOT NULL,
          interval text NOT NULL,
          ts timestamptz NOT NULL,
          trades integer NOT NULL,
          whale_sides integer NOT NULL,
          unique_whales integer NOT NULL,
          whale_addresses text[] NOT NULL DEFAULT '{}',
          buy_notional_usd double precision NOT NULL,
          sell_notional_usd double precision NOT NULL,
          net_notional_usd double precision NOT NULL,
          buy_share_pct double precision,
          position_aware_whale_sides integer NOT NULL DEFAULT 0,
          long_entry_whale_addresses text[] NOT NULL DEFAULT '{}',
          short_entry_whale_addresses text[] NOT NULL DEFAULT '{}',
          long_exit_whale_addresses text[] NOT NULL DEFAULT '{}',
          short_exit_whale_addresses text[] NOT NULL DEFAULT '{}',
          long_entry_notional_usd double precision NOT NULL DEFAULT 0,
          short_entry_notional_usd double precision NOT NULL DEFAULT 0,
          long_exit_notional_usd double precision NOT NULL DEFAULT 0,
          short_exit_notional_usd double precision NOT NULL DEFAULT 0,
          entry_net_notional_usd double precision NOT NULL DEFAULT 0,
          entry_long_share_pct double precision,
          universe_fingerprint text NOT NULL,
          whale_registry_fingerprint text NOT NULL,
          source text,
          ingested_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (
            universe_fingerprint,
            whale_registry_fingerprint,
            symbol,
            interval,
            ts
          )
        )
      `);
      await pool.query(`
        ALTER TABLE hyperliquid_whale_flow
          ADD COLUMN IF NOT EXISTS position_aware_whale_sides integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS long_entry_whale_addresses text[] NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS short_entry_whale_addresses text[] NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS long_exit_whale_addresses text[] NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS short_exit_whale_addresses text[] NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS long_entry_notional_usd double precision NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS short_entry_notional_usd double precision NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS long_exit_notional_usd double precision NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS short_exit_notional_usd double precision NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS entry_net_notional_usd double precision NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS entry_long_share_pct double precision
      `);
      await pool.query(`
        SELECT create_hypertable(
          'hyperliquid_whale_flow',
          'ts',
          if_not_exists => TRUE,
          chunk_time_interval => interval '7 days'
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS hyperliquid_whale_flow_lookup_idx
        ON hyperliquid_whale_flow (
          universe_fingerprint,
          whale_registry_fingerprint,
          symbol,
          interval,
          ts DESC
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS hyperliquid_whale_wallet_coverage (
          universe_fingerprint text NOT NULL,
          whale_registry_fingerprint text NOT NULL,
          address text NOT NULL,
          requested_from_ts timestamptz NOT NULL,
          requested_to_ts timestamptz NOT NULL,
          covered_from_ts timestamptz,
          covered_to_ts timestamptz,
          status text NOT NULL CHECK (status IN ('complete', 'truncated', 'failed')),
          fills_count integer NOT NULL DEFAULT 0,
          error text,
          data_model_version integer NOT NULL DEFAULT 2,
          checked_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (
            universe_fingerprint,
            whale_registry_fingerprint,
            address,
            requested_from_ts,
            requested_to_ts
          )
        )
      `);
      await pool.query(`
        ALTER TABLE hyperliquid_whale_wallet_coverage
          ADD COLUMN IF NOT EXISTS data_model_version integer NOT NULL DEFAULT 2
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS hyperliquid_whale_wallet_coverage_lookup_idx
        ON hyperliquid_whale_wallet_coverage (
          universe_fingerprint,
          whale_registry_fingerprint,
          address,
          requested_from_ts,
          requested_to_ts
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS hyperliquid_whale_coverage_1m (
          ts timestamptz NOT NULL,
          covered_whales integer NOT NULL,
          expected_whales integer NOT NULL,
          coverage_pct double precision NOT NULL,
          universe_fingerprint text NOT NULL,
          whale_registry_fingerprint text NOT NULL,
          source text,
          data_model_version integer NOT NULL DEFAULT 2,
          ingested_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (
            universe_fingerprint,
            whale_registry_fingerprint,
            ts
          )
        )
      `);
      await pool.query(`
        ALTER TABLE hyperliquid_whale_coverage_1m
          ADD COLUMN IF NOT EXISTS data_model_version integer NOT NULL DEFAULT 2
      `);
      await pool.query(`
        SELECT create_hypertable(
          'hyperliquid_whale_coverage_1m',
          'ts',
          if_not_exists => TRUE,
          chunk_time_interval => interval '7 days'
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS hyperliquid_whale_coverage_1m_lookup_idx
        ON hyperliquid_whale_coverage_1m (
          universe_fingerprint,
          whale_registry_fingerprint,
          ts DESC
        )
      `);
      hyperliquidWhaleSchemaReady = true;
    },
  ).finally(() => {
    hyperliquidWhaleSchemaReadyPromise = null;
  });

  await hyperliquidWhaleSchemaReadyPromise;
};

/**
 * CoinMarketCap tables currently share the historical market-context migration
 * with the Binance tables. Keeping a source-specific entrypoint lets process
 * composition own schema preparation without exposing that storage detail.
 */
export const ensureCoinMarketCapContextSchema = async () =>
  ensureBinanceMarketSchema();

const ensureMarketContextSchema = async (
  source: TimescaleMarketContextSource,
) => {
  switch (source) {
    case 'binance':
      return ensureBinanceMarketSchema();
    case 'coinmarketcap':
      return ensureCoinMarketCapContextSchema();
    case 'derivatives':
      return ensureDerivativesSchema();
    case 'hyperliquidWhales':
      return ensureHyperliquidWhaleSchema();
  }
};

const MARKET_CONTEXT_SCHEMA_TABLES: Record<
  TimescaleMarketContextSource,
  readonly string[]
> = {
  binance: ['market_trade_flow', 'market_breadth'],
  coinmarketcap: [
    'market_global_context',
    'market_reference_asset_context',
    'market_cmc_exchange_liquidity_context',
    'market_cmc_fear_greed_context',
    'market_cmc_index_context',
  ],
  derivatives: ['derivatives_market'],
  hyperliquidWhales: [
    'hyperliquid_whale_flow',
    'hyperliquid_whale_coverage_1m',
  ],
};

const verifyMarketContextSchema = async (
  source: TimescaleMarketContextSource,
) => {
  if (verifiedMarketContextSchemas.has(source)) return;
  const tables = MARKET_CONTEXT_SCHEMA_TABLES[source];
  const result = await queryMarketContext<{ tableName: string | null }>(
    `
      SELECT table_name AS "tableName"
      FROM unnest($1::text[]) AS requested(table_name)
      WHERE to_regclass(requested.table_name) IS NULL
    `,
    [tables],
  );
  if (result.rows.length) {
    throw new Error(
      `Timescale ${source} schema is not prepared; missing: ${result.rows
        .map((row) => row.tableName)
        .filter(Boolean)
        .join(', ')}`,
    );
  }
  verifiedMarketContextSchemas.add(source);
};

export const prepareMarketContextSchemaForRead = async (
  source: TimescaleMarketContextSource,
) =>
  marketContextSchemaMode === 'verify'
    ? verifyMarketContextSchema(source)
    : ensureMarketContextSchema(source);

export const ensureMarketContextSchemas = async (
  sources: Iterable<TimescaleMarketContextSource>,
) => {
  for (const source of new Set(sources)) {
    await ensureMarketContextSchema(source);
  }
};
