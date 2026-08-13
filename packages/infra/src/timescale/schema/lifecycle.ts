import { getPool } from '../pool';

export const withSchemaLock = async (
  lockKey: number,
  work: () => Promise<void>,
) => {
  const pool = getPool();
  await pool.query('SELECT pg_advisory_lock($1)', [lockKey]);
  try {
    await work();
  } finally {
    await pool.query('SELECT pg_advisory_unlock($1)', [lockKey]);
  }
};
