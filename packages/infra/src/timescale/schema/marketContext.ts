import { getPool } from '../pool';
import { withSchemaLock } from './lifecycle';

let binanceMarketSchemaReady = false;
let binanceMarketSchemaReadyPromise: Promise<void> | null = null;
const BINANCE_MARKET_SCHEMA_LOCK_KEY = 610003;

export const resetMarketContextSchemaState = () => {
  binanceMarketSchemaReady = false;
  binanceMarketSchemaReadyPromise = null;
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
