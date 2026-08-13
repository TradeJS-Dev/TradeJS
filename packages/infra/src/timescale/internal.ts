import { closePool } from './pool';
import { queryMarketContext } from './query';
export { getPool } from './pool';
export {
  queryMarketContext,
  type TimescaleMarketContextQueryOptions,
} from './query';
export {
  getSafeBulkInsertRows,
  normalizeCandleProvider,
  normalizeCandleSymbol,
  toMarketFeatureAge,
  type MarketFeatureAsOf,
} from './values';

import { ensureCandlesSchema, resetCandlesSchemaState } from './schema/candles';
import {
  ensureDerivativesSchema,
  resetDerivativesSchemaState,
} from './schema/derivatives';
import { ensureSpreadSchema, resetSpreadSchemaState } from './schema/spread';
import {
  ensureBinanceMarketSchema,
  resetMarketContextSchemaState,
} from './schema/marketContext';
import {
  ensureHyperliquidWhaleSchema,
  resetHyperliquidWhalesSchemaState,
} from './schema/hyperliquidWhales';
export {
  ensureCandlesSchema,
  ensureDerivativesSchema,
  ensureSpreadSchema,
  ensureBinanceMarketSchema,
  ensureHyperliquidWhaleSchema,
};

export type TimescaleMarketContextSource =
  | 'binance'
  | 'coinmarketcap'
  | 'derivatives'
  | 'hyperliquidWhales';

let marketContextSchemaMode: 'ensure' | 'verify' = 'ensure';
const verifiedMarketContextSchemas = new Set<TimescaleMarketContextSource>();

export const configureTimescaleMarketContextSchemaMode = (
  mode: 'ensure' | 'verify',
) => {
  marketContextSchemaMode = mode;
  verifiedMarketContextSchemas.clear();
};

export const closeTimescalePool = async (): Promise<void> => {
  resetCandlesSchemaState();
  resetDerivativesSchemaState();
  resetSpreadSchemaState();
  resetMarketContextSchemaState();
  resetHyperliquidWhalesSchemaState();
  verifiedMarketContextSchemas.clear();
  await closePool();
};

export const ensureCoinMarketCapContextSchema = async () =>
  ensureBinanceMarketSchema();

const ensureMarketContextSchema = async (
  source: TimescaleMarketContextSource,
) => {
  switch (source) {
    case 'binance':
      return ensureBinanceMarketSchema();
    case 'coinmarketcap':
      return ensureCoinMarketCapContextSchema();
    case 'derivatives':
      return ensureDerivativesSchema();
    case 'hyperliquidWhales':
      return ensureHyperliquidWhaleSchema();
  }
};

const MARKET_CONTEXT_SCHEMA_TABLES: Record<
  TimescaleMarketContextSource,
  readonly string[]
> = {
  binance: ['market_trade_flow', 'market_breadth'],
  coinmarketcap: [
    'market_global_context',
    'market_reference_asset_context',
    'market_cmc_exchange_liquidity_context',
    'market_cmc_fear_greed_context',
    'market_cmc_index_context',
  ],
  derivatives: ['derivatives_market'],
  hyperliquidWhales: [
    'hyperliquid_whale_flow',
    'hyperliquid_whale_coverage_1m',
  ],
};

const verifyMarketContextSchema = async (
  source: TimescaleMarketContextSource,
) => {
  if (verifiedMarketContextSchemas.has(source)) return;
  const tables = MARKET_CONTEXT_SCHEMA_TABLES[source];
  const result = await queryMarketContext<{ tableName: string | null }>(
    `
      SELECT table_name AS "tableName"
      FROM unnest($1::text[]) AS requested(table_name)
      WHERE to_regclass(requested.table_name) IS NULL
    `,
    [tables],
  );
  if (result.rows.length) {
    throw new Error(
      `Timescale ${source} schema is not prepared; missing: ${result.rows
        .map((row) => row.tableName)
        .filter(Boolean)
        .join(', ')}`,
    );
  }
  verifiedMarketContextSchemas.add(source);
};

export const prepareMarketContextSchemaForRead = async (
  source: TimescaleMarketContextSource,
) =>
  marketContextSchemaMode === 'verify'
    ? verifyMarketContextSchema(source)
    : ensureMarketContextSchema(source);

export const ensureMarketContextSchemas = async (
  sources: Iterable<TimescaleMarketContextSource>,
) => {
  for (const source of new Set(sources)) {
    await ensureMarketContextSchema(source);
  }
};
