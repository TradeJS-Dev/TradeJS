import type {
  MarketCmcExchangeLiquidityContextRow,
  MarketCmcFearGreedContextRow,
  MarketCmcIndexContextRow,
  MarketBreadthRow,
  MarketGlobalContextRow,
  MarketReferenceAssetContextRow,
  MarketTradeFlowRow,
} from '@tradejs/types';
import {
  getPool,
  getSafeBulkInsertRows,
  ensureBinanceMarketSchema,
} from '../internal';

export async function upsertMarketTradeFlowRows(rows: MarketTradeFlowRow[]) {
  if (!rows.length) return;
  await ensureBinanceMarketSchema();

  const pool = getPool();
  const cols = [
    'symbol',
    'interval',
    'ts',
    'trades',
    'buy_base_volume',
    'sell_base_volume',
    'buy_quote_volume',
    'sell_quote_volume',
    'net_base_delta',
    'net_quote_delta',
    'buy_pressure_pct',
    'source',
  ] as const;

  const maxRows = getSafeBulkInsertRows(cols.length);
  if (rows.length > maxRows) {
    for (let i = 0; i < rows.length; i += maxRows) {
      await upsertMarketTradeFlowRows(rows.slice(i, i + maxRows));
    }
    return;
  }

  const valuesSql = rows
    .map(
      (_, i) =>
        `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(',')})`,
    )
    .join(',');
  const flat = rows.flatMap((row) => [
    row.symbol,
    row.interval,
    row.ts,
    row.trades,
    row.buyBaseVolume ?? null,
    row.sellBaseVolume ?? null,
    row.buyQuoteVolume ?? null,
    row.sellQuoteVolume ?? null,
    row.netBaseDelta ?? null,
    row.netQuoteDelta ?? null,
    row.buyPressurePct ?? null,
    row.source ?? null,
  ]);

  await pool.query(
    `
      INSERT INTO market_trade_flow (${cols.join(',')})
      VALUES ${valuesSql}
      ON CONFLICT (symbol, interval, ts) DO UPDATE SET
        trades = EXCLUDED.trades,
        buy_base_volume = COALESCE(EXCLUDED.buy_base_volume, market_trade_flow.buy_base_volume),
        sell_base_volume = COALESCE(EXCLUDED.sell_base_volume, market_trade_flow.sell_base_volume),
        buy_quote_volume = COALESCE(EXCLUDED.buy_quote_volume, market_trade_flow.buy_quote_volume),
        sell_quote_volume = COALESCE(EXCLUDED.sell_quote_volume, market_trade_flow.sell_quote_volume),
        net_base_delta = COALESCE(EXCLUDED.net_base_delta, market_trade_flow.net_base_delta),
        net_quote_delta = COALESCE(EXCLUDED.net_quote_delta, market_trade_flow.net_quote_delta),
        buy_pressure_pct = COALESCE(EXCLUDED.buy_pressure_pct, market_trade_flow.buy_pressure_pct),
        source = COALESCE(EXCLUDED.source, market_trade_flow.source),
        ingested_at = now()
    `,
    flat,
  );
}

export async function upsertMarketBreadthRows(rows: MarketBreadthRow[]) {
  if (!rows.length) return;
  await ensureBinanceMarketSchema();

  const pool = getPool();
  const cols = [
    'universe',
    'interval',
    'ts',
    'symbols_count',
    'advancers',
    'decliners',
    'unchanged',
    'advance_decline_ratio',
    'pct_above_ma20',
    'pct_above_ma50',
    'equal_weighted_return',
    'volume_weighted_return',
    'dispersion',
    'btc_return_1h',
    'btc_return_4h',
    'btc_return_24h',
    'alt_basket_return_1h',
    'alt_basket_return_4h',
    'alt_basket_return_24h',
    'btc_vs_alt_return_1h',
    'btc_vs_alt_return_4h',
    'btc_vs_alt_return_24h',
    'btc_turnover_share_1h',
    'btc_turnover_share_24h',
    'btc_turnover_share_change_24h',
    'alt_vol_to_btc_vol_24h',
    'alt_dispersion_24h',
    'btc_alt_regime',
    'source',
  ] as const;

  const maxRows = getSafeBulkInsertRows(cols.length);
  if (rows.length > maxRows) {
    for (let i = 0; i < rows.length; i += maxRows) {
      await upsertMarketBreadthRows(rows.slice(i, i + maxRows));
    }
    return;
  }

  const valuesSql = rows
    .map(
      (_, i) =>
        `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(',')})`,
    )
    .join(',');
  const flat = rows.flatMap((row) => [
    row.universe,
    row.interval,
    row.ts,
    row.symbolsCount,
    row.advancers,
    row.decliners,
    row.unchanged,
    row.advanceDeclineRatio ?? null,
    row.pctAboveMa20 ?? null,
    row.pctAboveMa50 ?? null,
    row.equalWeightedReturn ?? null,
    row.volumeWeightedReturn ?? null,
    row.dispersion ?? null,
    row.btcReturn1h ?? null,
    row.btcReturn4h ?? null,
    row.btcReturn24h ?? null,
    row.altBasketReturn1h ?? null,
    row.altBasketReturn4h ?? null,
    row.altBasketReturn24h ?? null,
    row.btcVsAltReturn1h ?? null,
    row.btcVsAltReturn4h ?? null,
    row.btcVsAltReturn24h ?? null,
    row.btcTurnoverShare1h ?? null,
    row.btcTurnoverShare24h ?? null,
    row.btcTurnoverShareChange24h ?? null,
    row.altVolToBtcVol24h ?? null,
    row.altDispersion24h ?? null,
    row.btcAltRegime ?? null,
    row.source ?? null,
  ]);

  await pool.query(
    `
      INSERT INTO market_breadth (${cols.join(',')})
      VALUES ${valuesSql}
      ON CONFLICT (universe, interval, ts) DO UPDATE SET
        symbols_count = EXCLUDED.symbols_count,
        advancers = EXCLUDED.advancers,
        decliners = EXCLUDED.decliners,
        unchanged = EXCLUDED.unchanged,
        advance_decline_ratio = COALESCE(EXCLUDED.advance_decline_ratio, market_breadth.advance_decline_ratio),
        pct_above_ma20 = COALESCE(EXCLUDED.pct_above_ma20, market_breadth.pct_above_ma20),
        pct_above_ma50 = COALESCE(EXCLUDED.pct_above_ma50, market_breadth.pct_above_ma50),
        equal_weighted_return = COALESCE(EXCLUDED.equal_weighted_return, market_breadth.equal_weighted_return),
        volume_weighted_return = COALESCE(EXCLUDED.volume_weighted_return, market_breadth.volume_weighted_return),
        dispersion = COALESCE(EXCLUDED.dispersion, market_breadth.dispersion),
        btc_return_1h = COALESCE(EXCLUDED.btc_return_1h, market_breadth.btc_return_1h),
        btc_return_4h = COALESCE(EXCLUDED.btc_return_4h, market_breadth.btc_return_4h),
        btc_return_24h = COALESCE(EXCLUDED.btc_return_24h, market_breadth.btc_return_24h),
        alt_basket_return_1h = COALESCE(EXCLUDED.alt_basket_return_1h, market_breadth.alt_basket_return_1h),
        alt_basket_return_4h = COALESCE(EXCLUDED.alt_basket_return_4h, market_breadth.alt_basket_return_4h),
        alt_basket_return_24h = COALESCE(EXCLUDED.alt_basket_return_24h, market_breadth.alt_basket_return_24h),
        btc_vs_alt_return_1h = COALESCE(EXCLUDED.btc_vs_alt_return_1h, market_breadth.btc_vs_alt_return_1h),
        btc_vs_alt_return_4h = COALESCE(EXCLUDED.btc_vs_alt_return_4h, market_breadth.btc_vs_alt_return_4h),
        btc_vs_alt_return_24h = COALESCE(EXCLUDED.btc_vs_alt_return_24h, market_breadth.btc_vs_alt_return_24h),
        btc_turnover_share_1h = COALESCE(EXCLUDED.btc_turnover_share_1h, market_breadth.btc_turnover_share_1h),
        btc_turnover_share_24h = COALESCE(EXCLUDED.btc_turnover_share_24h, market_breadth.btc_turnover_share_24h),
        btc_turnover_share_change_24h = COALESCE(EXCLUDED.btc_turnover_share_change_24h, market_breadth.btc_turnover_share_change_24h),
        alt_vol_to_btc_vol_24h = COALESCE(EXCLUDED.alt_vol_to_btc_vol_24h, market_breadth.alt_vol_to_btc_vol_24h),
        alt_dispersion_24h = COALESCE(EXCLUDED.alt_dispersion_24h, market_breadth.alt_dispersion_24h),
        btc_alt_regime = COALESCE(EXCLUDED.btc_alt_regime, market_breadth.btc_alt_regime),
        source = COALESCE(EXCLUDED.source, market_breadth.source),
        ingested_at = now()
    `,
    flat,
  );
}

export async function upsertMarketGlobalContextRows(
  rows: MarketGlobalContextRow[],
) {
  if (!rows.length) return;
  await ensureBinanceMarketSchema();

  const pool = getPool();
  const cols = [
    'source',
    'ts',
    'updated_at_ts',
    'active_cryptocurrencies',
    'active_exchanges',
    'active_market_pairs',
    'markets',
    'total_market_cap_usd',
    'total_volume_usd',
    'total_volume_reported_usd',
    'btc_dominance_pct',
    'eth_dominance_pct',
    'alt_market_cap_usd',
    'alt_volume_usd',
    'alt_volume_reported_usd',
    'btc_to_alt_market_cap_ratio',
    'market_cap_change_pct_24h_usd',
  ] as const;

  const maxRows = getSafeBulkInsertRows(cols.length);
  if (rows.length > maxRows) {
    for (let i = 0; i < rows.length; i += maxRows) {
      await upsertMarketGlobalContextRows(rows.slice(i, i + maxRows));
    }
    return;
  }

  const valuesSql = rows
    .map(
      (_, i) =>
        `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(',')})`,
    )
    .join(',');
  const flat = rows.flatMap((row) => [
    row.source,
    row.ts,
    row.updatedAt ?? null,
    row.activeCryptocurrencies ?? null,
    row.activeExchanges ?? null,
    row.activeMarketPairs ?? null,
    row.markets ?? null,
    row.totalMarketCapUsd ?? null,
    row.totalVolumeUsd ?? null,
    row.totalVolumeReportedUsd ?? null,
    row.btcDominancePct ?? null,
    row.ethDominancePct ?? null,
    row.altMarketCapUsd ?? null,
    row.altVolumeUsd ?? null,
    row.altVolumeReportedUsd ?? null,
    row.btcToAltMarketCapRatio ?? null,
    row.marketCapChangePct24hUsd ?? null,
  ]);

  await pool.query(
    `
      INSERT INTO market_global_context (${cols.join(',')})
      VALUES ${valuesSql}
      ON CONFLICT (source, ts) DO UPDATE SET
        updated_at_ts = COALESCE(EXCLUDED.updated_at_ts, market_global_context.updated_at_ts),
        active_cryptocurrencies = COALESCE(EXCLUDED.active_cryptocurrencies, market_global_context.active_cryptocurrencies),
        active_exchanges = COALESCE(EXCLUDED.active_exchanges, market_global_context.active_exchanges),
        active_market_pairs = COALESCE(EXCLUDED.active_market_pairs, market_global_context.active_market_pairs),
        markets = COALESCE(EXCLUDED.markets, market_global_context.markets),
        total_market_cap_usd = COALESCE(EXCLUDED.total_market_cap_usd, market_global_context.total_market_cap_usd),
        total_volume_usd = COALESCE(EXCLUDED.total_volume_usd, market_global_context.total_volume_usd),
        total_volume_reported_usd = COALESCE(EXCLUDED.total_volume_reported_usd, market_global_context.total_volume_reported_usd),
        btc_dominance_pct = COALESCE(EXCLUDED.btc_dominance_pct, market_global_context.btc_dominance_pct),
        eth_dominance_pct = COALESCE(EXCLUDED.eth_dominance_pct, market_global_context.eth_dominance_pct),
        alt_market_cap_usd = COALESCE(EXCLUDED.alt_market_cap_usd, market_global_context.alt_market_cap_usd),
        alt_volume_usd = COALESCE(EXCLUDED.alt_volume_usd, market_global_context.alt_volume_usd),
        alt_volume_reported_usd = COALESCE(EXCLUDED.alt_volume_reported_usd, market_global_context.alt_volume_reported_usd),
        btc_to_alt_market_cap_ratio = COALESCE(EXCLUDED.btc_to_alt_market_cap_ratio, market_global_context.btc_to_alt_market_cap_ratio),
        market_cap_change_pct_24h_usd = COALESCE(EXCLUDED.market_cap_change_pct_24h_usd, market_global_context.market_cap_change_pct_24h_usd),
        ingested_at = now()
    `,
    flat,
  );
}

export async function upsertMarketReferenceAssetContextRows(
  rows: MarketReferenceAssetContextRow[],
) {
  if (!rows.length) return;
  await ensureBinanceMarketSchema();

  const pool = getPool();
  const cols = [
    'source',
    'symbol',
    'cmc_id',
    'interval',
    'ts',
    'open_usd',
    'high_usd',
    'low_usd',
    'close_usd',
    'volume_usd',
    'market_cap_usd',
  ] as const;

  const maxRows = getSafeBulkInsertRows(cols.length);
  if (rows.length > maxRows) {
    for (let i = 0; i < rows.length; i += maxRows) {
      await upsertMarketReferenceAssetContextRows(rows.slice(i, i + maxRows));
    }
    return;
  }

  const valuesSql = rows
    .map(
      (_, i) =>
        `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(',')})`,
    )
    .join(',');
  const flat = rows.flatMap((row) => [
    row.source,
    row.symbol.trim().toUpperCase(),
    Math.trunc(row.cmcId),
    row.interval,
    row.ts,
    row.openUsd ?? null,
    row.highUsd ?? null,
    row.lowUsd ?? null,
    row.closeUsd ?? null,
    row.volumeUsd ?? null,
    row.marketCapUsd ?? null,
  ]);

  await pool.query(
    `
      INSERT INTO market_reference_asset_context (${cols.join(',')})
      VALUES ${valuesSql}
      ON CONFLICT (source, symbol, interval, ts) DO UPDATE SET
        cmc_id = EXCLUDED.cmc_id,
        open_usd = COALESCE(EXCLUDED.open_usd, market_reference_asset_context.open_usd),
        high_usd = COALESCE(EXCLUDED.high_usd, market_reference_asset_context.high_usd),
        low_usd = COALESCE(EXCLUDED.low_usd, market_reference_asset_context.low_usd),
        close_usd = COALESCE(EXCLUDED.close_usd, market_reference_asset_context.close_usd),
        volume_usd = COALESCE(EXCLUDED.volume_usd, market_reference_asset_context.volume_usd),
        market_cap_usd = COALESCE(EXCLUDED.market_cap_usd, market_reference_asset_context.market_cap_usd),
        ingested_at = now()
    `,
    flat,
  );
}

export async function upsertMarketCmcExchangeLiquidityContextRows(
  rows: MarketCmcExchangeLiquidityContextRow[],
) {
  if (!rows.length) return;
  await ensureBinanceMarketSchema();

  const pool = getPool();
  const cols = [
    'source',
    'interval',
    'ts',
    'exchanges_count',
    'total_volume_usd',
    'binance_volume_usd',
    'binance_volume_share',
    'top_exchange_volume_share',
    'liquidity_regime',
  ] as const;

  const maxRows = getSafeBulkInsertRows(cols.length);
  if (rows.length > maxRows) {
    for (let i = 0; i < rows.length; i += maxRows) {
      await upsertMarketCmcExchangeLiquidityContextRows(
        rows.slice(i, i + maxRows),
      );
    }
    return;
  }

  const valuesSql = rows
    .map(
      (_, i) =>
        `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(',')})`,
    )
    .join(',');
  const flat = rows.flatMap((row) => [
    row.source,
    row.interval,
    row.ts,
    Math.trunc(row.exchangesCount),
    row.totalVolumeUsd ?? null,
    row.binanceVolumeUsd ?? null,
    row.binanceVolumeShare ?? null,
    row.topExchangeVolumeShare ?? null,
    row.liquidityRegime ?? null,
  ]);

  await pool.query(
    `
      INSERT INTO market_cmc_exchange_liquidity_context (${cols.join(',')})
      VALUES ${valuesSql}
      ON CONFLICT (source, interval, ts) DO UPDATE SET
        exchanges_count = EXCLUDED.exchanges_count,
        total_volume_usd = COALESCE(EXCLUDED.total_volume_usd, market_cmc_exchange_liquidity_context.total_volume_usd),
        binance_volume_usd = COALESCE(EXCLUDED.binance_volume_usd, market_cmc_exchange_liquidity_context.binance_volume_usd),
        binance_volume_share = COALESCE(EXCLUDED.binance_volume_share, market_cmc_exchange_liquidity_context.binance_volume_share),
        top_exchange_volume_share = COALESCE(EXCLUDED.top_exchange_volume_share, market_cmc_exchange_liquidity_context.top_exchange_volume_share),
        liquidity_regime = COALESCE(EXCLUDED.liquidity_regime, market_cmc_exchange_liquidity_context.liquidity_regime),
        ingested_at = now()
    `,
    flat,
  );
}

export async function upsertMarketCmcFearGreedContextRows(
  rows: MarketCmcFearGreedContextRow[],
) {
  if (!rows.length) return;
  await ensureBinanceMarketSchema();

  const pool = getPool();
  const cols = [
    'source',
    'interval',
    'ts',
    'value',
    'classification',
    'sentiment_regime',
  ] as const;

  const maxRows = getSafeBulkInsertRows(cols.length);
  if (rows.length > maxRows) {
    for (let i = 0; i < rows.length; i += maxRows) {
      await upsertMarketCmcFearGreedContextRows(rows.slice(i, i + maxRows));
    }
    return;
  }

  const valuesSql = rows
    .map(
      (_, i) =>
        `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(',')})`,
    )
    .join(',');
  const flat = rows.flatMap((row) => [
    row.source,
    row.interval,
    row.ts,
    Math.trunc(row.value),
    row.classification,
    row.sentimentRegime,
  ]);

  await pool.query(
    `
      INSERT INTO market_cmc_fear_greed_context (${cols.join(',')})
      VALUES ${valuesSql}
      ON CONFLICT (source, interval, ts) DO UPDATE SET
        value = EXCLUDED.value,
        classification = EXCLUDED.classification,
        sentiment_regime = EXCLUDED.sentiment_regime,
        ingested_at = now()
    `,
    flat,
  );
}

export async function upsertMarketCmcIndexContextRows(
  rows: MarketCmcIndexContextRow[],
) {
  if (!rows.length) return;
  await ensureBinanceMarketSchema();

  const pool = getPool();
  const cols = [
    'source',
    'index_slug',
    'interval',
    'ts',
    'value',
    'constituents_count',
    'top_constituent_symbol',
    'top_constituent_weight_pct',
    'constituents',
  ] as const;

  const maxRows = getSafeBulkInsertRows(cols.length);
  if (rows.length > maxRows) {
    for (let i = 0; i < rows.length; i += maxRows) {
      await upsertMarketCmcIndexContextRows(rows.slice(i, i + maxRows));
    }
    return;
  }

  const valuesSql = rows
    .map(
      (_, i) =>
        `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(',')})`,
    )
    .join(',');
  const flat = rows.flatMap((row) => [
    row.source,
    row.indexSlug,
    row.interval,
    row.ts,
    row.value,
    row.constituentsCount ?? null,
    row.topConstituentSymbol ?? null,
    row.topConstituentWeightPct ?? null,
    row.constituents ? JSON.stringify(row.constituents) : null,
  ]);

  await pool.query(
    `
      INSERT INTO market_cmc_index_context (${cols.join(',')})
      VALUES ${valuesSql}
      ON CONFLICT (source, index_slug, interval, ts) DO UPDATE SET
        value = EXCLUDED.value,
        constituents_count = COALESCE(EXCLUDED.constituents_count, market_cmc_index_context.constituents_count),
        top_constituent_symbol = COALESCE(EXCLUDED.top_constituent_symbol, market_cmc_index_context.top_constituent_symbol),
        top_constituent_weight_pct = COALESCE(EXCLUDED.top_constituent_weight_pct, market_cmc_index_context.top_constituent_weight_pct),
        constituents = COALESCE(EXCLUDED.constituents, market_cmc_index_context.constituents),
        ingested_at = now()
    `,
    flat,
  );
}

export async function upsertMarketContextBackfillCoverage(
  rows: Array<{
    source: string;
    scope: string;
    interval: string;
    fromMs: number;
    toMs: number;
    rowsCount: number;
  }>,
) {
  const normalizedRows = rows
    .map((row) => ({
      source: String(row.source || '')
        .trim()
        .toLowerCase(),
      scope: String(row.scope || '')
        .trim()
        .toLowerCase(),
      interval: String(row.interval || '')
        .trim()
        .toLowerCase(),
      fromMs: Math.trunc(row.fromMs),
      toMs: Math.trunc(row.toMs),
      rowsCount: Math.max(0, Math.trunc(row.rowsCount)),
    }))
    .filter(
      (row) =>
        row.source &&
        row.scope &&
        row.interval &&
        Number.isFinite(row.fromMs) &&
        Number.isFinite(row.toMs) &&
        row.toMs >= row.fromMs,
    );
  if (!normalizedRows.length) return;

  await ensureBinanceMarketSchema();
  const pool = getPool();
  const cols = [
    'source',
    'scope',
    'interval',
    'from_ts',
    'to_ts',
    'rows_count',
  ] as const;
  const valuesSql = normalizedRows
    .map(
      (_, i) =>
        `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(',')})`,
    )
    .join(',');
  const flat = normalizedRows.flatMap((row) => [
    row.source,
    row.scope,
    row.interval,
    new Date(row.fromMs),
    new Date(row.toMs),
    row.rowsCount,
  ]);

  await pool.query(
    `
      INSERT INTO market_context_backfill_coverage (${cols.join(',')})
      VALUES ${valuesSql}
      ON CONFLICT (source, scope, interval, from_ts, to_ts) DO UPDATE SET
        rows_count = EXCLUDED.rows_count,
        checked_at = now()
    `,
    flat,
  );
}
