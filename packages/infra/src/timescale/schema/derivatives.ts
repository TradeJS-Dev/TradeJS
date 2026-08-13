import { getPool } from '../pool';
import { withSchemaLock } from './lifecycle';

let derivativesSchemaReady = false;
let derivativesSchemaReadyPromise: Promise<void> | null = null;
const DERIVATIVES_SCHEMA_LOCK_KEY = 610001;

export const resetDerivativesSchemaState = () => {
  derivativesSchemaReady = false;
  derivativesSchemaReadyPromise = null;
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
