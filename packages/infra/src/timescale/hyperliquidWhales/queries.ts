import {
  HYPERLIQUID_WHALE_DATA_MODEL_VERSION,
  type MarketFeatureInterval,
} from '@tradejs/types';
import {
  getPool,
  queryMarketContext,
  ensureHyperliquidWhaleSchema,
  prepareMarketContextSchemaForRead,
} from '../internal';
import type { HyperliquidWhaleWalletCoverageStatus } from './contracts';

const HYPERLIQUID_CONTEXT_INTERVAL_MS: Record<MarketFeatureInterval, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
};

export async function getHyperliquidWhaleWalletCoverage(params: {
  address: string;
  fromMs: number;
  toMs: number;
  universeFingerprint: string;
  whaleRegistryFingerprint: string;
}) {
  await ensureHyperliquidWhaleSchema();
  const result = await getPool().query(
    `
      SELECT
        status,
        covered_from_ts,
        covered_to_ts,
        fills_count,
        error,
        checked_at
      FROM hyperliquid_whale_wallet_coverage
      WHERE universe_fingerprint = $1
        AND whale_registry_fingerprint = $2
        AND address = $3
        AND data_model_version = $6
        AND (
          (
            covered_from_ts <= to_timestamp($4/1000.0)
            AND covered_to_ts >= to_timestamp($5/1000.0)
          )
          OR (
            requested_from_ts = to_timestamp($4/1000.0)
            AND requested_to_ts = to_timestamp($5/1000.0)
          )
        )
      ORDER BY checked_at DESC
      LIMIT 1
    `,
    [
      params.universeFingerprint,
      params.whaleRegistryFingerprint,
      params.address.toLowerCase(),
      params.fromMs,
      params.toMs,
      HYPERLIQUID_WHALE_DATA_MODEL_VERSION,
    ],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    status:
      row.covered_from_ts != null &&
      row.covered_to_ts != null &&
      new Date(row.covered_from_ts).getTime() <= params.fromMs &&
      new Date(row.covered_to_ts).getTime() >= params.toMs
        ? 'complete'
        : (String(row.status) as HyperliquidWhaleWalletCoverageStatus),
    coveredFromMs:
      row.covered_from_ts == null
        ? null
        : new Date(row.covered_from_ts).getTime(),
    coveredToMs:
      row.covered_to_ts == null ? null : new Date(row.covered_to_ts).getTime(),
    fillsCount: Number(row.fills_count) || 0,
    error: row.error == null ? null : String(row.error),
    checkedAt: new Date(row.checked_at),
  };
}

export type HyperliquidWhaleCoverageSeriesRow = {
  ts: Date;
  coveredWhales: number;
  expectedWhales: number;
  coveragePct: number;
};

export async function getHyperliquidWhaleCoverageSeriesRows(params: {
  fromMs: number;
  toMs: number;
  universeFingerprint: string;
  whaleRegistryFingerprint: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<HyperliquidWhaleCoverageSeriesRow[]> {
  await prepareMarketContextSchemaForRead('hyperliquidWhales');
  const result = await queryMarketContext(
    `
      SELECT
        ts,
        covered_whales,
        expected_whales,
        coverage_pct
      FROM hyperliquid_whale_coverage_1m
      WHERE universe_fingerprint = $1
        AND whale_registry_fingerprint = $2
        AND data_model_version = $3
        AND ts >= to_timestamp($4/1000.0)
        AND ts < to_timestamp($5/1000.0)
      ORDER BY ts
    `,
    [
      params.universeFingerprint,
      params.whaleRegistryFingerprint,
      HYPERLIQUID_WHALE_DATA_MODEL_VERSION,
      params.fromMs,
      params.toMs,
    ],
    params,
  );
  return result.rows.map((row) => ({
    ts: new Date(row.ts),
    coveredWhales: Number(row.covered_whales) || 0,
    expectedWhales: Number(row.expected_whales) || 0,
    coveragePct: Number(row.coverage_pct) || 0,
  }));
}

export type HyperliquidWhaleFlowSeriesRow = {
  ts: Date;
  trades: number;
  whaleSides: number;
  whaleAddresses: string[];
  buyNotionalUsd: number;
  sellNotionalUsd: number;
  positionAwareWhaleSides: number;
  longEntryWhaleAddresses: string[];
  shortEntryWhaleAddresses: string[];
  longExitWhaleAddresses: string[];
  shortExitWhaleAddresses: string[];
  longEntryNotionalUsd: number;
  shortEntryNotionalUsd: number;
  longExitNotionalUsd: number;
  shortExitNotionalUsd: number;
};

export async function getHyperliquidWhaleFlowSeriesRows(params: {
  symbol: string;
  fromMs: number;
  toMs: number;
  universeFingerprint: string;
  whaleRegistryFingerprint: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<HyperliquidWhaleFlowSeriesRow[]> {
  await prepareMarketContextSchemaForRead('hyperliquidWhales');
  const result = await queryMarketContext(
    `
      SELECT
        ts,
        trades,
        whale_sides,
        whale_addresses,
        buy_notional_usd,
        sell_notional_usd,
        position_aware_whale_sides,
        long_entry_whale_addresses,
        short_entry_whale_addresses,
        long_exit_whale_addresses,
        short_exit_whale_addresses,
        long_entry_notional_usd,
        short_entry_notional_usd,
        long_exit_notional_usd,
        short_exit_notional_usd
      FROM hyperliquid_whale_flow
      WHERE symbol = $1
        AND interval = '1m'
        AND universe_fingerprint = $2
        AND whale_registry_fingerprint = $3
        AND ts >= to_timestamp($4/1000.0)
        AND ts < to_timestamp($5/1000.0)
      ORDER BY ts
    `,
    [
      params.symbol,
      params.universeFingerprint,
      params.whaleRegistryFingerprint,
      params.fromMs,
      params.toMs,
    ],
    params,
  );
  return result.rows.map((row) => ({
    ts: new Date(row.ts),
    trades: Number(row.trades) || 0,
    whaleSides: Number(row.whale_sides) || 0,
    whaleAddresses: Array.isArray(row.whale_addresses)
      ? row.whale_addresses.map(String)
      : [],
    buyNotionalUsd: Number(row.buy_notional_usd) || 0,
    sellNotionalUsd: Number(row.sell_notional_usd) || 0,
    positionAwareWhaleSides: Number(row.position_aware_whale_sides) || 0,
    longEntryWhaleAddresses: Array.isArray(row.long_entry_whale_addresses)
      ? row.long_entry_whale_addresses.map(String)
      : [],
    shortEntryWhaleAddresses: Array.isArray(row.short_entry_whale_addresses)
      ? row.short_entry_whale_addresses.map(String)
      : [],
    longExitWhaleAddresses: Array.isArray(row.long_exit_whale_addresses)
      ? row.long_exit_whale_addresses.map(String)
      : [],
    shortExitWhaleAddresses: Array.isArray(row.short_exit_whale_addresses)
      ? row.short_exit_whale_addresses.map(String)
      : [],
    longEntryNotionalUsd: Number(row.long_entry_notional_usd) || 0,
    shortEntryNotionalUsd: Number(row.short_entry_notional_usd) || 0,
    longExitNotionalUsd: Number(row.long_exit_notional_usd) || 0,
    shortExitNotionalUsd: Number(row.short_exit_notional_usd) || 0,
  }));
}

export type HyperliquidWhaleFlowAggregate = {
  symbol: string;
  interval: MarketFeatureInterval;
  asOfTs: Date;
  windowEndTs: Date;
  trades: number;
  whaleSides: number;
  uniqueWhales: number;
  coveredWhales: number;
  expectedWhales: number;
  coveragePct: number;
  buyNotionalUsd: number;
  sellNotionalUsd: number;
  netNotionalUsd: number;
  buySharePct: number | null;
  positionAwareWhaleSides: number;
  positionAwarePct: number;
  longEntryWhales: number;
  shortEntryWhales: number;
  longExitWhales: number;
  shortExitWhales: number;
  longEntryNotionalUsd: number;
  shortEntryNotionalUsd: number;
  longExitNotionalUsd: number;
  shortExitNotionalUsd: number;
  entryNetNotionalUsd: number;
  entryLongSharePct: number | null;
  universeFingerprint: string;
  whaleRegistryFingerprint: string;
  source: string | null;
  ageMs: number;
  stale: boolean;
};

export async function getHyperliquidWhaleFlowAggregate(params: {
  symbol: string;
  interval: MarketFeatureInterval;
  decisionTimeMs: number;
  universeFingerprint: string;
  whaleRegistryFingerprint: string;
  maxAgeMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<HyperliquidWhaleFlowAggregate | null> {
  await prepareMarketContextSchemaForRead('hyperliquidWhales');
  const intervalMs = HYPERLIQUID_CONTEXT_INTERVAL_MS[params.interval];
  const expectedBuckets = Math.ceil(intervalMs / 60_000);
  const res = await queryMarketContext(
    `
      WITH coverage_rows AS (
        SELECT *
        FROM hyperliquid_whale_coverage_1m
        WHERE universe_fingerprint = $2
          AND whale_registry_fingerprint = $3
          AND data_model_version = $6
          AND ts >= to_timestamp(
            ($4::double precision - $5::double precision) / 1000.0
          )
          AND ts < to_timestamp($4/1000.0)
      ), coverage_summary AS (
        SELECT
          COUNT(*)::int AS coverage_buckets,
          MAX(ts) AS coverage_as_of_ts,
          MIN(covered_whales)::int AS covered_whales,
          MAX(expected_whales)::int AS expected_whales,
          MIN(coverage_pct) AS coverage_pct
        FROM coverage_rows
      ), window_rows AS (
        SELECT *
        FROM hyperliquid_whale_flow
        WHERE symbol = $1
          AND interval = '1m'
          AND universe_fingerprint = $2
          AND whale_registry_fingerprint = $3
          AND ts >= to_timestamp(
            ($4::double precision - $5::double precision) / 1000.0
          )
          AND ts < to_timestamp($4/1000.0)
      ), unique_addresses AS (
        SELECT COUNT(DISTINCT address)::int AS unique_whales
        FROM window_rows
        CROSS JOIN LATERAL UNNEST(whale_addresses) AS expanded(address)
      ), directional_counts AS (
        SELECT
          (
            SELECT COUNT(DISTINCT address)::int
            FROM window_rows
            CROSS JOIN LATERAL UNNEST(long_entry_whale_addresses) AS expanded(address)
          ) AS long_entry_whales,
          (
            SELECT COUNT(DISTINCT address)::int
            FROM window_rows
            CROSS JOIN LATERAL UNNEST(short_entry_whale_addresses) AS expanded(address)
          ) AS short_entry_whales,
          (
            SELECT COUNT(DISTINCT address)::int
            FROM window_rows
            CROSS JOIN LATERAL UNNEST(long_exit_whale_addresses) AS expanded(address)
          ) AS long_exit_whales,
          (
            SELECT COUNT(DISTINCT address)::int
            FROM window_rows
            CROSS JOIN LATERAL UNNEST(short_exit_whale_addresses) AS expanded(address)
          ) AS short_exit_whales
      )
      SELECT
        $1::text AS symbol,
        coverage_summary.coverage_as_of_ts AS as_of_ts,
        coverage_summary.coverage_buckets,
        coverage_summary.covered_whales,
        coverage_summary.expected_whales,
        coverage_summary.coverage_pct,
        COALESCE((SELECT SUM(trades) FROM window_rows), 0)::int AS trades,
        COALESCE((SELECT SUM(whale_sides) FROM window_rows), 0)::int AS whale_sides,
        COALESCE((SELECT unique_whales FROM unique_addresses), 0)::int AS unique_whales,
        COALESCE((SELECT SUM(buy_notional_usd) FROM window_rows), 0) AS buy_notional_usd,
        COALESCE((SELECT SUM(sell_notional_usd) FROM window_rows), 0) AS sell_notional_usd,
        COALESCE((SELECT SUM(net_notional_usd) FROM window_rows), 0) AS net_notional_usd,
        CASE
          WHEN COALESCE((SELECT SUM(buy_notional_usd + sell_notional_usd) FROM window_rows), 0) > 0
          THEN (SELECT SUM(buy_notional_usd) FROM window_rows) /
            (SELECT SUM(buy_notional_usd + sell_notional_usd) FROM window_rows)
          ELSE NULL
        END AS buy_share_pct,
        COALESCE((SELECT SUM(position_aware_whale_sides) FROM window_rows), 0)::int
          AS position_aware_whale_sides,
        CASE
          WHEN COALESCE((SELECT SUM(whale_sides) FROM window_rows), 0) > 0
          THEN COALESCE((SELECT SUM(position_aware_whale_sides) FROM window_rows), 0)::double precision /
            (SELECT SUM(whale_sides) FROM window_rows)
          ELSE 0
        END AS position_aware_pct,
        COALESCE((SELECT long_entry_whales FROM directional_counts), 0)::int AS long_entry_whales,
        COALESCE((SELECT short_entry_whales FROM directional_counts), 0)::int AS short_entry_whales,
        COALESCE((SELECT long_exit_whales FROM directional_counts), 0)::int AS long_exit_whales,
        COALESCE((SELECT short_exit_whales FROM directional_counts), 0)::int AS short_exit_whales,
        COALESCE((SELECT SUM(long_entry_notional_usd) FROM window_rows), 0)
          AS long_entry_notional_usd,
        COALESCE((SELECT SUM(short_entry_notional_usd) FROM window_rows), 0)
          AS short_entry_notional_usd,
        COALESCE((SELECT SUM(long_exit_notional_usd) FROM window_rows), 0)
          AS long_exit_notional_usd,
        COALESCE((SELECT SUM(short_exit_notional_usd) FROM window_rows), 0)
          AS short_exit_notional_usd,
        COALESCE((SELECT SUM(entry_net_notional_usd) FROM window_rows), 0)
          AS entry_net_notional_usd,
        CASE
          WHEN COALESCE((SELECT SUM(long_entry_notional_usd + short_entry_notional_usd) FROM window_rows), 0) > 0
          THEN (SELECT SUM(long_entry_notional_usd) FROM window_rows) /
            (SELECT SUM(long_entry_notional_usd + short_entry_notional_usd) FROM window_rows)
          ELSE NULL
        END AS entry_long_share_pct,
        (SELECT MAX(source) FROM window_rows) AS source
      FROM coverage_summary
    `,
    [
      params.symbol,
      params.universeFingerprint,
      params.whaleRegistryFingerprint,
      params.decisionTimeMs,
      intervalMs,
      HYPERLIQUID_WHALE_DATA_MODEL_VERSION,
    ],
    params,
  );
  const row = res.rows[0];
  if (
    !row?.as_of_ts ||
    Number(row.coverage_buckets) !== expectedBuckets ||
    Number(row.covered_whales) <= 0
  ) {
    return null;
  }
  const asOfTs = new Date(row.as_of_ts);
  const ageMs = params.decisionTimeMs - (asOfTs.getTime() + 60_000);
  return {
    symbol: params.symbol,
    interval: params.interval,
    asOfTs,
    windowEndTs: new Date(params.decisionTimeMs),
    trades: Number(row.trades) || 0,
    whaleSides: Number(row.whale_sides) || 0,
    uniqueWhales: Number(row.unique_whales) || 0,
    coveredWhales: Number(row.covered_whales) || 0,
    expectedWhales: Number(row.expected_whales) || 0,
    coveragePct: Number(row.coverage_pct) || 0,
    buyNotionalUsd: Number(row.buy_notional_usd) || 0,
    sellNotionalUsd: Number(row.sell_notional_usd) || 0,
    netNotionalUsd: Number(row.net_notional_usd) || 0,
    buySharePct:
      row.buy_share_pct == null ? null : Number(row.buy_share_pct) || 0,
    positionAwareWhaleSides: Number(row.position_aware_whale_sides) || 0,
    positionAwarePct: Number(row.position_aware_pct) || 0,
    longEntryWhales: Number(row.long_entry_whales) || 0,
    shortEntryWhales: Number(row.short_entry_whales) || 0,
    longExitWhales: Number(row.long_exit_whales) || 0,
    shortExitWhales: Number(row.short_exit_whales) || 0,
    longEntryNotionalUsd: Number(row.long_entry_notional_usd) || 0,
    shortEntryNotionalUsd: Number(row.short_entry_notional_usd) || 0,
    longExitNotionalUsd: Number(row.long_exit_notional_usd) || 0,
    shortExitNotionalUsd: Number(row.short_exit_notional_usd) || 0,
    entryNetNotionalUsd: Number(row.entry_net_notional_usd) || 0,
    entryLongSharePct:
      row.entry_long_share_pct == null
        ? null
        : Number(row.entry_long_share_pct) || 0,
    universeFingerprint: params.universeFingerprint,
    whaleRegistryFingerprint: params.whaleRegistryFingerprint,
    source: row.source == null ? null : String(row.source),
    ageMs,
    stale:
      ageMs < 0 ||
      (params.maxAgeMs != null && Number.isFinite(params.maxAgeMs)
        ? ageMs > params.maxAgeMs
        : false),
  };
}

export async function hasHyperliquidWhaleBackfillCoverage(params: {
  fromMs: number;
  toMs: number;
  universeFingerprint: string;
  whaleRegistryFingerprint: string;
}) {
  await ensureHyperliquidWhaleSchema();
  const expectedBuckets = Math.max(
    0,
    Math.ceil((params.toMs - params.fromMs) / 60_000),
  );
  const result = await getPool().query(
    `
      SELECT
        COUNT(*)::int AS buckets,
        COUNT(*) FILTER (
          WHERE covered_whales = expected_whales
        )::int AS complete_buckets
      FROM hyperliquid_whale_coverage_1m
      WHERE universe_fingerprint = $1
        AND whale_registry_fingerprint = $2
        AND data_model_version = $5
        AND ts >= to_timestamp($3/1000.0)
        AND ts < to_timestamp($4/1000.0)
    `,
    [
      params.universeFingerprint,
      params.whaleRegistryFingerprint,
      params.fromMs,
      params.toMs,
      HYPERLIQUID_WHALE_DATA_MODEL_VERSION,
    ],
  );
  return (
    Number(result.rows[0]?.buckets) === expectedBuckets &&
    Number(result.rows[0]?.complete_buckets) === expectedBuckets
  );
}
