-- src/sql/create.sql
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS candles (
  provider   text            NOT NULL DEFAULT 'bybit',
  symbol     text            NOT NULL,
  interval   integer         NOT NULL,          -- минуты (1,5,15,60,240,1440...)
  ts         timestamptz     NOT NULL,          -- конец интервала
  open       double precision NOT NULL,
  high       double precision NOT NULL,
  low        double precision NOT NULL,
  close      double precision NOT NULL,
  volume     double precision,
  turnover   double precision,
  PRIMARY KEY (provider, symbol, interval, ts)
);

-- сделать hypertable
SELECT create_hypertable('candles', 'ts', if_not_exists => TRUE, chunk_time_interval => interval '7 days');

CREATE INDEX IF NOT EXISTS candles_provider_symbol_interval_ts_idx
  ON candles (provider, symbol, interval, ts DESC);

-- опционально: компрессия + ретеншн
ALTER TABLE candles SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'provider, symbol, interval'
);

SELECT add_retention_policy('candles', INTERVAL '365 days');

CREATE TABLE IF NOT EXISTS derivatives_market (
  symbol        text             NOT NULL,
  interval     text             NOT NULL,      -- '15m' | '1h'
  ts            timestamptz      NOT NULL,
  open_interest double precision,
  funding_rate  double precision,
  liq_long      double precision,
  liq_short     double precision,
  liq_total     double precision,
  source        text,
  ingested_at   timestamptz      NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, interval, ts)
);

SELECT create_hypertable('derivatives_market', 'ts', if_not_exists => TRUE, chunk_time_interval => interval '14 days');

CREATE INDEX IF NOT EXISTS derivatives_market_symbol_tf_ts_idx
  ON derivatives_market (symbol, interval, ts DESC);

ALTER TABLE derivatives_market SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol, interval'
);

SELECT add_retention_policy('derivatives_market', INTERVAL '730 days');

CREATE TABLE IF NOT EXISTS market_spread (
  symbol         text             NOT NULL,
  interval      text             NOT NULL,      -- '15m' | '1h'
  ts             timestamptz      NOT NULL,
  binance_price  double precision,
  coinbase_price double precision,
  spread        double precision,
  source         text,
  ingested_at    timestamptz      NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, interval, ts)
);

SELECT create_hypertable('market_spread', 'ts', if_not_exists => TRUE, chunk_time_interval => interval '14 days');

CREATE INDEX IF NOT EXISTS market_spread_symbol_tf_ts_idx
  ON market_spread (symbol, interval, ts DESC);

ALTER TABLE market_spread SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol, interval'
);

SELECT add_retention_policy('market_spread', INTERVAL '730 days');
