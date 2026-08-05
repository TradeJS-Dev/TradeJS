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
    expect(snapshot.source).toBe('hyperliquid_structural_fills_snapshot');
    expect(snapshot.selection.forbiddenSelectionMetrics).toEqual([
      'pnl',
      'roi',
      'winRate',
      'closedPnl',
    ]);
    expect(snapshot.selection.maximumRawFillsPerDay).toBe(20);
    expect(snapshot.addresses).toHaveLength(100);
    expect(new Set(snapshot.addresses).size).toBe(100);
    expect(snapshot.addresses.every(isTrackedHyperliquidWhale)).toBe(true);
    expect(snapshot.addresses).not.toContain(
      '0x856c35038594767646266bc7fd68dc26480e910d',
    );
  });

  it('maps connector symbols and unit-prefixed aliases deterministically', () => {
    expect(resolveHyperliquidPerpFromSignalSymbol('BTCUSDT')).toBe('BTC');
    expect(resolveHyperliquidPerpFromSignalSymbol('PEPEUSDT')).toBe('kPEPE');
    expect(resolveHyperliquidPerpFromSignalSymbol('1000PEPEUSDT')).toBe(
      'kPEPE',
    );
    expect(resolveHyperliquidPerpFromSignalSymbol('PUMPFUNUSDT')).toBe('PUMP');
    expect(resolveHyperliquidPerpFromSignalSymbol('SHIBUSDT')).toBeNull();
    expect(resolveHyperliquidPerpFromSignalSymbol('UNKNOWNUSDT')).toBeNull();
  });
});
