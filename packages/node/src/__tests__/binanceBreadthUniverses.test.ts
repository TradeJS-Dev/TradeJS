import {
  buildBinanceBreadthUniverseSnapshot,
  getBinanceBreadthUniverseSnapshot,
  getBinanceBreadthUniverses,
} from '../binanceBreadthUniverses';

describe('binanceBreadthUniverses', () => {
  it('loads five nested fixed universes with versioned identities', () => {
    const definitions = getBinanceBreadthUniverses();

    expect(definitions.map(({ key, size }) => ({ key, size }))).toEqual([
      { key: 'top5', size: 5 },
      { key: 'top10', size: 10 },
      { key: 'top30', size: 30 },
      { key: 'top50', size: 50 },
      { key: 'top100', size: 100 },
    ]);
    for (let index = 1; index < definitions.length; index += 1) {
      expect(
        definitions[index].symbols.slice(0, definitions[index - 1].size),
      ).toEqual(definitions[index - 1].symbols);
    }
    for (const definition of definitions) {
      expect(definition.symbols).toHaveLength(definition.size);
      expect(definition.universe).toBe(
        `binance_${definition.key}_usdt_${definition.fingerprint}`,
      );
    }
  });

  it('builds a deterministic snapshot and changes its fingerprint with membership', () => {
    const symbols = Array.from(
      { length: 101 },
      (_, index) => `COIN${index}USDT`,
    );
    const first = buildBinanceBreadthUniverseSnapshot({
      rankedSymbols: symbols,
      updatedAt: '2026-07-24T00:00:00.000Z',
    });
    const same = buildBinanceBreadthUniverseSnapshot({
      rankedSymbols: symbols,
      updatedAt: '2026-08-24T00:00:00.000Z',
    });
    const changed = buildBinanceBreadthUniverseSnapshot({
      rankedSymbols: [symbols[100], ...symbols],
      updatedAt: '2026-08-24T00:00:00.000Z',
    });

    expect(first.fingerprint).toBe(same.fingerprint);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
    expect(getBinanceBreadthUniverseSnapshot().schemaVersion).toBe(1);
  });
});
