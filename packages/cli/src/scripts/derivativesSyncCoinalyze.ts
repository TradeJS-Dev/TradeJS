import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { ensureDerivativesSchema } from '@tradejs/infra/timescale/derivatives';
import { syncCoinalyze } from '../lib/coinalyzeSync';

const usage = `Usage: tradejs derivatives:sync:coinalyze --host SSH_HOST --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run]

Copy missing Coinalyze USDT history into the local TradeJS TimescaleDB.
Dates are in UTC. --from is inclusive, --to is exclusive.
The SSH host must already be trusted and have the TradeJS inv-timescale container.
The destination uses the project's PG_* settings and must be on loopback.
Use --dry-run to count eligible rows without writing them.`;

function readDate(value: string | undefined) {
  const date = new Date(value ?? '');
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error('Provide --from and --to as valid YYYY-MM-DD dates.');
  }
  return date.getTime();
}

export async function main() {
  const { values } = parseArgs({
    options: {
      host: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  const host = values.host ?? '';
  if (!/^(?:[\w.][\w.-]*@)?[\w][\w.-]*$/.test(host)) {
    throw new Error('Provide --host as an SSH alias or user@hostname.');
  }
  const from = readDate(values.from);
  const to = readDate(values.to);
  if (from >= to) throw new Error('--to must be later than --from.');
  const localHost = process.env.PG_HOST || '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(localHost)) {
    throw new Error('PG_HOST must point to the local TimescaleDB on loopback.');
  }
  const pool = new Pool({
    host: localHost,
    port: Number(process.env.PG_PORT ?? 5432),
    user: process.env.PG_USER || 'app',
    password: process.env.PG_PASSWORD ?? 'app',
    database: process.env.PG_DATABASE || process.env.PG_DB || 'app',
    max: 1,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 180_000,
  });
  const dryRun = values['dry-run'] ?? false;
  const countLabel = dryRun ? 'eligible' : 'written';
  try {
    if (!dryRun) await ensureDerivativesSchema();
    const summary = await syncCoinalyze(pool, {
      host,
      from,
      to,
      dryRun,
      onWeek: (week) => {
        console.log(
          `${week.from.slice(0, 10)} .. ${week.to.slice(0, 10)}: read=${week.read} ${countLabel}=${week.rows}`,
        );
      },
    });
    console.log(
      `Coinalyze: read=${summary.read} ${countLabel}=${summary.rows}`,
    );
  } finally {
    await pool.end();
  }
}
