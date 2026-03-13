import { DerivativesRow, DerivativesInterval, SpreadRow } from '@tradejs/infra';

export type MarketDataProviderName = 'coinalyze' | 'binance_coinbase_spread';

export type ProviderWindowParams = {
  symbol: string;
  marketSymbol?: string;
  interval: DerivativesInterval;
  fromMs: number;
  toMs: number;
};

export type ProviderWindowResult = {
  derivativesRows?: DerivativesRow[];
  spreadRows?: SpreadRow[];
};

export interface MarketDataProvider {
  name: MarketDataProviderName;
  fetchWindow: (params: ProviderWindowParams) => Promise<ProviderWindowResult>;
}
