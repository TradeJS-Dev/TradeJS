-- Binance public market microstructure features.
-- Keep raw trade/order-book payloads out of hot backtest paths:
-- aggTrades are bucketed, depth snapshots keep compact level summaries,
-- breadth stores one aggregate row per universe/timestamp.

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
