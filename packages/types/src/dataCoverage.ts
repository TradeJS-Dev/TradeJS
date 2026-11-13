export type DataCoverageDataset = {
  id: string;
  provider: 'Bybit' | 'Coinalyze' | 'Binance' | 'CoinMarketCap';
  label: string;
  interval: '5m' | '15m' | '1h' | '1d';
  dimension?: 'symbol' | 'universe' | 'index_slug';
  stepMs: number;
};

export type DataCoverageDay = {
  day: number;
  loaded: number;
  missing: number;
  series: number;
};

export type DataCoverage = {
  first: number | null;
  last: number | null;
  series: number;
  days: DataCoverageDay[];
};

export type DataCoverageSeriesDay = {
  key: string;
  loaded: number;
  missing: number;
};

export type DataBackfillRequest = {
  dataset: string;
  series: string;
  day: number;
};

export type DataBackfillResult = {
  loaded: number;
  added: number;
  missing: number;
};

export type DataBackfillJob = DataBackfillRequest & {
  id: string;
  createdAt: number;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed';
  result?: DataBackfillResult;
  error?: string;
};
