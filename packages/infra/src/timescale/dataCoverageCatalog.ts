import type { DataCoverageDataset } from '@tradejs/types';

const minutes = {
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '1d': 1440,
};

type Interval = keyof typeof minutes;

type Series = Omit<DataCoverageDataset, 'interval' | 'stepMs'> & {
  table: string;
  filter: string;
};

const series = (definition: Series, intervals: Interval[]) =>
  intervals.map((interval) => ({
    ...definition,
    id: `${definition.id}-${interval}`,
    interval,
    stepMs: minutes[interval] * 60_000,
  }));

const binanceIntervals: Interval[] = ['15m', '1h', '5m'];

const candles = (provider: 'Bybit' | 'Binance', intervals: Interval[]) =>
  series(
    {
      provider,
      id: provider.toLowerCase() + '-candles',
      label: 'Candles',
      table: 'candles',
      dimension: 'symbol',
      filter: `provider = '${provider.toLowerCase()}' AND symbol LIKE '%USDT'`,
    },
    intervals,
  );

const coinalyze = [
  ['open-interest', 'Open interest', 'open_interest IS NOT NULL'],
  ['funding', 'Funding rate', 'funding_rate IS NOT NULL'],
  [
    'liquidations',
    'Liquidations',
    '(liq_long IS NOT NULL OR liq_short IS NOT NULL OR liq_total IS NOT NULL)',
  ],
].flatMap(([id, label, condition]) =>
  series(
    {
      provider: 'Coinalyze',
      id: `coinalyze-${id}`,
      label,
      table: 'derivatives_market',
      dimension: 'symbol',
      filter: `source = 'coinalyze' AND symbol LIKE '%USDT' AND ${condition}`,
    },
    ['15m', '1h'],
  ),
);

const coinMarketCap = (
  id: string,
  label: string,
  table: string,
  dimension?: Series['dimension'],
) =>
  series(
    {
      provider: 'CoinMarketCap',
      id: `cmc-${id}`,
      label,
      table,
      dimension,
      filter: `source = 'coinmarketcap_${id}'`,
    },
    ['1d'],
  );

export const coverageDatasets = [
  ...candles('Bybit', ['15m', '1h']),
  ...coinalyze,
  ...candles('Binance', binanceIntervals),
  ...series(
    {
      provider: 'Binance',
      id: 'binance-trade-flow',
      label: 'Taker buy/sell flow',
      table: 'market_trade_flow',
      dimension: 'symbol',
      filter: "source = 'binance_klines' AND symbol LIKE '%USDT'",
    },
    binanceIntervals,
  ),
  ...series(
    {
      provider: 'Binance',
      id: 'binance-breadth',
      label: 'Market breadth',
      table: 'market_breadth',
      dimension: 'universe',
      filter: "source = 'binance_klines'",
    },
    binanceIntervals,
  ),
  ...series(
    {
      provider: 'Binance',
      id: 'binance-coinbase-spread',
      label: 'Binance–Coinbase spread',
      table: 'market_spread',
      dimension: 'symbol',
      filter: "source = 'binance_coinbase_spread' AND symbol LIKE '%USDT'",
    },
    ['15m'],
  ),
  ...coinMarketCap('global', 'Global market', 'market_global_context'),
  ...coinMarketCap(
    'reference_asset',
    'Reference assets',
    'market_reference_asset_context',
    'symbol',
  ),
  ...coinMarketCap(
    'exchange_liquidity',
    'Exchange liquidity',
    'market_cmc_exchange_liquidity_context',
  ),
  ...coinMarketCap(
    'fear_greed',
    'Fear & Greed',
    'market_cmc_fear_greed_context',
  ),
  ...coinMarketCap(
    'index',
    'Indices',
    'market_cmc_index_context',
    'index_slug',
  ),
];

export type CoverageDataset = (typeof coverageDatasets)[number];
