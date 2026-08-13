import { getPool } from '../pool';
import { withSchemaLock } from './lifecycle';

let hyperliquidWhaleSchemaReady = false;
let hyperliquidWhaleSchemaReadyPromise: Promise<void> | null = null;
const HYPERLIQUID_WHALE_SCHEMA_LOCK_KEY = 610004;

export const resetHyperliquidWhalesSchemaState = () => {
  hyperliquidWhaleSchemaReady = false;
  hyperliquidWhaleSchemaReadyPromise = null;
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
