import type { MarketUniverse, Provider } from '@tradejs/types';

export const getDefaultMarketSymbol = (
  provider: Provider,
  universe: MarketUniverse,
) => {
  if (universe === 'tradfi') {
    return 'AAPLUSDT';
  }

  return provider === 'coinbase' ? 'BTC-USD' : 'BTCUSDT';
};
