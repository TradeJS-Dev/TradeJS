import { Pool } from 'pg';

declare global {
  var __pgPool__: Pool | undefined;
}

export const getPool = () => {
  if (!global.__pgPool__) {
    const max = Number(process.env.PG_POOL_MAX ?? 10);
    const connectionTimeoutMillis = Number(
      process.env.PG_CONNECTION_TIMEOUT_MS ?? 30_000,
    );
    global.__pgPool__ = new Pool({
      host: process.env.PG_HOST || '127.0.0.1',
      port: Number(process.env.PG_PORT ?? 5432),
      user: process.env.PG_USER || 'app',
      password: String(process.env.PG_PASSWORD ?? 'app'),
      database: process.env.PG_DATABASE || process.env.PG_DB || 'app',
      max: Number.isFinite(max) && max > 0 ? Math.floor(max) : 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis:
        Number.isFinite(connectionTimeoutMillis) && connectionTimeoutMillis > 0
          ? Math.floor(connectionTimeoutMillis)
          : 30_000,
    });
  }
  return global.__pgPool__;
};

export const closePool = async () => {
  const pool = global.__pgPool__;
  if (!pool) return;
  global.__pgPool__ = undefined;
  await pool.end();
};
