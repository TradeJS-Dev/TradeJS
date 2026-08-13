import { getPool } from '../pool';
import { withSchemaLock } from './lifecycle';

let candlesSchemaReady = false;
let candlesSchemaReadyPromise: Promise<void> | null = null;
const CANDLES_SCHEMA_LOCK_KEY = 610000;

export const resetCandlesSchemaState = () => {
  candlesSchemaReady = false;
  candlesSchemaReadyPromise = null;
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
