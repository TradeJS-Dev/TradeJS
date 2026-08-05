import { createHash } from 'node:crypto';
import perpSnapshotJson from './config/hyperliquidPerpUniverse.json';
import whaleSnapshotJson from './config/hyperliquidWhales.json';

export type HyperliquidPerpUniverseSnapshot = {
  schemaVersion: 1;
  updatedAt: string;
  source: 'hyperliquid_main_perp_day_notional_volume';
  fingerprint: string;
  size: 30;
  symbols: string[];
};

export type HyperliquidWhaleRegistrySnapshot = {
  schemaVersion: 2;
  updatedAt: string;
  source: 'hyperliquid_structural_fills_snapshot';
  selection: {
    calibrationFrom: string;
    calibrationTo: string;
    effectiveFrom: string;
    candidateLimit: number;
    minimumAccountValueUsd: number;
    minimumActiveDays: number;
    maximumRawFillsPerDay: number;
    maximumDirectionalExecutionsPerDay: number;
    minimumMedianNotionalUsd: number;
    minimumMedianInterExecutionMinutes: number;
    minimumTop30NotionalShare: number;
    minimumTurnoverToEquity: number;
    maximumTurnoverToEquity: number;
    score: string;
    forbiddenSelectionMetrics: readonly string[];
  };
  fingerprint: string;
  size: 100;
  addresses: string[];
};

const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

const validateUnique = (values: string[], label: string) => {
  if (new Set(values).size !== values.length) {
    throw new Error(`Hyperliquid ${label} snapshot contains duplicates`);
  }
};

const validatePerpSnapshot = (
  value: typeof perpSnapshotJson,
): HyperliquidPerpUniverseSnapshot => {
  const symbols = value.symbols.map((symbol) => symbol.trim()).filter(Boolean);
  validateUnique(symbols, 'perp universe');
  if (
    value.schemaVersion !== 1 ||
    value.source !== 'hyperliquid_main_perp_day_notional_volume' ||
    value.size !== 30 ||
    symbols.length !== 30 ||
    value.fingerprint !== fingerprint(symbols)
  ) {
    throw new Error('Invalid Hyperliquid perp universe snapshot');
  }
  return value as HyperliquidPerpUniverseSnapshot;
};

const validateWhaleSnapshot = (
  value: typeof whaleSnapshotJson,
): HyperliquidWhaleRegistrySnapshot => {
  const addresses = value.addresses.map((address) => address.toLowerCase());
  validateUnique(addresses, 'whale registry');
  if (
    value.schemaVersion !== 2 ||
    value.source !== 'hyperliquid_structural_fills_snapshot' ||
    value.size !== 100 ||
    addresses.length !== 100 ||
    addresses.some((address) => !/^0x[0-9a-f]{40}$/.test(address)) ||
    value.fingerprint !== fingerprint(addresses)
  ) {
    throw new Error('Invalid Hyperliquid whale registry snapshot');
  }
  return value as HyperliquidWhaleRegistrySnapshot;
};

const perpSnapshot = validatePerpSnapshot(perpSnapshotJson);
const whaleSnapshot = validateWhaleSnapshot(whaleSnapshotJson);
const perpSymbolSet = new Set(perpSnapshot.symbols);
const whaleAddressSet = new Set(whaleSnapshot.addresses);

export const getHyperliquidPerpUniverseSnapshot = () => perpSnapshot;
export const getHyperliquidWhaleRegistrySnapshot = () => whaleSnapshot;
export const getHyperliquidPerpSymbols = () => [...perpSnapshot.symbols];
export const getHyperliquidWhaleAddresses = () => [...whaleSnapshot.addresses];
export const isTrackedHyperliquidPerp = (symbol: string) =>
  perpSymbolSet.has(symbol.trim());
export const isTrackedHyperliquidWhale = (address: string) =>
  whaleAddressSet.has(address.trim().toLowerCase());

const SIGNAL_TO_HYPERLIQUID_ALIASES: Record<string, string> = {
  PEPE: 'kPEPE',
  '1000PEPE': 'kPEPE',
  PUMPFUN: 'PUMP',
  SHIB: 'kSHIB',
  BONK: 'kBONK',
};

export const resolveHyperliquidPerpFromSignalSymbol = (symbol: string) => {
  const normalized = symbol
    .trim()
    .toUpperCase()
    .replace(/(?:USDT|USDC)$/, '');
  const candidate = SIGNAL_TO_HYPERLIQUID_ALIASES[normalized] ?? normalized;
  return perpSymbolSet.has(candidate) ? candidate : null;
};
