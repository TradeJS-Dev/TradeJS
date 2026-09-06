import type {
  MarketCmcExchangeLiquidityContextRow,
  MarketCmcFearGreedContextRow,
  MarketCmcIndexContextRow,
  MarketBreadthRow,
  MarketFeatureInterval,
  MarketGlobalContextRow,
  MarketReferenceAssetContextRow,
  MarketTradeFlowRow,
} from '@tradejs/types';
import {
  getPool,
  queryMarketContext,
  ensureBinanceMarketSchema,
  prepareMarketContextSchemaForRead,
  toMarketFeatureAge,
  type MarketFeatureAsOf,
} from '../internal';

export async function getMarketContextBackfillCoverage(params: {
  source: string;
  scopes: string[];
  interval: string;
  fromMs: number;
  toMs: number;
}): Promise<
  Array<{
    source: string;
    scope: string;
    interval: string;
    fromMs: number;
    toMs: number;
    rowsCount: number;
    checkedAtMs?: number;
  }>
> {
  const source = String(params.source || '')
    .trim()
    .toLowerCase();
  const scopes = [
    ...new Set(
      params.scopes
        .map((scope) =>
          String(scope || '')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
  ];
  const interval = String(params.interval || '')
    .trim()
    .toLowerCase();
  if (!source || !scopes.length || !interval) return [];

  await ensureBinanceMarketSchema();
  const pool = getPool();
  const res = await pool.query(
    `
      SELECT
        source,
        scope,
        interval,
        extract(epoch from from_ts)*1000 AS from_ms,
        extract(epoch from to_ts)*1000 AS to_ms,
        rows_count,
        extract(epoch from checked_at)*1000 AS checked_at_ms
      FROM market_context_backfill_coverage
      WHERE source = $1
        AND scope = ANY($2)
        AND interval = $3
        AND from_ts >= to_timestamp($4/1000.0)
        AND to_ts <= to_timestamp($5/1000.0)
    `,
    [source, scopes, interval, params.fromMs, params.toMs],
  );

  return (
    res.rows as Array<{
      source: string;
      scope: string;
      interval: string;
      from_ms: number | string;
      to_ms: number | string;
      rows_count: number | string;
      checked_at_ms?: number | string;
    }>
  ).map((row) => {
    const checkedAtMs = Number(row.checked_at_ms);
    return {
      source: String(row.source).toLowerCase(),
      scope: String(row.scope).toLowerCase(),
      interval: String(row.interval).toLowerCase(),
      fromMs: Number(row.from_ms),
      toMs: Number(row.to_ms),
      rowsCount: Number(row.rows_count ?? 0),
      ...(Number.isFinite(checkedAtMs) ? { checkedAtMs } : {}),
    };
  });
}

export async function getLatestMarketTradeFlow(params: {
  symbol: string;
  interval: MarketFeatureInterval;
  atMs: number;
  maxAgeMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<MarketFeatureAsOf<MarketTradeFlowRow> | null> {
  await prepareMarketContextSchemaForRead('binance');
  const res = await queryMarketContext(
    `
      SELECT
        symbol,
        interval,
        ts,
        trades::int AS trades,
        buy_base_volume AS "buyBaseVolume",
        sell_base_volume AS "sellBaseVolume",
        buy_quote_volume AS "buyQuoteVolume",
        sell_quote_volume AS "sellQuoteVolume",
        net_base_delta AS "netBaseDelta",
        net_quote_delta AS "netQuoteDelta",
        buy_pressure_pct AS "buyPressurePct",
        source
      FROM market_trade_flow
      WHERE symbol = $1
        AND interval = $2
        AND ts <= to_timestamp($3/1000.0)
      ORDER BY ts DESC
      LIMIT 1
    `,
    [params.symbol.toUpperCase(), params.interval, params.atMs],
    params,
  );
  const row = res.rows[0] as MarketTradeFlowRow | undefined;
  if (!row) return null;
  const ageMs = toMarketFeatureAge(row.ts, params.atMs);
  return {
    ...row,
    ageMs,
    stale:
      ageMs == null || (params.maxAgeMs != null && ageMs > params.maxAgeMs),
  };
}

export async function getMarketTradeFlowRows(params: {
  symbols: string[];
  interval: MarketFeatureInterval;
  fromMs: number;
  toMs: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<MarketTradeFlowRow[]> {
  const symbols = [
    ...new Set(params.symbols.map((symbol) => symbol.trim().toUpperCase())),
  ].filter(Boolean);
  if (!symbols.length || params.toMs < params.fromMs) return [];

  await prepareMarketContextSchemaForRead('binance');
  const res = await queryMarketContext(
    `
      SELECT
        symbol,
        interval,
        ts,
        trades::int AS trades,
        buy_base_volume AS "buyBaseVolume",
        sell_base_volume AS "sellBaseVolume",
        buy_quote_volume AS "buyQuoteVolume",
        sell_quote_volume AS "sellQuoteVolume",
        net_base_delta AS "netBaseDelta",
        net_quote_delta AS "netQuoteDelta",
        buy_pressure_pct AS "buyPressurePct",
        source
      FROM market_trade_flow
      WHERE symbol = ANY($1)
        AND interval = $2
        AND ts >= to_timestamp($3/1000.0)
        AND ts <= to_timestamp($4/1000.0)
      ORDER BY symbol, ts
    `,
    [symbols, params.interval, params.fromMs, params.toMs],
    params,
  );
  return res.rows as MarketTradeFlowRow[];
}

export async function getLatestMarketBreadth(params: {
  universe: string;
  interval: MarketFeatureInterval;
  atMs: number;
  maxAgeMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<MarketFeatureAsOf<MarketBreadthRow> | null> {
  await prepareMarketContextSchemaForRead('binance');
  const res = await queryMarketContext(
    `
      SELECT
        universe,
        interval,
        ts,
        symbols_count::int AS "symbolsCount",
        advancers::int AS advancers,
        decliners::int AS decliners,
        unchanged::int AS unchanged,
        advance_decline_ratio AS "advanceDeclineRatio",
        pct_above_ma20 AS "pctAboveMa20",
        pct_above_ma50 AS "pctAboveMa50",
        equal_weighted_return AS "equalWeightedReturn",
        volume_weighted_return AS "volumeWeightedReturn",
        dispersion,
        btc_return_1h AS "btcReturn1h",
        btc_return_4h AS "btcReturn4h",
        btc_return_24h AS "btcReturn24h",
        alt_basket_return_1h AS "altBasketReturn1h",
        alt_basket_return_4h AS "altBasketReturn4h",
        alt_basket_return_24h AS "altBasketReturn24h",
        btc_vs_alt_return_1h AS "btcVsAltReturn1h",
        btc_vs_alt_return_4h AS "btcVsAltReturn4h",
        btc_vs_alt_return_24h AS "btcVsAltReturn24h",
        btc_turnover_share_1h AS "btcTurnoverShare1h",
        btc_turnover_share_24h AS "btcTurnoverShare24h",
        btc_turnover_share_change_24h AS "btcTurnoverShareChange24h",
        alt_vol_to_btc_vol_24h AS "altVolToBtcVol24h",
        alt_dispersion_24h AS "altDispersion24h",
        btc_alt_regime AS "btcAltRegime",
        source
      FROM market_breadth
      WHERE universe = $1
        AND interval = $2
        AND ts <= to_timestamp($3/1000.0)
      ORDER BY ts DESC
      LIMIT 1
    `,
    [params.universe, params.interval, params.atMs],
    params,
  );
  const row = res.rows[0] as MarketBreadthRow | undefined;
  if (!row) return null;
  const ageMs = toMarketFeatureAge(row.ts, params.atMs);
  return {
    ...row,
    ageMs,
    stale:
      ageMs == null || (params.maxAgeMs != null && ageMs > params.maxAgeMs),
  };
}

export async function getMarketBreadthRows(params: {
  universes: string[];
  interval: MarketFeatureInterval;
  fromMs: number;
  toMs: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<MarketBreadthRow[]> {
  const universes = [
    ...new Set(params.universes.map((universe) => universe.trim())),
  ].filter(Boolean);
  if (!universes.length || params.toMs < params.fromMs) return [];

  await prepareMarketContextSchemaForRead('binance');
  const res = await queryMarketContext(
    `
      SELECT
        universe,
        interval,
        ts,
        symbols_count::int AS "symbolsCount",
        advancers::int AS advancers,
        decliners::int AS decliners,
        unchanged::int AS unchanged,
        advance_decline_ratio AS "advanceDeclineRatio",
        pct_above_ma20 AS "pctAboveMa20",
        pct_above_ma50 AS "pctAboveMa50",
        equal_weighted_return AS "equalWeightedReturn",
        volume_weighted_return AS "volumeWeightedReturn",
        dispersion,
        btc_return_1h AS "btcReturn1h",
        btc_return_4h AS "btcReturn4h",
        btc_return_24h AS "btcReturn24h",
        alt_basket_return_1h AS "altBasketReturn1h",
        alt_basket_return_4h AS "altBasketReturn4h",
        alt_basket_return_24h AS "altBasketReturn24h",
        btc_vs_alt_return_1h AS "btcVsAltReturn1h",
        btc_vs_alt_return_4h AS "btcVsAltReturn4h",
        btc_vs_alt_return_24h AS "btcVsAltReturn24h",
        btc_turnover_share_1h AS "btcTurnoverShare1h",
        btc_turnover_share_24h AS "btcTurnoverShare24h",
        btc_turnover_share_change_24h AS "btcTurnoverShareChange24h",
        alt_vol_to_btc_vol_24h AS "altVolToBtcVol24h",
        alt_dispersion_24h AS "altDispersion24h",
        btc_alt_regime AS "btcAltRegime",
        source
      FROM market_breadth
      WHERE universe = ANY($1)
        AND interval = $2
        AND ts >= to_timestamp($3/1000.0)
        AND ts <= to_timestamp($4/1000.0)
      ORDER BY universe, ts
    `,
    [universes, params.interval, params.fromMs, params.toMs],
    params,
  );
  return res.rows as MarketBreadthRow[];
}

export async function getLatestMarketGlobalContext(params: {
  source?: MarketGlobalContextRow['source'];
  atMs: number;
  maxAgeMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<
  | (MarketFeatureAsOf<MarketGlobalContextRow> & {
      btcDominanceChange24hPct: number | null;
      ethDominanceChange24hPct: number | null;
      altMarketCapChange24hPct: number | null;
      altVolumeChange24hPct: number | null;
    })
  | null
> {
  await prepareMarketContextSchemaForRead('coinmarketcap');
  const source = params.source ?? 'coinmarketcap_global';
  const res = await queryMarketContext(
    `
      SELECT
        source,
        ts,
        updated_at_ts AS "updatedAt",
        active_cryptocurrencies::int AS "activeCryptocurrencies",
        active_exchanges::int AS "activeExchanges",
        active_market_pairs::int AS "activeMarketPairs",
        markets::int AS markets,
        total_market_cap_usd AS "totalMarketCapUsd",
        total_volume_usd AS "totalVolumeUsd",
        total_volume_reported_usd AS "totalVolumeReportedUsd",
        btc_dominance_pct AS "btcDominancePct",
        eth_dominance_pct AS "ethDominancePct",
        alt_market_cap_usd AS "altMarketCapUsd",
        alt_volume_usd AS "altVolumeUsd",
        alt_volume_reported_usd AS "altVolumeReportedUsd",
        btc_to_alt_market_cap_ratio AS "btcToAltMarketCapRatio",
        market_cap_change_pct_24h_usd AS "marketCapChangePct24hUsd"
      FROM market_global_context
      WHERE source = $1
        AND ts + CASE
          WHEN source = 'coinmarketcap_global' THEN interval '1 day'
          ELSE interval '0 seconds'
        END <= to_timestamp($2/1000.0)
      ORDER BY ts DESC
      LIMIT 1
    `,
    [source, params.atMs],
    params,
  );
  const row = res.rows[0] as MarketGlobalContextRow | undefined;
  if (!row) return null;

  const previousRes = await queryMarketContext(
    `
      SELECT
        btc_dominance_pct AS "btcDominancePct",
        eth_dominance_pct AS "ethDominancePct",
        alt_market_cap_usd AS "altMarketCapUsd",
        alt_volume_usd AS "altVolumeUsd"
      FROM market_global_context
      WHERE source = $1
        AND ts <= $2::timestamptz - interval '24 hours'
      ORDER BY ts DESC
      LIMIT 1
    `,
    [source, row.ts],
    params,
  );
  const previousDominance =
    previousRes.rows[0]?.btcDominancePct == null
      ? null
      : Number(previousRes.rows[0].btcDominancePct);
  const previousEthDominance =
    previousRes.rows[0]?.ethDominancePct == null
      ? null
      : Number(previousRes.rows[0].ethDominancePct);
  const previousAltMarketCap =
    previousRes.rows[0]?.altMarketCapUsd == null
      ? null
      : Number(previousRes.rows[0].altMarketCapUsd);
  const previousAltVolume =
    previousRes.rows[0]?.altVolumeUsd == null
      ? null
      : Number(previousRes.rows[0].altVolumeUsd);
  const currentDominance =
    row.btcDominancePct == null ? null : Number(row.btcDominancePct);
  const currentEthDominance =
    row.ethDominancePct == null ? null : Number(row.ethDominancePct);
  const currentAltMarketCap =
    row.altMarketCapUsd == null ? null : Number(row.altMarketCapUsd);
  const currentAltVolume =
    row.altVolumeUsd == null ? null : Number(row.altVolumeUsd);
  const ageMs = toMarketFeatureAge(row.ts, params.atMs);

  return {
    ...row,
    ageMs,
    stale:
      ageMs == null || (params.maxAgeMs != null && ageMs > params.maxAgeMs),
    btcDominanceChange24hPct:
      currentDominance != null && previousDominance != null
        ? currentDominance - previousDominance
        : null,
    ethDominanceChange24hPct:
      currentEthDominance != null && previousEthDominance != null
        ? currentEthDominance - previousEthDominance
        : null,
    altMarketCapChange24hPct:
      currentAltMarketCap != null &&
      previousAltMarketCap != null &&
      previousAltMarketCap > 0
        ? (currentAltMarketCap - previousAltMarketCap) / previousAltMarketCap
        : null,
    altVolumeChange24hPct:
      currentAltVolume != null &&
      previousAltVolume != null &&
      previousAltVolume > 0
        ? (currentAltVolume - previousAltVolume) / previousAltVolume
        : null,
  };
}

export async function getMarketGlobalContextCoverage(params: {
  source: MarketGlobalContextRow['source'];
  startMs: number;
  endMs: number;
}): Promise<{ firstMs: number; lastMs: number; rows: number } | null> {
  await ensureBinanceMarketSchema();
  const pool = getPool();
  const res = await pool.query(
    `
      SELECT
        extract(epoch from MIN(ts))*1000 AS first_ms,
        extract(epoch from MAX(ts))*1000 AS last_ms,
        COUNT(*)::int AS rows
      FROM market_global_context
      WHERE source = $1
        AND ts >= to_timestamp($2/1000.0)
        AND ts <= to_timestamp($3/1000.0)
    `,
    [params.source, params.startMs, params.endMs],
  );
  const row = res.rows[0] as
    | {
        first_ms?: number | string | null;
        last_ms?: number | string | null;
        rows?: number | string | null;
      }
    | undefined;
  const rows = Number(row?.rows ?? 0);
  const firstMs = Number(row?.first_ms);
  const lastMs = Number(row?.last_ms);
  if (!rows || !Number.isFinite(firstMs) || !Number.isFinite(lastMs)) {
    return null;
  }
  return { firstMs, lastMs, rows };
}

export async function getMarketReferenceAssetContextCoverage(params: {
  source: MarketReferenceAssetContextRow['source'];
  symbols: string[];
  interval: MarketReferenceAssetContextRow['interval'];
  startMs: number;
  endMs: number;
}): Promise<Map<string, { firstMs: number; lastMs: number; rows: number }>> {
  const symbols = [
    ...new Set(
      params.symbols
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  const coverage = new Map<
    string,
    { firstMs: number; lastMs: number; rows: number }
  >();
  if (!symbols.length) return coverage;

  await ensureBinanceMarketSchema();
  const pool = getPool();
  const res = await pool.query(
    `
      SELECT
        symbol,
        extract(epoch from MIN(ts))*1000 AS first_ms,
        extract(epoch from MAX(ts))*1000 AS last_ms,
        COUNT(*)::int AS rows
      FROM market_reference_asset_context
      WHERE source = $1
        AND symbol = ANY($2)
        AND interval = $3
        AND ts >= to_timestamp($4/1000.0)
        AND ts <= to_timestamp($5/1000.0)
      GROUP BY symbol
    `,
    [params.source, symbols, params.interval, params.startMs, params.endMs],
  );

  for (const row of res.rows as Array<{
    symbol: string;
    first_ms: number | string;
    last_ms: number | string;
    rows: number | string;
  }>) {
    const firstMs = Number(row.first_ms);
    const lastMs = Number(row.last_ms);
    const rows = Number(row.rows);
    if (Number.isFinite(firstMs) && Number.isFinite(lastMs) && rows > 0) {
      coverage.set(row.symbol.toUpperCase(), { firstMs, lastMs, rows });
    }
  }

  return coverage;
}

export async function getLatestMarketReferenceAssetContexts(params: {
  source?: MarketReferenceAssetContextRow['source'];
  symbols: string[];
  interval?: MarketReferenceAssetContextRow['interval'];
  atMs: number;
  maxAgeMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<Map<string, MarketFeatureAsOf<MarketReferenceAssetContextRow>>> {
  const source = params.source ?? 'coinmarketcap_reference_asset';
  const interval = params.interval ?? '1d';
  const symbols = [
    ...new Set(
      params.symbols
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  const rows = new Map<
    string,
    MarketFeatureAsOf<MarketReferenceAssetContextRow>
  >();
  if (!symbols.length) return rows;

  await prepareMarketContextSchemaForRead('coinmarketcap');
  const res = await queryMarketContext(
    `
      SELECT DISTINCT ON (symbol)
        source,
        symbol,
        cmc_id AS "cmcId",
        interval,
        ts,
        open_usd AS "openUsd",
        high_usd AS "highUsd",
        low_usd AS "lowUsd",
        close_usd AS "closeUsd",
        volume_usd AS "volumeUsd",
        market_cap_usd AS "marketCapUsd"
      FROM market_reference_asset_context
      WHERE source = $1
        AND symbol = ANY($2)
        AND interval = $3
        AND ts + CASE interval
          WHEN '1d' THEN interval '1 day'
          WHEN '1h' THEN interval '1 hour'
          ELSE interval '0 seconds'
        END <= to_timestamp($4/1000.0)
      ORDER BY symbol ASC, ts DESC
    `,
    [source, symbols, interval, params.atMs],
    params,
  );

  for (const row of res.rows as MarketReferenceAssetContextRow[]) {
    const ageMs = toMarketFeatureAge(row.ts, params.atMs);
    rows.set(row.symbol.toUpperCase(), {
      ...row,
      ageMs,
      stale:
        ageMs == null || (params.maxAgeMs != null && ageMs > params.maxAgeMs),
    });
  }

  return rows;
}

export async function getLatestMarketCmcExchangeLiquidityContext(params: {
  source?: MarketCmcExchangeLiquidityContextRow['source'];
  interval?: MarketCmcExchangeLiquidityContextRow['interval'];
  atMs: number;
  maxAgeMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<
  | (MarketFeatureAsOf<MarketCmcExchangeLiquidityContextRow> & {
      totalVolumeChange24hPct: number | null;
    })
  | null
> {
  await prepareMarketContextSchemaForRead('coinmarketcap');
  const source = params.source ?? 'coinmarketcap_exchange_liquidity';
  const interval = params.interval ?? '1d';
  const res = await queryMarketContext(
    `
      SELECT
        source,
        interval,
        ts,
        exchanges_count::int AS "exchangesCount",
        total_volume_usd AS "totalVolumeUsd",
        binance_volume_usd AS "binanceVolumeUsd",
        binance_volume_share AS "binanceVolumeShare",
        top_exchange_volume_share AS "topExchangeVolumeShare",
        liquidity_regime AS "liquidityRegime"
      FROM market_cmc_exchange_liquidity_context
      WHERE source = $1
        AND interval = $2
        AND ts + CASE interval
          WHEN '1d' THEN interval '1 day'
          WHEN '1h' THEN interval '1 hour'
          ELSE interval '0 seconds'
        END <= to_timestamp($3/1000.0)
      ORDER BY ts DESC
      LIMIT 1
    `,
    [source, interval, params.atMs],
    params,
  );
  const row = res.rows[0] as MarketCmcExchangeLiquidityContextRow | undefined;
  if (!row) return null;

  const previousRes = await queryMarketContext(
    `
      SELECT total_volume_usd AS "totalVolumeUsd"
      FROM market_cmc_exchange_liquidity_context
      WHERE source = $1
        AND interval = $2
        AND ts <= $3::timestamptz - interval '24 hours'
      ORDER BY ts DESC
      LIMIT 1
    `,
    [source, interval, row.ts],
    params,
  );
  const currentTotal =
    row.totalVolumeUsd == null ? null : Number(row.totalVolumeUsd);
  const previousTotal =
    previousRes.rows[0]?.totalVolumeUsd == null
      ? null
      : Number(previousRes.rows[0].totalVolumeUsd);
  const ageMs = toMarketFeatureAge(row.ts, params.atMs);

  return {
    ...row,
    ageMs,
    stale:
      ageMs == null || (params.maxAgeMs != null && ageMs > params.maxAgeMs),
    totalVolumeChange24hPct:
      currentTotal != null && previousTotal != null && previousTotal > 0
        ? (currentTotal - previousTotal) / previousTotal
        : null,
  };
}

export async function getLatestMarketCmcIndexContexts(params: {
  source?: MarketCmcIndexContextRow['source'];
  indexSlugs: MarketCmcIndexContextRow['indexSlug'][];
  interval?: MarketCmcIndexContextRow['interval'];
  atMs: number;
  maxAgeMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<
  Map<
    MarketCmcIndexContextRow['indexSlug'],
    MarketFeatureAsOf<MarketCmcIndexContextRow> & {
      valueChange24hPct: number | null;
    }
  >
> {
  const source = params.source ?? 'coinmarketcap_index';
  const interval = params.interval ?? '1d';
  const indexSlugs = [
    ...new Set(
      params.indexSlugs
        .map((slug) => slug.trim().toLowerCase())
        .filter((slug): slug is MarketCmcIndexContextRow['indexSlug'] =>
          ['cmc100', 'cmc20'].includes(slug),
        ),
    ),
  ];
  const rows = new Map<
    MarketCmcIndexContextRow['indexSlug'],
    MarketFeatureAsOf<MarketCmcIndexContextRow> & {
      valueChange24hPct: number | null;
    }
  >();
  if (!indexSlugs.length) return rows;

  await prepareMarketContextSchemaForRead('coinmarketcap');
  const res = await queryMarketContext(
    `
      SELECT DISTINCT ON (index_slug)
        source,
        index_slug AS "indexSlug",
        interval,
        ts,
        value,
        constituents_count::int AS "constituentsCount",
        top_constituent_symbol AS "topConstituentSymbol",
        top_constituent_weight_pct AS "topConstituentWeightPct",
        constituents
      FROM market_cmc_index_context
      WHERE source = $1
        AND index_slug = ANY($2)
        AND interval = $3
        AND ts + CASE interval
          WHEN '1d' THEN interval '1 day'
          WHEN '1h' THEN interval '1 hour'
          ELSE interval '0 seconds'
        END <= to_timestamp($4/1000.0)
      ORDER BY index_slug ASC, ts DESC
    `,
    [source, indexSlugs, interval, params.atMs],
    params,
  );

  for (const row of res.rows as MarketCmcIndexContextRow[]) {
    const previousRes = await queryMarketContext(
      `
        SELECT value
        FROM market_cmc_index_context
        WHERE source = $1
          AND index_slug = $2
          AND interval = $3
          AND ts <= $4::timestamptz - interval '24 hours'
        ORDER BY ts DESC
        LIMIT 1
      `,
      [source, row.indexSlug, interval, row.ts],
      params,
    );
    const currentValue = row.value == null ? null : Number(row.value);
    const previousValue =
      previousRes.rows[0]?.value == null
        ? null
        : Number(previousRes.rows[0].value);
    const ageMs = toMarketFeatureAge(row.ts, params.atMs);
    rows.set(row.indexSlug, {
      ...row,
      ageMs,
      stale:
        ageMs == null || (params.maxAgeMs != null && ageMs > params.maxAgeMs),
      valueChange24hPct:
        currentValue != null && previousValue != null && previousValue > 0
          ? (currentValue - previousValue) / previousValue
          : null,
    });
  }

  return rows;
}

export async function getLatestMarketCmcFearGreedContext(params: {
  source?: MarketCmcFearGreedContextRow['source'];
  interval?: MarketCmcFearGreedContextRow['interval'];
  atMs: number;
  maxAgeMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<
  | (MarketFeatureAsOf<MarketCmcFearGreedContextRow> & {
      valueChange24h: number | null;
      valueChange7d: number | null;
    })
  | null
> {
  await prepareMarketContextSchemaForRead('coinmarketcap');
  const source = params.source ?? 'coinmarketcap_fear_greed';
  const interval = params.interval ?? '1d';
  const res = await queryMarketContext(
    `
      SELECT
        source,
        interval,
        ts,
        value::int AS value,
        classification,
        sentiment_regime AS "sentimentRegime"
      FROM market_cmc_fear_greed_context
      WHERE source = $1
        AND interval = $2
        AND ts + CASE interval
          WHEN '1d' THEN interval '1 day'
          WHEN '1h' THEN interval '1 hour'
          ELSE interval '0 seconds'
        END <= to_timestamp($3/1000.0)
      ORDER BY ts DESC
      LIMIT 1
    `,
    [source, interval, params.atMs],
    params,
  );
  const row = res.rows[0] as MarketCmcFearGreedContextRow | undefined;
  if (!row) return null;

  const previousRes = await queryMarketContext(
    `
      SELECT
        value::int AS value,
        '24h' AS bucket
      FROM market_cmc_fear_greed_context
      WHERE source = $1
        AND interval = $2
        AND ts <= $3::timestamptz - interval '24 hours'
      ORDER BY ts DESC
      LIMIT 1
    `,
    [source, interval, row.ts],
    params,
  );
  const previous7dRes = await queryMarketContext(
    `
      SELECT value::int AS value
      FROM market_cmc_fear_greed_context
      WHERE source = $1
        AND interval = $2
        AND ts <= $3::timestamptz - interval '7 days'
      ORDER BY ts DESC
      LIMIT 1
    `,
    [source, interval, row.ts],
    params,
  );
  const previousValue =
    previousRes.rows[0]?.value == null
      ? null
      : Number(previousRes.rows[0].value);
  const previous7dValue =
    previous7dRes.rows[0]?.value == null
      ? null
      : Number(previous7dRes.rows[0].value);
  const ageMs = toMarketFeatureAge(row.ts, params.atMs);

  return {
    ...row,
    ageMs,
    stale:
      ageMs == null || (params.maxAgeMs != null && ageMs > params.maxAgeMs),
    valueChange24h: previousValue == null ? null : row.value - previousValue,
    valueChange7d: previous7dValue == null ? null : row.value - previous7dValue,
  };
}

export async function getMarketCmcFearGreedContextCoverage(params: {
  source: MarketCmcFearGreedContextRow['source'];
  interval: MarketCmcFearGreedContextRow['interval'];
  startMs: number;
  endMs: number;
}): Promise<{ firstMs: number; lastMs: number; rows: number } | null> {
  await ensureBinanceMarketSchema();
  const pool = getPool();
  const res = await pool.query(
    `
      SELECT
        extract(epoch from MIN(ts))*1000 AS first_ms,
        extract(epoch from MAX(ts))*1000 AS last_ms,
        COUNT(*)::int AS rows
      FROM market_cmc_fear_greed_context
      WHERE source = $1
        AND interval = $2
        AND ts >= to_timestamp($3/1000.0)
        AND ts <= to_timestamp($4/1000.0)
    `,
    [params.source, params.interval, params.startMs, params.endMs],
  );
  const rows = Number(res.rows[0]?.rows ?? 0);
  const firstMs = Number(res.rows[0]?.first_ms);
  const lastMs = Number(res.rows[0]?.last_ms);
  if (!rows || !Number.isFinite(firstMs) || !Number.isFinite(lastMs)) {
    return null;
  }
  return { firstMs, lastMs, rows };
}

export async function getMarketCmcExchangeLiquidityContextCoverage(params: {
  source: MarketCmcExchangeLiquidityContextRow['source'];
  interval: MarketCmcExchangeLiquidityContextRow['interval'];
  startMs: number;
  endMs: number;
}): Promise<{ firstMs: number; lastMs: number; rows: number } | null> {
  await ensureBinanceMarketSchema();
  const pool = getPool();
  const res = await pool.query(
    `
      SELECT
        extract(epoch from MIN(ts))*1000 AS first_ms,
        extract(epoch from MAX(ts))*1000 AS last_ms,
        COUNT(*)::int AS rows
      FROM market_cmc_exchange_liquidity_context
      WHERE source = $1
        AND interval = $2
        AND ts >= to_timestamp($3/1000.0)
        AND ts <= to_timestamp($4/1000.0)
    `,
    [params.source, params.interval, params.startMs, params.endMs],
  );
  const rows = Number(res.rows[0]?.rows ?? 0);
  const firstMs = Number(res.rows[0]?.first_ms);
  const lastMs = Number(res.rows[0]?.last_ms);
  if (!rows || !Number.isFinite(firstMs) || !Number.isFinite(lastMs)) {
    return null;
  }
  return { firstMs, lastMs, rows };
}

export async function getMarketCmcIndexContextCoverage(params: {
  source: MarketCmcIndexContextRow['source'];
  indexSlugs: MarketCmcIndexContextRow['indexSlug'][];
  interval: MarketCmcIndexContextRow['interval'];
  startMs: number;
  endMs: number;
}): Promise<
  Map<
    MarketCmcIndexContextRow['indexSlug'],
    { firstMs: number; lastMs: number; rows: number }
  >
> {
  const indexSlugs = [
    ...new Set(
      params.indexSlugs
        .map((slug) => slug.trim().toLowerCase())
        .filter((slug): slug is MarketCmcIndexContextRow['indexSlug'] =>
          ['cmc100', 'cmc20'].includes(slug),
        ),
    ),
  ];
  const coverage = new Map<
    MarketCmcIndexContextRow['indexSlug'],
    { firstMs: number; lastMs: number; rows: number }
  >();
  if (!indexSlugs.length) return coverage;

  await ensureBinanceMarketSchema();
  const pool = getPool();
  const res = await pool.query(
    `
      SELECT
        index_slug,
        extract(epoch from MIN(ts))*1000 AS first_ms,
        extract(epoch from MAX(ts))*1000 AS last_ms,
        COUNT(*)::int AS rows
      FROM market_cmc_index_context
      WHERE source = $1
        AND index_slug = ANY($2)
        AND interval = $3
        AND ts >= to_timestamp($4/1000.0)
        AND ts <= to_timestamp($5/1000.0)
      GROUP BY index_slug
    `,
    [params.source, indexSlugs, params.interval, params.startMs, params.endMs],
  );

  for (const row of res.rows as Array<{
    index_slug: string;
    first_ms: number | string;
    last_ms: number | string;
    rows: number | string;
  }>) {
    const indexSlug = row.index_slug as MarketCmcIndexContextRow['indexSlug'];
    const firstMs = Number(row.first_ms);
    const lastMs = Number(row.last_ms);
    const rows = Number(row.rows);
    if (Number.isFinite(firstMs) && Number.isFinite(lastMs) && rows > 0) {
      coverage.set(indexSlug, { firstMs, lastMs, rows });
    }
  }

  return coverage;
}

export async function getMarketTradeFlowCoverage(params: {
  symbols: string[];
  interval: MarketFeatureInterval;
  startMs: number;
  endMs: number;
}): Promise<Map<string, { firstMs: number; lastMs: number; rows: number }>> {
  const symbols = [
    ...new Set(params.symbols.map((item) => item.toUpperCase())),
  ];
  if (!symbols.length) return new Map();
  await ensureBinanceMarketSchema();
  const pool = getPool();
  const res = await pool.query(
    `
      SELECT
        symbol,
        MIN(ts) AS first_ts,
        MAX(ts) AS last_ts,
        COUNT(*)::int AS rows
      FROM market_trade_flow
      WHERE symbol = ANY($1)
        AND interval = $2
        AND ts >= to_timestamp($3/1000.0)
        AND ts <= to_timestamp($4/1000.0)
      GROUP BY symbol
    `,
    [symbols, params.interval, params.startMs, params.endMs],
  );
  return new Map(
    res.rows.map((row) => [
      String(row.symbol).toUpperCase(),
      {
        firstMs: new Date(row.first_ts).getTime(),
        lastMs: new Date(row.last_ts).getTime(),
        rows: Number(row.rows) || 0,
      },
    ]),
  );
}

export type DeprecatedMarketContextCleanupItem = {
  kind: 'table' | 'rows';
  name: string;
  rows: number;
  action: 'drop_table' | 'delete_rows';
  applied: boolean;
};

const getTableRowCountIfExists = async (tableName: string) => {
  const pool = getPool();
  const exists = await pool.query('SELECT to_regclass($1) AS name', [
    tableName,
  ]);
  if (!exists.rows[0]?.name) return null;
  const count = await pool.query(
    `SELECT COUNT(*)::int AS rows FROM ${tableName}`,
  );
  return Number(count.rows[0]?.rows ?? 0);
};

export async function cleanupDeprecatedMarketContext(
  params: {
    apply?: boolean;
  } = {},
): Promise<DeprecatedMarketContextCleanupItem[]> {
  const apply = Boolean(params.apply);
  const pool = getPool();
  const items: DeprecatedMarketContextCleanupItem[] = [];

  const cleanupRows = async ({
    tableName,
    whereSql,
    name,
  }: {
    tableName: string;
    whereSql: string;
    name: string;
  }) => {
    const tableRows = await getTableRowCountIfExists(tableName);
    if (tableRows == null) return;
    const count = await pool.query(
      `
        SELECT COUNT(*)::int AS rows
        FROM ${tableName}
        WHERE ${whereSql}
      `,
    );
    const rows = Number(count.rows[0]?.rows ?? 0);
    if (rows <= 0) return;
    if (apply) {
      await pool.query(
        `
          DELETE FROM ${tableName}
          WHERE ${whereSql}
        `,
      );
    }
    items.push({
      kind: 'rows',
      name,
      rows,
      action: 'delete_rows',
      applied: apply,
    });
  };

  for (const tableName of ['market_order_book_depth', 'onchain_flow_context']) {
    const rows = await getTableRowCountIfExists(tableName);
    if (rows == null) continue;
    if (apply) {
      await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
    }
    items.push({
      kind: 'table',
      name: tableName,
      rows,
      action: 'drop_table',
      applied: apply,
    });
  }

  await cleanupRows({
    tableName: 'market_global_context',
    whereSql: "source = 'coingecko_global'",
    name: 'market_global_context/source=coingecko_global',
  });
  await cleanupRows({
    tableName: 'market_global_context',
    whereSql: "source = 'coinmarketcap_global_hourly'",
    name: 'market_global_context/source=coinmarketcap_global_hourly',
  });
  await cleanupRows({
    tableName: 'market_reference_asset_context',
    whereSql: "source = 'coinmarketcap_reference_asset' AND interval = '1h'",
    name: 'market_reference_asset_context/source=coinmarketcap_reference_asset/interval=1h',
  });
  await cleanupRows({
    tableName: 'market_cmc_breadth_context',
    whereSql: "source = 'coinmarketcap_market_breadth'",
    name: 'market_cmc_breadth_context/source=coinmarketcap_market_breadth',
  });
  await cleanupRows({
    tableName: 'market_context_backfill_coverage',
    whereSql:
      "(source IN ('coinmarketcap_global_hourly', 'coinmarketcap_market_breadth') OR (source = 'coinmarketcap_reference_asset' AND interval = '1h'))",
    name: 'market_context_backfill_coverage/deprecated_cmc_sources',
  });

  return items;
}

export async function getMarketBreadthCoverage(params: {
  universe: string;
  interval: MarketFeatureInterval;
  startMs: number;
  endMs: number;
}): Promise<{
  firstMs: number;
  lastMs: number;
  rows: number;
  btcAltMetricsRows: number;
} | null> {
  await ensureBinanceMarketSchema();
  const pool = getPool();
  const res = await pool.query(
    `
      SELECT
        MIN(ts) AS first_ts,
        MAX(ts) AS last_ts,
        COUNT(*)::int AS rows,
        COUNT(*) FILTER (
          WHERE btc_alt_regime IS NOT NULL
            AND btc_return_24h IS NOT NULL
            AND alt_basket_return_24h IS NOT NULL
        )::int AS btc_alt_metrics_rows
      FROM market_breadth
      WHERE universe = $1
        AND interval = $2
        AND ts >= to_timestamp($3/1000.0)
        AND ts <= to_timestamp($4/1000.0)
    `,
    [params.universe, params.interval, params.startMs, params.endMs],
  );
  const row = res.rows[0];
  if (!row?.first_ts || !row?.last_ts) return null;
  return {
    firstMs: new Date(row.first_ts).getTime(),
    lastMs: new Date(row.last_ts).getTime(),
    rows: Number(row.rows) || 0,
    btcAltMetricsRows: Number(row.btc_alt_metrics_rows) || 0,
  };
}
