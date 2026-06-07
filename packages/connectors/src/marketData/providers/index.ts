import { binanceCoinbaseSpreadProvider } from './binanceCoinbaseSpread';
import { coinalyzeProvider } from './coinalyze';
import { MarketDataProvider, MarketDataProviderName } from './types';
export {
  fetchArkhamOnchainWindow,
  parseArkhamSymbolTokenIds,
  resolveArkhamTokenId,
  type ArkhamOnchainWindowParams,
} from './arkham';

export const marketDataProviders: Record<
  MarketDataProviderName,
  MarketDataProvider
> = {
  coinalyze: coinalyzeProvider,
  binance_coinbase_spread: binanceCoinbaseSpreadProvider,
};

export type { MarketDataProvider, MarketDataProviderName } from './types';
