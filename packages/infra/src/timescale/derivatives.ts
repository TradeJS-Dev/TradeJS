import type { DerivativesInterval, DerivativesRow } from '@tradejs/types';
import {
  getPool,
  queryMarketContext,
  normalizeCandleSymbol,
  ensureDerivativesSchema,
  prepareMarketContextSchemaForRead,
} from './internal';

export async function upsertDerivatives(rows: DerivativesRow[]) {
  if (!rows.length) return;
  await ensureDerivativesSchema();

  const pool = getPool();
  const cols = [
    'symbol',
    'interval',
    'ts',
    'open_interest',
    'funding_rate',
    'liq_long',
    'liq_short',
    'liq_total',
    'source',
  ] as const;

  const maxRows = Math.floor(65_535 / cols.length);
  if (rows.length > maxRows) {
    for (let i = 0; i < rows.length; i += maxRows) {
      await upsertDerivatives(rows.slice(i, i + maxRows));
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
    row.openInterest ?? null,
    row.fundingRate ?? null,
    row.liqLong ?? null,
    row.liqShort ?? null,
    row.liqTotal ?? null,
    row.source ?? null,
  ]);

  const sql = `
    INSERT INTO derivatives_market (${cols.join(',')})
    VALUES ${valuesSql}
    ON CONFLICT (symbol, interval, ts) DO UPDATE SET
      open_interest = COALESCE(EXCLUDED.open_interest, derivatives_market.open_interest),
      funding_rate = COALESCE(EXCLUDED.funding_rate, derivatives_market.funding_rate),
      liq_long = COALESCE(EXCLUDED.liq_long, derivatives_market.liq_long),
      liq_short = COALESCE(EXCLUDED.liq_short, derivatives_market.liq_short),
      liq_total = COALESCE(EXCLUDED.liq_total, derivatives_market.liq_total),
      source = COALESCE(EXCLUDED.source, derivatives_market.source),
      ingested_at = now()
  `;

  await pool.query(sql, flat);
}

export async function getDerivativesRangeForSymbols(
  symbols: string[],
  interval: DerivativesInterval,
  startMs: number,
  endMs: number,
) {
  if (!symbols.length)
    return [] as Array<{
      symbol: string;
      interval: DerivativesInterval;
      ts: Date;
      open_interest: number | null;
      funding_rate: number | null;
      liq_long: number | null;
      liq_short: number | null;
      liq_total: number | null;
    }>;
  await ensureDerivativesSchema();
  const pool = getPool();
  const sql = `
    SELECT symbol, interval, ts, open_interest, funding_rate, liq_long, liq_short, liq_total
    FROM derivatives_market
    WHERE symbol = ANY($1)
      AND interval = $2
      AND ts >= to_timestamp($3/1000.0)
      AND ts <= to_timestamp($4/1000.0)
    ORDER BY symbol ASC, ts ASC
  `;
  const res = await pool.query(sql, [symbols, interval, startMs, endMs]);
  return res.rows;
}

export async function getDerivativesDataEdgesForSymbols(
  symbols: string[],
  interval: DerivativesInterval,
) {
  const normalizedSymbols = [
    ...new Set(
      symbols
        .map((symbol) =>
          String(symbol || '')
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean),
    ),
  ];
  const edges = new Map<string, { min?: number; max?: number }>();
  if (!normalizedSymbols.length) return edges;

  await ensureDerivativesSchema();
  const pool = getPool();
  const sql = `
    SELECT
      symbol,
      extract(epoch from MIN(ts))*1000 AS min,
      extract(epoch from MAX(ts))*1000 AS max
    FROM derivatives_market
    WHERE symbol = ANY($1)
      AND interval = $2
    GROUP BY symbol
  `;
  const res = await pool.query(sql, [normalizedSymbols, interval]);

  for (const row of res.rows as Array<{
    symbol: string;
    min?: number | string | null;
    max?: number | string | null;
  }>) {
    const min = Number(row.min);
    const max = Number(row.max);
    edges.set(String(row.symbol).toUpperCase(), {
      min: Number.isFinite(min) ? min : undefined,
      max: Number.isFinite(max) ? max : undefined,
    });
  }

  return edges;
}

export async function getDerivativesBackfillCoverage(params: {
  source: string;
  symbols: string[];
  interval: DerivativesInterval;
  fromMs: number;
  toMs: number;
}) {
  const normalizedSource = String(params.source || '')
    .trim()
    .toLowerCase();
  const normalizedSymbols = [
    ...new Set(
      params.symbols
        .map((symbol) =>
          String(symbol || '')
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean),
    ),
  ];
  if (!normalizedSource || !normalizedSymbols.length) {
    return [] as Array<{
      symbol: string;
      interval: DerivativesInterval;
      fromMs: number;
      toMs: number;
      rowsCount: number;
    }>;
  }

  await ensureDerivativesSchema();
  const pool = getPool();
  const res = await pool.query(
    `
      SELECT
        symbol,
        interval,
        extract(epoch from from_ts)*1000 AS from_ms,
        extract(epoch from to_ts)*1000 AS to_ms,
        rows_count
      FROM derivatives_backfill_coverage
      WHERE source = $1
        AND symbol = ANY($2)
        AND interval = $3
        AND from_ts <= to_timestamp($5/1000.0)
        AND to_ts >= to_timestamp($4/1000.0)
    `,
    [
      normalizedSource,
      normalizedSymbols,
      params.interval,
      params.fromMs,
      params.toMs,
    ],
  );

  return (
    res.rows as Array<{
      symbol: string;
      interval: DerivativesInterval;
      from_ms: number | string;
      to_ms: number | string;
      rows_count: number | string;
    }>
  ).map((row) => ({
    symbol: String(row.symbol).toUpperCase(),
    interval: row.interval,
    fromMs: Number(row.from_ms),
    toMs: Number(row.to_ms),
    rowsCount: Number(row.rows_count ?? 0),
  }));
}

export async function upsertDerivativesBackfillCoverage(
  rows: Array<{
    source: string;
    symbol: string;
    interval: DerivativesInterval;
    fromMs: number;
    toMs: number;
    rowsCount: number;
  }>,
) {
  if (!rows.length) return;

  await ensureDerivativesSchema();
  const pool = getPool();
  const cols = [
    'source',
    'symbol',
    'interval',
    'from_ts',
    'to_ts',
    'rows_count',
  ] as const;
  const valuesSql = rows
    .map(
      (_, i) =>
        `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(',')})`,
    )
    .join(',');
  const flat = rows.flatMap((row) => [
    String(row.source || '')
      .trim()
      .toLowerCase(),
    String(row.symbol || '')
      .trim()
      .toUpperCase(),
    row.interval,
    new Date(row.fromMs),
    new Date(row.toMs),
    Math.max(0, Math.trunc(row.rowsCount)),
  ]);

  await pool.query(
    `
      INSERT INTO derivatives_backfill_coverage (${cols.join(',')})
      VALUES ${valuesSql}
      ON CONFLICT (source, symbol, interval, from_ts, to_ts) DO UPDATE SET
        rows_count = EXCLUDED.rows_count,
        checked_at = now()
    `,
    flat,
  );
}

export type DerivativesMetricCoverageMetric = 'liquidation';

export async function getDerivativesMetricCoverage(params: {
  source: string;
  metric: DerivativesMetricCoverageMetric;
  symbols: string[];
  interval: DerivativesInterval;
  fromMs: number;
  toMs: number;
}) {
  const normalizedSource = String(params.source || '')
    .trim()
    .toLowerCase();
  const normalizedSymbols = [
    ...new Set(
      params.symbols
        .map((symbol) =>
          String(symbol || '')
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean),
    ),
  ];
  if (!normalizedSource || !normalizedSymbols.length) {
    return [] as Array<{
      symbol: string;
      interval: DerivativesInterval;
      fromMs: number;
      toMs: number;
      eventRowsCount: number;
      zeroRowsCount: number;
    }>;
  }

  await ensureDerivativesSchema();
  const pool = getPool();
  const res = await pool.query(
    `
      SELECT
        symbol,
        interval,
        extract(epoch from from_ts)*1000 AS from_ms,
        extract(epoch from to_ts)*1000 AS to_ms,
        event_rows_count,
        zero_rows_count
      FROM derivatives_metric_coverage
      WHERE source = $1
        AND metric = $2
        AND symbol = ANY($3)
        AND interval = $4
        AND from_ts <= to_timestamp($6/1000.0)
        AND to_ts >= to_timestamp($5/1000.0)
    `,
    [
      normalizedSource,
      params.metric,
      normalizedSymbols,
      params.interval,
      params.fromMs,
      params.toMs,
    ],
  );

  return (
    res.rows as Array<{
      symbol: string;
      interval: DerivativesInterval;
      from_ms: number | string;
      to_ms: number | string;
      event_rows_count: number | string;
      zero_rows_count: number | string;
    }>
  ).map((row) => ({
    symbol: String(row.symbol).toUpperCase(),
    interval: row.interval,
    fromMs: Number(row.from_ms),
    toMs: Number(row.to_ms),
    eventRowsCount: Number(row.event_rows_count ?? 0),
    zeroRowsCount: Number(row.zero_rows_count ?? 0),
  }));
}

export async function applyDerivativesMetricCoverage(
  rows: Array<{
    source: string;
    metric: DerivativesMetricCoverageMetric;
    symbol: string;
    interval: DerivativesInterval;
    fromMs: number;
    toMs: number;
    eventRowsCount: number;
  }>,
) {
  if (!rows.length)
    return [] as Array<{ symbol: string; zeroRowsCount: number }>;

  await ensureDerivativesSchema();
  const pool = getPool();
  const client = await pool.connect();
  const results: Array<{ symbol: string; zeroRowsCount: number }> = [];

  try {
    await client.query('BEGIN');
    for (const row of rows) {
      const source = String(row.source || '')
        .trim()
        .toLowerCase();
      const symbol = String(row.symbol || '')
        .trim()
        .toUpperCase();
      const fromMs = Math.trunc(row.fromMs);
      const toMs = Math.trunc(row.toMs);
      if (!source || !symbol || fromMs > toMs) continue;

      await client.query(
        `
          UPDATE derivatives_market
          SET
            liq_long = 0,
            liq_short = 0,
            liq_total = 0,
            ingested_at = now()
          WHERE symbol = $1
            AND interval = $2
            AND ts >= to_timestamp($3/1000.0)
            AND ts <= to_timestamp($4/1000.0)
            AND liq_long IS NULL
            AND liq_short IS NULL
            AND liq_total IS NULL
        `,
        [symbol, row.interval, fromMs, toMs],
      );
      const zeroCountResult = await client.query(
        `
          SELECT COUNT(*)::integer AS count
          FROM derivatives_market
          WHERE symbol = $1
            AND interval = $2
            AND ts >= to_timestamp($3/1000.0)
            AND ts <= to_timestamp($4/1000.0)
            AND liq_long = 0
            AND liq_short = 0
            AND liq_total = 0
        `,
        [symbol, row.interval, fromMs, toMs],
      );
      const zeroRowsCount = Math.max(
        0,
        Number(zeroCountResult.rows[0]?.count ?? 0),
      );

      await client.query(
        `
          INSERT INTO derivatives_metric_coverage (
            source,
            metric,
            symbol,
            interval,
            from_ts,
            to_ts,
            event_rows_count,
            zero_rows_count
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (source, metric, symbol, interval, from_ts, to_ts)
          DO UPDATE SET
            event_rows_count = EXCLUDED.event_rows_count,
            zero_rows_count = EXCLUDED.zero_rows_count,
            checked_at = now()
        `,
        [
          source,
          row.metric,
          symbol,
          row.interval,
          new Date(fromMs),
          new Date(toMs),
          Math.max(0, Math.trunc(row.eventRowsCount)),
          zeroRowsCount,
        ],
      );
      results.push({ symbol, zeroRowsCount });
    }
    await client.query('COMMIT');
    return results;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getDerivativesWindow(params: {
  symbol: string;
  intervals: DerivativesInterval[];
  endMs: number;
  lookbackMs: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<Partial<Record<DerivativesInterval, DerivativesRow[]>>> {
  const { symbol, intervals, endMs, lookbackMs } = params;
  const normalizedSymbol = String(symbol || '')
    .trim()
    .toUpperCase();
  const normalizedIntervals = [...new Set(intervals)].filter(Boolean);

  if (!normalizedSymbol || !normalizedIntervals.length) {
    return {};
  }

  await prepareMarketContextSchemaForRead('derivatives');
  const startMs = endMs - Math.max(0, lookbackMs);
  const sql = `
    SELECT symbol, interval, ts, open_interest, funding_rate, liq_long, liq_short, liq_total, source
    FROM derivatives_market
    WHERE symbol = $1
      AND interval = ANY($2)
      AND ts >= to_timestamp($3/1000.0)
      AND ts <= to_timestamp($4/1000.0)
    ORDER BY interval ASC, ts ASC
  `;
  const res = await queryMarketContext(
    sql,
    [normalizedSymbol, normalizedIntervals, startMs, endMs],
    params,
  );
  const rowsByInterval: Partial<Record<DerivativesInterval, DerivativesRow[]>> =
    {};

  for (const row of res.rows as Array<{
    symbol: string;
    interval: DerivativesInterval;
    ts: Date;
    open_interest: number | null;
    funding_rate: number | null;
    liq_long: number | null;
    liq_short: number | null;
    liq_total: number | null;
    source: string | null;
  }>) {
    const interval = row.interval;
    rowsByInterval[interval] ??= [];
    rowsByInterval[interval]?.push({
      symbol: row.symbol,
      interval,
      ts: row.ts,
      openInterest: row.open_interest,
      fundingRate: row.funding_rate,
      liqLong: row.liq_long,
      liqShort: row.liq_short,
      liqTotal: row.liq_total,
      source: row.source,
    });
  }

  return rowsByInterval;
}

export async function getDerivativesSummary(
  hours = 24,
  limit = 500,
  symbols?: string[],
) {
  await ensureDerivativesSchema();
  const pool = getPool();
  const cappedHours = Math.max(1, Math.min(24 * 90, hours));
  const cappedLimit = Math.max(10, Math.min(1000, limit));
  const normalizedSymbols = Array.isArray(symbols)
    ? [...new Set(symbols.map(normalizeCandleSymbol).filter(Boolean))]
    : [];
  const symbolsFilterSql = normalizedSymbols.length
    ? 'AND symbol = ANY($3)'
    : '';

  const summaryQ = await pool.query(
    `
      WITH filtered AS (
        SELECT
          symbol,
          interval,
          ts,
          open_interest,
          funding_rate,
          liq_long,
          liq_short,
          liq_total
        FROM derivatives_market
        WHERE ts >= now() - ($1 || ' hours')::interval
          ${symbolsFilterSql}
      ),
      latest AS (
        SELECT DISTINCT ON (symbol, interval)
          symbol,
          interval,
          ts AS last_ts,
          open_interest AS latest_open_interest,
          funding_rate AS latest_funding_rate
        FROM filtered
        ORDER BY symbol ASC, interval ASC, ts DESC
      ),
      first AS (
        SELECT DISTINCT ON (symbol, interval)
          symbol,
          interval,
          ts AS first_ts,
          open_interest AS first_open_interest,
          funding_rate AS first_funding_rate
        FROM filtered
        ORDER BY symbol ASC, interval ASC, ts ASC
      ),
      aggregated AS (
        SELECT
          symbol,
          interval,
          COUNT(*)::int AS points,
          SUM(COALESCE(liq_long, 0)) AS sum_liq_long,
          SUM(COALESCE(liq_short, 0)) AS sum_liq_short,
          SUM(COALESCE(liq_total, 0)) AS sum_liq_total
        FROM filtered
        GROUP BY symbol, interval
      )
      SELECT
        aggregated.symbol,
        aggregated.interval,
        aggregated.points,
        latest.last_ts,
        first.first_ts,
        latest.latest_open_interest,
        first.first_open_interest,
        latest.latest_funding_rate,
        first.first_funding_rate,
        aggregated.sum_liq_long,
        aggregated.sum_liq_short,
        aggregated.sum_liq_total
      FROM aggregated
      JOIN latest
        ON latest.symbol = aggregated.symbol
       AND latest.interval = aggregated.interval
      JOIN first
        ON first.symbol = aggregated.symbol
       AND first.interval = aggregated.interval
      ORDER BY aggregated.sum_liq_total DESC, aggregated.symbol ASC
      LIMIT $2
    `,
    normalizedSymbols.length
      ? [String(cappedHours), cappedLimit, normalizedSymbols]
      : [String(cappedHours), cappedLimit],
  );

  const items = (
    summaryQ.rows as Array<{
      symbol: string;
      interval: string;
      points: number | string;
      last_ts: Date | string;
      first_ts: Date | string;
      latest_open_interest: number | string | null;
      first_open_interest: number | string | null;
      latest_funding_rate: number | string | null;
      first_funding_rate: number | string | null;
      sum_liq_long: number | string | null;
      sum_liq_short: number | string | null;
      sum_liq_total: number | string | null;
    }>
  ).map((row) => {
    const latestOpenInterest =
      row.latest_open_interest == null
        ? null
        : Number(row.latest_open_interest);
    const firstOpenInterest =
      row.first_open_interest == null ? null : Number(row.first_open_interest);
    const latestFundingRate =
      row.latest_funding_rate == null ? null : Number(row.latest_funding_rate);
    const firstFundingRate =
      row.first_funding_rate == null ? null : Number(row.first_funding_rate);
    const oiChange =
      latestOpenInterest != null && firstOpenInterest != null
        ? latestOpenInterest - firstOpenInterest
        : null;
    const oiChangePct =
      oiChange != null &&
      firstOpenInterest != null &&
      Number.isFinite(firstOpenInterest) &&
      Math.abs(firstOpenInterest) > 0
        ? (oiChange / Math.abs(firstOpenInterest)) * 100
        : null;
    const fundingChange =
      latestFundingRate != null && firstFundingRate != null
        ? latestFundingRate - firstFundingRate
        : null;

    return {
      symbol: row.symbol,
      interval: row.interval,
      points: Number(row.points || 0),
      last_ts: row.last_ts,
      first_ts: row.first_ts,
      latest_open_interest: latestOpenInterest,
      first_open_interest: firstOpenInterest,
      oi_change: oiChange,
      oi_change_pct: oiChangePct,
      latest_funding_rate: latestFundingRate,
      first_funding_rate: firstFundingRate,
      funding_change: fundingChange,
      sum_liq_long: row.sum_liq_long == null ? null : Number(row.sum_liq_long),
      sum_liq_short:
        row.sum_liq_short == null ? null : Number(row.sum_liq_short),
      sum_liq_total:
        row.sum_liq_total == null ? null : Number(row.sum_liq_total),
    };
  });

  return {
    hours: cappedHours,
    items,
  };
}

export type {
  MarketFeatureAsOf,
  TimescaleMarketContextQueryOptions,
} from './internal';
export { ensureDerivativesSchema } from './internal';
