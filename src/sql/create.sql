-- 00_init_timescale.sql
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS candles (
  symbol     text            NOT NULL,
  interval   integer         NOT NULL,          -- минуты (1,5,15,60,240,1440...)
  ts         timestamptz     NOT NULL,          -- конец интервала
  open       double precision NOT NULL,
  high       double precision NOT NULL,
  low        double precision NOT NULL,
  close      double precision NOT NULL,
  volume     double precision,
  turnover   double precision,
  PRIMARY KEY (symbol, interval, ts)
);

-- сделать hypertable
SELECT create_hypertable('candles', 'ts', if_not_exists => TRUE, chunk_time_interval => interval '7 days');

CREATE INDEX IF NOT EXISTS candles_symbol_interval_ts_idx
  ON candles (symbol, interval, ts DESC);

-- опционально: компрессия + ретеншн
ALTER TABLE candles SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol, interval'
);
SELECT add_compression_policy('candles', INTERVAL '30 days');
-- пример ретенции (если нужно чистить)
-- SELECT add_retention_policy('candles', INTERVAL '365 days');
