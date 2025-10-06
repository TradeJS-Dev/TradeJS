import 'dotenv/config';
import { Pool } from 'pg';
import { KlineChartData } from '@types';

declare global {
  // чтобы Next.js не создавал пул на каждый HMR
  // eslint-disable-next-line no-var
  var __pgPool__: Pool | undefined;
}

const getPool = () => {
  if (!global.__pgPool__) {
    global.__pgPool__ = new Pool({
      host: process.env.PG_HOST,
      port: Number(process.env.PG_PORT ?? 5432),
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DATABASE,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return global.__pgPool__;
};

export type CandleRow = {
  symbol: string;
  interval: number;
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  turnover?: number | null;
};

export const toRows = (
  symbol: string,
  interval: number,
  data: KlineChartData,
): CandleRow[] =>
  data.map((i) => ({
    symbol,
    interval,
    ts: new Date(i.timestamp), // ms -> Date
    open: i.open,
    high: i.high,
    low: i.low,
    close: i.close,
    volume: i.volume ?? null,
    turnover: i.turnover ?? null,
  }));

export async function upsertCandles(rows: CandleRow[]) {
  if (!rows.length) return;
  const pool = getPool();

  const cols = [
    'symbol',
    'interval',
    'ts',
    'open',
    'high',
    'low',
    'close',
    'volume',
    'turnover',
  ] as const;
  const valuesSql = rows
    .map(
      (_, i) =>
        `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(',')})`,
    )
    .join(',');

  const flat = rows.flatMap((r) => [
    r.symbol,
    r.interval,
    r.ts,
    r.open,
    r.high,
    r.low,
    r.close,
    r.volume ?? null,
    r.turnover ?? null,
  ]);

  const sql = `
    INSERT INTO candles (${cols.join(',')})
    VALUES ${valuesSql}
    ON CONFLICT (symbol, interval, ts) DO UPDATE SET
      open = EXCLUDED.open,
      high = EXCLUDED.high,
      low  = EXCLUDED.low,
      close = EXCLUDED.close,
      volume = COALESCE(EXCLUDED.volume, candles.volume),
      turnover = COALESCE(EXCLUDED.turnover, candles.turnover)
  `;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql, flat);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function getCandlesRange(
  symbol: string,
  interval: number,
  startMs: number,
  endMs: number,
) {
  const pool = getPool();
  const sql = `
    SELECT symbol, interval, ts,
           open, high, low, close, volume, turnover
    FROM candles
    WHERE symbol = $1 AND interval = $2
      AND ts >= to_timestamp($3/1000.0)
      AND ts <= to_timestamp($4/1000.0)
    ORDER BY ts ASC
  `;
  const res = await pool.query(sql, [symbol, interval, startMs, endMs]);
  return res.rows;
}

export async function getDataEdges(symbol: string, interval: number) {
  const pool = getPool();
  const sqlMin = `
    SELECT extract(epoch from ts)*1000 AS ms
    FROM candles
    WHERE symbol=$1 AND interval=$2
    ORDER BY ts ASC
    LIMIT 1
  `;
  const sqlMax = `
    SELECT extract(epoch from ts)*1000 AS ms
    FROM candles
    WHERE symbol=$1 AND interval=$2
    ORDER BY ts DESC
    LIMIT 1
  `;
  const [minQ, maxQ] = await Promise.all([
    pool.query(sqlMin, [symbol, interval]),
    pool.query(sqlMax, [symbol, interval]),
  ]);
  const min = minQ.rows[0]?.ms as number | undefined;
  const max = maxQ.rows[0]?.ms as number | undefined;
  return { min, max };
}
