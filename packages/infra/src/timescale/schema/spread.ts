import { getPool } from '../pool';
import { withSchemaLock } from './lifecycle';

let spreadSchemaReady = false;
let spreadSchemaReadyPromise: Promise<void> | null = null;
const SPREAD_SCHEMA_LOCK_KEY = 610002;

export const resetSpreadSchemaState = () => {
  spreadSchemaReady = false;
  spreadSchemaReadyPromise = null;
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
