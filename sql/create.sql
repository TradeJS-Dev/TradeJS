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
  taker_buy_base_volume   double precision,
  taker_buy_quote_volume  double precision,
  taker_sell_base_volume  double precision,
  taker_sell_quote_volume double precision,
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

CREATE TABLE IF NOT EXISTS market_trade_flow (
  symbol             text             NOT NULL,
  interval           text             NOT NULL,
  ts                 timestamptz      NOT NULL,
  trades             integer          NOT NULL,
  buy_base_volume    double precision,
  sell_base_volume   double precision,
  buy_quote_volume   double precision,
  sell_quote_volume  double precision,
  net_base_delta     double precision,
  net_quote_delta    double precision,
  buy_pressure_pct   double precision,
  source             text,
  ingested_at        timestamptz      NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, interval, ts)
);

SELECT create_hypertable('market_trade_flow', 'ts', if_not_exists => TRUE, chunk_time_interval => interval '7 days');

CREATE INDEX IF NOT EXISTS market_trade_flow_symbol_tf_ts_idx
  ON market_trade_flow (symbol, interval, ts DESC);

CREATE TABLE IF NOT EXISTS market_order_book_depth (
  venue          text             NOT NULL,
  symbol         text             NOT NULL,
  ts             timestamptz      NOT NULL,
  last_update_id bigint,
  bid            double precision,
  ask            double precision,
  mid            double precision,
  spread_bps     double precision,
  levels         jsonb            NOT NULL,
  raw_bid_levels integer,
  raw_ask_levels integer,
  source         text,
  ingested_at    timestamptz      NOT NULL DEFAULT now(),
  PRIMARY KEY (venue, symbol, ts)
);

SELECT create_hypertable('market_order_book_depth', 'ts', if_not_exists => TRUE, chunk_time_interval => interval '7 days');

CREATE INDEX IF NOT EXISTS market_order_book_depth_venue_symbol_ts_idx
  ON market_order_book_depth (venue, symbol, ts DESC);

CREATE TABLE IF NOT EXISTS market_breadth (
  universe               text             NOT NULL,
  interval               text             NOT NULL,
  ts                     timestamptz      NOT NULL,
  symbols_count          integer          NOT NULL,
  advancers              integer          NOT NULL,
  decliners              integer          NOT NULL,
  unchanged              integer          NOT NULL,
  advance_decline_ratio  double precision,
  pct_above_ma20         double precision,
  pct_above_ma50         double precision,
  equal_weighted_return  double precision,
  volume_weighted_return double precision,
  dispersion             double precision,
  source                 text,
  ingested_at            timestamptz      NOT NULL DEFAULT now(),
  PRIMARY KEY (universe, interval, ts)
);

SELECT create_hypertable('market_breadth', 'ts', if_not_exists => TRUE, chunk_time_interval => interval '14 days');

CREATE INDEX IF NOT EXISTS market_breadth_universe_tf_ts_idx
  ON market_breadth (universe, interval, ts DESC);
