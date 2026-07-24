import { createHash } from 'node:crypto';
import snapshotJson from './config/binanceBreadthUniverses.json';

export const BINANCE_BREADTH_UNIVERSE_KEYS = [
  'top5',
  'top10',
  'top30',
  'top50',
  'top100',
] as const;

export type BinanceBreadthUniverseKey =
  (typeof BINANCE_BREADTH_UNIVERSE_KEYS)[number];

export type BinanceBreadthUniverseDefinition = {
  key: BinanceBreadthUniverseKey;
  size: number;
  fingerprint: string;
  universe: string;
  symbols: string[];
};

export type BinanceBreadthUniverseSnapshot = {
  schemaVersion: 1;
  updatedAt: string;
  source: 'binance_spot_usdt_turnover24h';
  fingerprint: string;
  universes: Record<
    BinanceBreadthUniverseKey,
    {
      size: number;
      fingerprint: string;
      symbols: string[];
    }
  >;
};

const fingerprint = (value: unknown, length: number) =>
  createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, length);

const normalizeSymbols = (symbols: string[]) =>
  symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);

export const buildBinanceBreadthUniverseSnapshot = ({
  rankedSymbols,
  updatedAt = new Date().toISOString(),
}: {
  rankedSymbols: string[];
  updatedAt?: string;
}): BinanceBreadthUniverseSnapshot => {
  const uniqueSymbols = [...new Set(normalizeSymbols(rankedSymbols))];
  if (uniqueSymbols.length < 100) {
    throw new Error(
      `Binance breadth snapshot requires at least 100 symbols, got ${uniqueSymbols.length}`,
    );
  }

  const universes = Object.fromEntries(
    BINANCE_BREADTH_UNIVERSE_KEYS.map((key) => {
      const size = Number(key.slice(3));
      const symbols = uniqueSymbols.slice(0, size);
      return [
        key,
        {
          size,
          fingerprint: fingerprint(symbols, 12),
          symbols,
        },
      ];
    }),
  ) as BinanceBreadthUniverseSnapshot['universes'];

  return {
    schemaVersion: 1,
    updatedAt,
    source: 'binance_spot_usdt_turnover24h',
    fingerprint: fingerprint(universes, 16),
    universes,
  };
};

const validateSnapshot = (
  value: typeof snapshotJson,
): BinanceBreadthUniverseSnapshot => {
  const rebuilt = buildBinanceBreadthUniverseSnapshot({
    rankedSymbols: value.universes.top100.symbols,
    updatedAt: value.updatedAt,
  });
  if (
    value.schemaVersion !== 1 ||
    value.source !== rebuilt.source ||
    value.fingerprint !== rebuilt.fingerprint
  ) {
    throw new Error('Invalid Binance breadth universe snapshot fingerprint');
  }
  for (const key of BINANCE_BREADTH_UNIVERSE_KEYS) {
    const actual = value.universes[key];
    const expected = rebuilt.universes[key];
    if (
      actual.size !== expected.size ||
      actual.fingerprint !== expected.fingerprint ||
      JSON.stringify(actual.symbols) !== JSON.stringify(expected.symbols)
    ) {
      throw new Error(`Invalid Binance breadth universe snapshot: ${key}`);
    }
  }
  return value as BinanceBreadthUniverseSnapshot;
};

const snapshot = validateSnapshot(snapshotJson);

export const getBinanceBreadthUniverseSnapshot = () => snapshot;

export const getBinanceBreadthUniverses =
  (): BinanceBreadthUniverseDefinition[] =>
    BINANCE_BREADTH_UNIVERSE_KEYS.map((key) => {
      const definition = snapshot.universes[key];
      return {
        key,
        size: definition.size,
        fingerprint: definition.fingerprint,
        universe: `binance_${key}_usdt_${definition.fingerprint}`,
        symbols: [...definition.symbols],
      };
    });

export const getPrimaryBinanceBreadthUniverse = () =>
  getBinanceBreadthUniverses().find(({ key }) => key === 'top30')!;
