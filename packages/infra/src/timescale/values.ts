const PG_SAFE_MAX_BIND_PARAMS = 30_000;

export const normalizeCandleProvider = (provider: string) =>
  String(provider || '')
    .trim()
    .toLowerCase();

export const normalizeCandleSymbol = (symbol: string) =>
  String(symbol || '')
    .trim()
    .toUpperCase();

export const getSafeBulkInsertRows = (columnsCount: number) =>
  Math.max(1, Math.floor(PG_SAFE_MAX_BIND_PARAMS / columnsCount));

export type MarketFeatureAsOf<T> = T & {
  ageMs: number | null;
  stale: boolean;
};

export const toMarketFeatureAge = (rowTs: Date, atMs: number) => {
  const ageMs = atMs - rowTs.getTime();
  return Number.isFinite(ageMs) ? ageMs : null;
};
