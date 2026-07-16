import { getDefaultMarketSymbol } from '../marketDefaults';

describe('market defaults', () => {
  it('uses provider-aware crypto symbols', () => {
    expect(getDefaultMarketSymbol('bybit', 'crypto')).toBe('BTCUSDT');
    expect(getDefaultMarketSymbol('binance', 'crypto')).toBe('BTCUSDT');
    expect(getDefaultMarketSymbol('coinbase', 'crypto')).toBe('BTCUSDT');
  });

  it('uses AAPL for the Bybit TradFi universe', () => {
    expect(getDefaultMarketSymbol('bybit', 'tradfi')).toBe('AAPLUSDT');
  });
});
