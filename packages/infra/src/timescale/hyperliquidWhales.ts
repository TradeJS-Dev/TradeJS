import {
  HYPERLIQUID_WHALE_DATA_MODEL_VERSION,
  type HyperliquidWhaleCoverageRow,
  type HyperliquidWhaleFlowRow,
  type HyperliquidWhaleTradeEventRow,
  type MarketFeatureInterval,
} from '@tradejs/types';
import {
  getPool,
  queryMarketContext,
  getSafeBulkInsertRows,
  ensureHyperliquidWhaleSchema,
  prepareMarketContextSchemaForRead,
} from './internal';

const HYPERLIQUID_CONTEXT_INTERVAL_MS: Record<MarketFeatureInterval, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
};

export async function upsertHyperliquidWhaleTradeEvents(
  rows: HyperliquidWhaleTradeEventRow[],
) {
  if (!rows.length) return;
  await ensureHyperliquidWhaleSchema();
  const cols = [
    'symbol',
    'ts',
    'tid',
    'price',
    'size',
    'notional_usd',
    'buyer_address',
    'seller_address',
    'buyer_tracked',
    'seller_tracked',
    'buyer_start_position',
    'buyer_end_position',
    'buyer_position_action',
    'buyer_closed_pnl',
    'buyer_liquidation',
    'seller_start_position',
    'seller_end_position',
    'seller_position_action',
    'seller_closed_pnl',
    'seller_liquidation',
    'universe_fingerprint',
    'whale_registry_fingerprint',
    'source',
  ] as const;
  const maxRows = getSafeBulkInsertRows(cols.length);
  if (rows.length > maxRows) {
    for (let index = 0; index < rows.length; index += maxRows) {
      await upsertHyperliquidWhaleTradeEvents(
        rows.slice(index, index + maxRows),
      );
    }
    return;
  }

  const valuesSql = rows
    .map(
      (_, rowIndex) =>
        `(${cols
          .map((__, colIndex) => `$${rowIndex * cols.length + colIndex + 1}`)
          .join(',')})`,
    )
    .join(',');
  const flat = rows.flatMap((row) => [
    row.symbol,
    row.ts,
    row.tid,
    row.price,
    row.size,
    row.notionalUsd,
    row.buyerAddress ?? null,
    row.sellerAddress ?? null,
    row.buyerTracked,
    row.sellerTracked,
    row.buyerStartPosition ?? null,
    row.buyerEndPosition ?? null,
    row.buyerPositionAction ?? null,
    row.buyerClosedPnl ?? null,
    row.buyerLiquidation ?? null,
    row.sellerStartPosition ?? null,
    row.sellerEndPosition ?? null,
    row.sellerPositionAction ?? null,
    row.sellerClosedPnl ?? null,
    row.sellerLiquidation ?? null,
    row.universeFingerprint,
    row.whaleRegistryFingerprint,
    row.source ?? null,
  ]);
  await getPool().query(
    `
      INSERT INTO hyperliquid_whale_trade_events (${cols.join(',')})
      VALUES ${valuesSql}
      ON CONFLICT (
        universe_fingerprint,
        whale_registry_fingerprint,
        symbol,
        ts,
        tid
      ) DO UPDATE SET
        buyer_address = COALESCE(
          hyperliquid_whale_trade_events.buyer_address,
          EXCLUDED.buyer_address
        ),
        seller_address = COALESCE(
          hyperliquid_whale_trade_events.seller_address,
          EXCLUDED.seller_address
        ),
        buyer_tracked = hyperliquid_whale_trade_events.buyer_tracked OR EXCLUDED.buyer_tracked,
        seller_tracked = hyperliquid_whale_trade_events.seller_tracked OR EXCLUDED.seller_tracked,
        buyer_start_position = COALESCE(
          hyperliquid_whale_trade_events.buyer_start_position,
          EXCLUDED.buyer_start_position
        ),
        buyer_end_position = COALESCE(
          hyperliquid_whale_trade_events.buyer_end_position,
          EXCLUDED.buyer_end_position
        ),
        buyer_position_action = COALESCE(
          hyperliquid_whale_trade_events.buyer_position_action,
          EXCLUDED.buyer_position_action
        ),
        buyer_closed_pnl = COALESCE(
          hyperliquid_whale_trade_events.buyer_closed_pnl,
          EXCLUDED.buyer_closed_pnl
        ),
        buyer_liquidation = COALESCE(
          hyperliquid_whale_trade_events.buyer_liquidation,
          EXCLUDED.buyer_liquidation
        ),
        seller_start_position = COALESCE(
          hyperliquid_whale_trade_events.seller_start_position,
          EXCLUDED.seller_start_position
        ),
        seller_end_position = COALESCE(
          hyperliquid_whale_trade_events.seller_end_position,
          EXCLUDED.seller_end_position
        ),
        seller_position_action = COALESCE(
          hyperliquid_whale_trade_events.seller_position_action,
          EXCLUDED.seller_position_action
        ),
        seller_closed_pnl = COALESCE(
          hyperliquid_whale_trade_events.seller_closed_pnl,
          EXCLUDED.seller_closed_pnl
        ),
        seller_liquidation = COALESCE(
          hyperliquid_whale_trade_events.seller_liquidation,
          EXCLUDED.seller_liquidation
        ),
        source = EXCLUDED.source,
        ingested_at = now()
    `,
    flat,
  );
}

export async function upsertHyperliquidWhaleFlowRows(
  rows: HyperliquidWhaleFlowRow[],
) {
  if (!rows.length) return;
  await ensureHyperliquidWhaleSchema();
  const cols = [
    'symbol',
    'interval',
    'ts',
    'trades',
    'whale_sides',
    'unique_whales',
    'whale_addresses',
    'buy_notional_usd',
    'sell_notional_usd',
    'net_notional_usd',
    'buy_share_pct',
    'position_aware_whale_sides',
    'long_entry_whale_addresses',
    'short_entry_whale_addresses',
    'long_exit_whale_addresses',
    'short_exit_whale_addresses',
    'long_entry_notional_usd',
    'short_entry_notional_usd',
    'long_exit_notional_usd',
    'short_exit_notional_usd',
    'entry_net_notional_usd',
    'entry_long_share_pct',
    'universe_fingerprint',
    'whale_registry_fingerprint',
    'source',
  ] as const;
  const maxRows = getSafeBulkInsertRows(cols.length);
  if (rows.length > maxRows) {
    for (let index = 0; index < rows.length; index += maxRows) {
      await upsertHyperliquidWhaleFlowRows(rows.slice(index, index + maxRows));
    }
    return;
  }

  const valuesSql = rows
    .map(
      (_, rowIndex) =>
        `(${cols
          .map((__, colIndex) => `$${rowIndex * cols.length + colIndex + 1}`)
          .join(',')})`,
    )
    .join(',');
  const flat = rows.flatMap((row) => [
    row.symbol,
    row.interval,
    row.ts,
    row.trades,
    row.whaleSides,
    row.uniqueWhales,
    row.whaleAddresses ?? [],
    row.buyNotionalUsd,
    row.sellNotionalUsd,
    row.netNotionalUsd,
    row.buySharePct ?? null,
    row.positionAwareWhaleSides,
    row.longEntryWhaleAddresses ?? [],
    row.shortEntryWhaleAddresses ?? [],
    row.longExitWhaleAddresses ?? [],
    row.shortExitWhaleAddresses ?? [],
    row.longEntryNotionalUsd,
    row.shortEntryNotionalUsd,
    row.longExitNotionalUsd,
    row.shortExitNotionalUsd,
    row.entryNetNotionalUsd,
    row.entryLongSharePct ?? null,
    row.universeFingerprint,
    row.whaleRegistryFingerprint,
    row.source ?? null,
  ]);
  await getPool().query(
    `
      INSERT INTO hyperliquid_whale_flow (${cols.join(',')})
      VALUES ${valuesSql}
      ON CONFLICT (
        universe_fingerprint,
        whale_registry_fingerprint,
        symbol,
        interval,
        ts
      ) DO UPDATE SET
        trades = EXCLUDED.trades,
        whale_sides = EXCLUDED.whale_sides,
        unique_whales = EXCLUDED.unique_whales,
        whale_addresses = EXCLUDED.whale_addresses,
        buy_notional_usd = EXCLUDED.buy_notional_usd,
        sell_notional_usd = EXCLUDED.sell_notional_usd,
        net_notional_usd = EXCLUDED.net_notional_usd,
        buy_share_pct = EXCLUDED.buy_share_pct,
        position_aware_whale_sides = EXCLUDED.position_aware_whale_sides,
        long_entry_whale_addresses = EXCLUDED.long_entry_whale_addresses,
        short_entry_whale_addresses = EXCLUDED.short_entry_whale_addresses,
        long_exit_whale_addresses = EXCLUDED.long_exit_whale_addresses,
        short_exit_whale_addresses = EXCLUDED.short_exit_whale_addresses,
        long_entry_notional_usd = EXCLUDED.long_entry_notional_usd,
        short_entry_notional_usd = EXCLUDED.short_entry_notional_usd,
        long_exit_notional_usd = EXCLUDED.long_exit_notional_usd,
        short_exit_notional_usd = EXCLUDED.short_exit_notional_usd,
        entry_net_notional_usd = EXCLUDED.entry_net_notional_usd,
        entry_long_share_pct = EXCLUDED.entry_long_share_pct,
        source = EXCLUDED.source,
        ingested_at = now()
    `,
    flat,
  );
}

export async function rebuildHyperliquidWhaleFlowRows(params: {
  fromMs: number;
  toMs: number;
  universeFingerprint: string;
  whaleRegistryFingerprint: string;
  deleteEventsBeforeMs?: number;
}) {
  await ensureHyperliquidWhaleSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `
        WITH source_events AS (
          SELECT *
          FROM hyperliquid_whale_trade_events
          WHERE universe_fingerprint = $1
            AND whale_registry_fingerprint = $2
            AND ts >= to_timestamp($3/1000.0)
            AND ts < to_timestamp($4/1000.0)
        ), metrics AS (
          SELECT
            symbol,
            date_trunc('minute', ts) AS bucket_ts,
            COUNT(*)::int AS trades,
            SUM(buyer_tracked::int + seller_tracked::int)::int AS whale_sides,
            SUM(CASE WHEN buyer_tracked THEN notional_usd ELSE 0 END) AS buy_notional_usd,
            SUM(CASE WHEN seller_tracked THEN notional_usd ELSE 0 END) AS sell_notional_usd
          FROM source_events
          GROUP BY symbol, date_trunc('minute', ts)
        ), position_legs AS (
          SELECT
            symbol,
            ts,
            price,
            buyer_address AS whale_address,
            buyer_start_position AS start_position,
            buyer_end_position AS end_position
          FROM source_events
          WHERE buyer_tracked
            AND buyer_address IS NOT NULL
            AND buyer_start_position IS NOT NULL
            AND buyer_end_position IS NOT NULL
          UNION ALL
          SELECT
            symbol,
            ts,
            price,
            seller_address AS whale_address,
            seller_start_position AS start_position,
            seller_end_position AS end_position
          FROM source_events
          WHERE seller_tracked
            AND seller_address IS NOT NULL
            AND seller_start_position IS NOT NULL
            AND seller_end_position IS NOT NULL
        ), classified_legs AS (
          SELECT
            *,
            GREATEST(
              GREATEST(end_position, 0) - GREATEST(start_position, 0),
              0
            ) AS long_entry_size,
            GREATEST(
              GREATEST(-end_position, 0) - GREATEST(-start_position, 0),
              0
            ) AS short_entry_size,
            GREATEST(
              GREATEST(start_position, 0) - GREATEST(end_position, 0),
              0
            ) AS long_exit_size,
            GREATEST(
              GREATEST(-start_position, 0) - GREATEST(-end_position, 0),
              0
            ) AS short_exit_size
          FROM position_legs
        ), position_metrics AS (
          SELECT
            symbol,
            date_trunc('minute', ts) AS bucket_ts,
            COUNT(*)::int AS position_aware_whale_sides,
            SUM(long_entry_size * price) AS long_entry_notional_usd,
            SUM(short_entry_size * price) AS short_entry_notional_usd,
            SUM(long_exit_size * price) AS long_exit_notional_usd,
            SUM(short_exit_size * price) AS short_exit_notional_usd,
            COALESCE(
              ARRAY_AGG(DISTINCT whale_address ORDER BY whale_address)
                FILTER (WHERE long_entry_size > 0),
              '{}'
            ) AS long_entry_whale_addresses,
            COALESCE(
              ARRAY_AGG(DISTINCT whale_address ORDER BY whale_address)
                FILTER (WHERE short_entry_size > 0),
              '{}'
            ) AS short_entry_whale_addresses,
            COALESCE(
              ARRAY_AGG(DISTINCT whale_address ORDER BY whale_address)
                FILTER (WHERE long_exit_size > 0),
              '{}'
            ) AS long_exit_whale_addresses,
            COALESCE(
              ARRAY_AGG(DISTINCT whale_address ORDER BY whale_address)
                FILTER (WHERE short_exit_size > 0),
              '{}'
            ) AS short_exit_whale_addresses
          FROM classified_legs
          GROUP BY symbol, date_trunc('minute', ts)
        ), addresses AS (
          SELECT
            symbol,
            date_trunc('minute', ts) AS bucket_ts,
            ARRAY_AGG(DISTINCT whale_address ORDER BY whale_address) AS whale_addresses
          FROM source_events
          CROSS JOIN LATERAL UNNEST(ARRAY[
            CASE WHEN buyer_tracked THEN buyer_address END,
            CASE WHEN seller_tracked THEN seller_address END
          ]) AS expanded(whale_address)
          WHERE whale_address IS NOT NULL
          GROUP BY symbol, date_trunc('minute', ts)
        )
        INSERT INTO hyperliquid_whale_flow (
          symbol,
          interval,
          ts,
          trades,
          whale_sides,
          unique_whales,
          whale_addresses,
          buy_notional_usd,
          sell_notional_usd,
          net_notional_usd,
          buy_share_pct,
          position_aware_whale_sides,
          long_entry_whale_addresses,
          short_entry_whale_addresses,
          long_exit_whale_addresses,
          short_exit_whale_addresses,
          long_entry_notional_usd,
          short_entry_notional_usd,
          long_exit_notional_usd,
          short_exit_notional_usd,
          entry_net_notional_usd,
          entry_long_share_pct,
          universe_fingerprint,
          whale_registry_fingerprint,
          source
        )
        SELECT
          metrics.symbol,
          '1m',
          metrics.bucket_ts,
          metrics.trades,
          metrics.whale_sides,
          COALESCE(CARDINALITY(addresses.whale_addresses), 0),
          COALESCE(addresses.whale_addresses, '{}'),
          metrics.buy_notional_usd,
          metrics.sell_notional_usd,
          metrics.buy_notional_usd - metrics.sell_notional_usd,
          CASE
            WHEN metrics.buy_notional_usd + metrics.sell_notional_usd > 0
            THEN metrics.buy_notional_usd /
              (metrics.buy_notional_usd + metrics.sell_notional_usd)
            ELSE NULL
          END,
          COALESCE(position_metrics.position_aware_whale_sides, 0),
          COALESCE(position_metrics.long_entry_whale_addresses, '{}'),
          COALESCE(position_metrics.short_entry_whale_addresses, '{}'),
          COALESCE(position_metrics.long_exit_whale_addresses, '{}'),
          COALESCE(position_metrics.short_exit_whale_addresses, '{}'),
          COALESCE(position_metrics.long_entry_notional_usd, 0),
          COALESCE(position_metrics.short_entry_notional_usd, 0),
          COALESCE(position_metrics.long_exit_notional_usd, 0),
          COALESCE(position_metrics.short_exit_notional_usd, 0),
          COALESCE(position_metrics.long_entry_notional_usd, 0) -
            COALESCE(position_metrics.short_entry_notional_usd, 0),
          CASE
            WHEN COALESCE(position_metrics.long_entry_notional_usd, 0) +
              COALESCE(position_metrics.short_entry_notional_usd, 0) > 0
            THEN COALESCE(position_metrics.long_entry_notional_usd, 0) /
              (
                COALESCE(position_metrics.long_entry_notional_usd, 0) +
                COALESCE(position_metrics.short_entry_notional_usd, 0)
              )
            ELSE NULL
          END,
          $1,
          $2,
          CASE
            WHEN COALESCE(position_metrics.position_aware_whale_sides, 0) > 0
            THEN 'hyperliquid_user_fills'
            ELSE 'hyperliquid_trades'
          END
        FROM metrics
        LEFT JOIN addresses USING (symbol, bucket_ts)
        LEFT JOIN position_metrics USING (symbol, bucket_ts)
        ON CONFLICT (
          universe_fingerprint,
          whale_registry_fingerprint,
          symbol,
          interval,
          ts
        ) DO UPDATE SET
          trades = EXCLUDED.trades,
          whale_sides = EXCLUDED.whale_sides,
          unique_whales = EXCLUDED.unique_whales,
          whale_addresses = EXCLUDED.whale_addresses,
          buy_notional_usd = EXCLUDED.buy_notional_usd,
          sell_notional_usd = EXCLUDED.sell_notional_usd,
          net_notional_usd = EXCLUDED.net_notional_usd,
          buy_share_pct = EXCLUDED.buy_share_pct,
          position_aware_whale_sides = EXCLUDED.position_aware_whale_sides,
          long_entry_whale_addresses = EXCLUDED.long_entry_whale_addresses,
          short_entry_whale_addresses = EXCLUDED.short_entry_whale_addresses,
          long_exit_whale_addresses = EXCLUDED.long_exit_whale_addresses,
          short_exit_whale_addresses = EXCLUDED.short_exit_whale_addresses,
          long_entry_notional_usd = EXCLUDED.long_entry_notional_usd,
          short_entry_notional_usd = EXCLUDED.short_entry_notional_usd,
          long_exit_notional_usd = EXCLUDED.long_exit_notional_usd,
          short_exit_notional_usd = EXCLUDED.short_exit_notional_usd,
          entry_net_notional_usd = EXCLUDED.entry_net_notional_usd,
          entry_long_share_pct = EXCLUDED.entry_long_share_pct,
          source = EXCLUDED.source,
          ingested_at = now()
        RETURNING 1
      `,
      [
        params.universeFingerprint,
        params.whaleRegistryFingerprint,
        params.fromMs,
        params.toMs,
      ],
    );
    if (params.deleteEventsBeforeMs != null) {
      await client.query(
        `
          DELETE FROM hyperliquid_whale_trade_events
          WHERE universe_fingerprint = $1
            AND whale_registry_fingerprint = $2
            AND ts < to_timestamp($3/1000.0)
        `,
        [
          params.universeFingerprint,
          params.whaleRegistryFingerprint,
          params.deleteEventsBeforeMs,
        ],
      );
    }
    await client.query('COMMIT');
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export type HyperliquidWhaleWalletCoverageStatus =
  | 'complete'
  | 'truncated'
  | 'failed';

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

export async function upsertHyperliquidWhaleWalletCoverage(params: {
  address: string;
  fromMs: number;
  toMs: number;
  coveredFromMs: number | null;
  coveredToMs: number | null;
  status: HyperliquidWhaleWalletCoverageStatus;
  fillsCount: number;
  error?: string | null;
  universeFingerprint: string;
  whaleRegistryFingerprint: string;
}) {
  await ensureHyperliquidWhaleSchema();
  await getPool().query(
    `
      INSERT INTO hyperliquid_whale_wallet_coverage (
        universe_fingerprint,
        whale_registry_fingerprint,
        address,
        requested_from_ts,
        requested_to_ts,
        covered_from_ts,
        covered_to_ts,
        status,
        fills_count,
        error,
        data_model_version
      ) VALUES (
        $1,
        $2,
        $3,
        to_timestamp($4/1000.0),
        to_timestamp($5/1000.0),
        CASE WHEN $6::double precision IS NULL THEN NULL ELSE to_timestamp($6/1000.0) END,
        CASE WHEN $7::double precision IS NULL THEN NULL ELSE to_timestamp($7/1000.0) END,
        $8,
        $9,
        $10,
        $11
      )
      ON CONFLICT (
        universe_fingerprint,
        whale_registry_fingerprint,
        address,
        requested_from_ts,
        requested_to_ts
      ) DO UPDATE SET
        covered_from_ts = EXCLUDED.covered_from_ts,
        covered_to_ts = EXCLUDED.covered_to_ts,
        status = EXCLUDED.status,
        fills_count = EXCLUDED.fills_count,
        error = EXCLUDED.error,
        data_model_version = EXCLUDED.data_model_version,
        checked_at = now()
    `,
    [
      params.universeFingerprint,
      params.whaleRegistryFingerprint,
      params.address.toLowerCase(),
      params.fromMs,
      params.toMs,
      params.coveredFromMs,
      params.coveredToMs,
      params.status,
      params.fillsCount,
      params.error ?? null,
      HYPERLIQUID_WHALE_DATA_MODEL_VERSION,
    ],
  );
}

export type HyperliquidWhaleCoverageRebuildProgress = {
  chunkIndex: number;
  totalChunks: number;
  completedBuckets: number;
  totalBuckets: number;
  rows: number;
};

export async function rebuildHyperliquidWhaleCoverageRows(params: {
  fromMs: number;
  toMs: number;
  expectedWhales: number;
  universeFingerprint: string;
  whaleRegistryFingerprint: string;
  chunkMinutes?: number;
  onProgress?: (progress: HyperliquidWhaleCoverageRebuildProgress) => void;
}) {
  await ensureHyperliquidWhaleSchema();
  if (params.toMs <= params.fromMs) return 0;
  const minuteMs = 60_000;
  const defaultChunkMinutes = 7 * 24 * 60;
  const chunkMinutes =
    Number.isFinite(params.chunkMinutes) && Number(params.chunkMinutes) > 0
      ? Math.floor(Number(params.chunkMinutes))
      : defaultChunkMinutes;
  const chunkMs = chunkMinutes * minuteMs;
  const totalBuckets = Math.ceil((params.toMs - params.fromMs) / minuteMs);
  const totalChunks = Math.ceil((params.toMs - params.fromMs) / chunkMs);
  let completedBuckets = 0;
  let rows = 0;

  for (
    let chunkIndex = 0, chunkFromMs = params.fromMs;
    chunkFromMs < params.toMs;
    chunkIndex += 1, chunkFromMs += chunkMs
  ) {
    const chunkToMs = Math.min(params.toMs, chunkFromMs + chunkMs);
    const result = await getPool().query(
      `
        WITH normalized_ranges AS (
          SELECT
            address,
            GREATEST(
              to_timestamp($3/1000.0),
              date_trunc('minute', covered_from_ts) +
                CASE
                  WHEN covered_from_ts = date_trunc('minute', covered_from_ts)
                  THEN interval '0 minutes'
                  ELSE interval '1 minute'
                END
            ) AS range_start,
            LEAST(
              to_timestamp($4/1000.0),
              date_trunc('minute', covered_to_ts)
            ) AS range_end
          FROM hyperliquid_whale_wallet_coverage
          WHERE universe_fingerprint = $1
            AND whale_registry_fingerprint = $2
            AND data_model_version = $6
            AND status IN ('complete', 'truncated')
            AND covered_from_ts < to_timestamp($4/1000.0)
            AND covered_to_ts > to_timestamp($3/1000.0)
        ), eligible_ranges AS (
          SELECT *
          FROM normalized_ranges
          WHERE range_start < range_end
        ), ordered_ranges AS (
          SELECT
            *,
            MAX(range_end) OVER (
              PARTITION BY address
              ORDER BY range_start, range_end
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ) AS previous_max_end
          FROM eligible_ranges
        ), marked_ranges AS (
          SELECT
            *,
            SUM(
              CASE
                WHEN previous_max_end IS NULL OR range_start > previous_max_end
                THEN 1
                ELSE 0
              END
            ) OVER (
              PARTITION BY address
              ORDER BY range_start, range_end
            ) AS range_group
          FROM ordered_ranges
        ), merged_ranges AS (
          SELECT
            address,
            MIN(range_start) AS range_start,
            MAX(range_end) AS range_end
          FROM marked_ranges
          GROUP BY address, range_group
        ), deltas AS (
          SELECT range_start AS ts, 1 AS delta
          FROM merged_ranges
          UNION ALL
          SELECT range_end AS ts, -1 AS delta
          FROM merged_ranges
        ), bucket_deltas AS (
          SELECT ts, SUM(delta)::int AS delta
          FROM deltas
          GROUP BY ts
        ), buckets AS (
          SELECT generate_series(
            to_timestamp($3/1000.0),
            to_timestamp($4/1000.0) - interval '1 minute',
            interval '1 minute'
          ) AS ts
        ), coverage AS (
          SELECT
            buckets.ts,
            SUM(COALESCE(bucket_deltas.delta, 0)) OVER (
              ORDER BY buckets.ts
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            )::int AS covered_whales
          FROM buckets
          LEFT JOIN bucket_deltas USING (ts)
        )
        INSERT INTO hyperliquid_whale_coverage_1m (
          ts,
          covered_whales,
          expected_whales,
          coverage_pct,
          universe_fingerprint,
          whale_registry_fingerprint,
          source,
          data_model_version
        )
        SELECT
          ts,
          covered_whales,
          $5,
          CASE WHEN $5 > 0 THEN covered_whales::double precision / $5 ELSE 0 END,
          $1,
          $2,
          'hyperliquid_user_fills',
          $6
        FROM coverage
        ON CONFLICT (
          universe_fingerprint,
          whale_registry_fingerprint,
          ts
        ) DO UPDATE SET
          covered_whales = EXCLUDED.covered_whales,
          expected_whales = EXCLUDED.expected_whales,
          coverage_pct = EXCLUDED.coverage_pct,
          source = EXCLUDED.source,
          data_model_version = EXCLUDED.data_model_version,
          ingested_at = now()
      `,
      [
        params.universeFingerprint,
        params.whaleRegistryFingerprint,
        chunkFromMs,
        chunkToMs,
        params.expectedWhales,
        HYPERLIQUID_WHALE_DATA_MODEL_VERSION,
      ],
    );
    const chunkBuckets = Math.ceil((chunkToMs - chunkFromMs) / minuteMs);
    completedBuckets = Math.min(totalBuckets, completedBuckets + chunkBuckets);
    rows += result.rowCount ?? 0;
    params.onProgress?.({
      chunkIndex: chunkIndex + 1,
      totalChunks,
      completedBuckets,
      totalBuckets,
      rows,
    });
  }

  return rows;
}

export async function upsertHyperliquidWhaleCoverageRows(
  rows: HyperliquidWhaleCoverageRow[],
) {
  if (!rows.length) return;
  await ensureHyperliquidWhaleSchema();
  const cols = [
    'ts',
    'covered_whales',
    'expected_whales',
    'coverage_pct',
    'universe_fingerprint',
    'whale_registry_fingerprint',
    'source',
    'data_model_version',
  ] as const;
  const maxRows = getSafeBulkInsertRows(cols.length);
  if (rows.length > maxRows) {
    for (let index = 0; index < rows.length; index += maxRows) {
      await upsertHyperliquidWhaleCoverageRows(
        rows.slice(index, index + maxRows),
      );
    }
    return;
  }
  const values: unknown[] = [];
  const tuples = rows.map((row, rowIndex) => {
    const offset = rowIndex * cols.length;
    values.push(
      row.ts,
      row.coveredWhales,
      row.expectedWhales,
      row.coveragePct,
      row.universeFingerprint,
      row.whaleRegistryFingerprint,
      row.source ?? null,
      row.dataModelVersion ?? HYPERLIQUID_WHALE_DATA_MODEL_VERSION,
    );
    return `(${cols.map((_, colIndex) => `$${offset + colIndex + 1}`).join(',')})`;
  });
  await getPool().query(
    `
      INSERT INTO hyperliquid_whale_coverage_1m (${cols.join(',')})
      VALUES ${tuples.join(',')}
      ON CONFLICT (
        universe_fingerprint,
        whale_registry_fingerprint,
        ts
      ) DO UPDATE SET
        covered_whales = EXCLUDED.covered_whales,
        expected_whales = EXCLUDED.expected_whales,
        coverage_pct = EXCLUDED.coverage_pct,
        source = EXCLUDED.source,
        data_model_version = EXCLUDED.data_model_version,
        ingested_at = now()
    `,
    values,
  );
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

export type {
  MarketFeatureAsOf,
  TimescaleMarketContextQueryOptions,
} from './internal';
export { ensureHyperliquidWhaleSchema } from './internal';
