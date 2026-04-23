-- Add provider as a candles dimension so multiple exchanges can store the
-- same symbol/interval/timestamp without overwriting each other.
-- For production hypertables with compressed chunks, run this in a maintenance
-- window and decompress/recompress chunks around the primary-key/compression
-- setting changes as needed.

ALTER TABLE candles
  ADD COLUMN IF NOT EXISTS provider text;

UPDATE candles
SET provider = 'bybit'
WHERE provider IS NULL;

ALTER TABLE candles
  ALTER COLUMN provider SET DEFAULT 'bybit',
  ALTER COLUMN provider SET NOT NULL;

ALTER TABLE candles
  DROP CONSTRAINT IF EXISTS candles_pkey;

ALTER TABLE candles
  ADD CONSTRAINT candles_pkey PRIMARY KEY (provider, symbol, interval, ts);

DROP INDEX IF EXISTS candles_symbol_interval_ts_idx;

CREATE INDEX IF NOT EXISTS candles_provider_symbol_interval_ts_idx
  ON candles (provider, symbol, interval, ts DESC);

ALTER TABLE candles SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'provider, symbol, interval'
);
