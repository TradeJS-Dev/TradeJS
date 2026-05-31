-- Preserve Binance kline taker buy/sell volume in the local candle cache.
-- These columns are nullable because not every connector/provider exposes
-- taker-side volume.

ALTER TABLE candles
  ADD COLUMN IF NOT EXISTS taker_buy_base_volume double precision,
  ADD COLUMN IF NOT EXISTS taker_buy_quote_volume double precision,
  ADD COLUMN IF NOT EXISTS taker_sell_base_volume double precision,
  ADD COLUMN IF NOT EXISTS taker_sell_quote_volume double precision;
