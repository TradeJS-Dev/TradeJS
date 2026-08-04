import {
  getHyperliquidPerpUniverseSnapshot,
  getHyperliquidWhaleRegistrySnapshot,
  isTrackedHyperliquidWhale,
  resolveHyperliquidPerpFromSignalSymbol,
} from '../hyperliquidWhaleUniverse';

describe('hyperliquidWhaleUniverse', () => {
  it('loads immutable and fingerprinted top-30 perps', () => {
    const snapshot = getHyperliquidPerpUniverseSnapshot();
    expect(snapshot.size).toBe(30);
    expect(snapshot.symbols).toHaveLength(30);
    expect(new Set(snapshot.symbols).size).toBe(30);
    expect(snapshot.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('loads exactly 100 valid and unique whale addresses', () => {
    const snapshot = getHyperliquidWhaleRegistrySnapshot();
    expect(snapshot.addresses).toHaveLength(100);
    expect(new Set(snapshot.addresses).size).toBe(100);
    expect(snapshot.addresses.every(isTrackedHyperliquidWhale)).toBe(true);
  });

  it('maps connector symbols and unit-prefixed aliases deterministically', () => {
    expect(resolveHyperliquidPerpFromSignalSymbol('BTCUSDT')).toBe('BTC');
    expect(resolveHyperliquidPerpFromSignalSymbol('PEPEUSDT')).toBe('kPEPE');
    expect(resolveHyperliquidPerpFromSignalSymbol('SHIBUSDT')).toBeNull();
    expect(resolveHyperliquidPerpFromSignalSymbol('UNKNOWNUSDT')).toBeNull();
  });
});
