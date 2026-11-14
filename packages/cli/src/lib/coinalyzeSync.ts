import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { gunzip } from 'node:zlib';
import type { Pool } from 'pg';

const execFileAsync = promisify(execFile);
const gunzipAsync = promisify(gunzip);
const maxWeekBytes = 128 * 1024 * 1024;
const weekMs = 7 * 86_400_000;
const metrics = [
  'open_interest',
  'funding_rate',
  'liq_long',
  'liq_short',
  'liq_total',
] as const;

const missingMetrics = (incoming: string) =>
  metrics
    .map((name) => `local.${name} IS NULL AND ${incoming}.${name} IS NOT NULL`)
    .join(' OR ');

async function readServerWeek(
  host: string,
  from: string,
  to: string,
  retries = 2,
) {
  const query = `
    SELECT json_build_array(symbol, interval, ts, ${metrics.join(', ')})
    FROM public.derivatives_market
    WHERE source = 'coinalyze' AND symbol LIKE '%USDT'
      AND interval IN ('15m', '1h')
      AND ts >= '${from}' AND ts < '${to}'
      AND ts < date_bin(interval::interval, statement_timestamp(), '2000-01-01 UTC')
      AND num_nonnulls(${metrics.join(', ')}) > 0
  `;
  const remoteCommand =
    "docker exec -i inv-timescale sh -ec 'set -o pipefail; psql -XqAt -v ON_ERROR_STOP=1 -U app -d app | gzip -1'";
  // psql reads the query from stdin. Dates are generated from validated inputs.
  const result = execFileAsync(
    'ssh',
    [
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'StrictHostKeyChecking=yes',
      host,
      remoteCommand,
    ],
    { encoding: 'buffer', maxBuffer: maxWeekBytes, timeout: 120_000 },
  );
  result.child.stdin?.on('error', () => {
    // ssh's exit status reports an early disconnect.
  });
  result.child.stdin?.end(`BEGIN READ ONLY;
SET LOCAL statement_timeout = '75s';
SET LOCAL TIME ZONE 'UTC';
${query};
ROLLBACK;
`);
  let stdout: string;
  try {
    const compressed = (await result).stdout;
    stdout = (
      await gunzipAsync(compressed, { maxOutputLength: maxWeekBytes })
    ).toString('utf8');
  } catch (error) {
    const status =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : undefined;
    if (retries > 0 && (status === 'Z_BUF_ERROR' || status === '255')) {
      await delay(1000);
      return readServerWeek(host, from, to, retries - 1);
    }
    throw new Error(
      `Could not read Coinalyze on ${host} for ${from} .. ${to}${status ? ` (${status})` : ''}. Check SSH and the server TimescaleDB.`,
    );
  }
  const rows = stdout.trim() ? stdout.trimEnd().split('\n') : [];
  if (rows.some((line) => !line.startsWith('[') || !line.endsWith(']'))) {
    throw new Error(`Invalid Coinalyze export for ${from} .. ${to}.`);
  }
  return { rows: rows.length, payload: `[${rows.join(',')}]` };
}

const incomingRows = `
  SELECT row->>0 AS symbol, row->>1 AS interval, (row->>2)::timestamptz AS ts,
    ${metrics.map((name, index) => `(row->>${index + 3})::double precision AS ${name}`).join(', ')}
  FROM json_array_elements($1::json) AS input(row)
`;

const eligibleRows = `
  SELECT incoming.*
  FROM (${incomingRows}) AS incoming
  LEFT JOIN public.derivatives_market AS local
    ON local.symbol = incoming.symbol AND local.interval = incoming.interval
    AND local.ts = incoming.ts AND local.ts >= $2 AND local.ts < $3
  WHERE local.symbol IS NULL
     OR (local.source = 'coinalyze' AND (${missingMetrics('incoming')}))
`;

export async function syncCoinalyze(
  pool: Pool,
  options: {
    host: string;
    from: number;
    to: number;
    dryRun: boolean;
    onWeek: (result: {
      from: string;
      to: string;
      read: number;
      rows: number;
    }) => void;
  },
) {
  let read = 0;
  let rows = 0;
  for (let start = options.from; start < options.to; start += weekMs) {
    const from = new Date(start).toISOString();
    const to = new Date(Math.min(start + weekMs, options.to)).toISOString();
    const incoming = await readServerWeek(options.host, from, to);
    let changed = 0;
    if (incoming.rows > 0) {
      if (options.dryRun) {
        const result = await pool.query<{ count: number }>(
          `SELECT count(*)::integer AS count FROM (${eligibleRows}) AS eligible`,
          [incoming.payload, from, to],
        );
        changed = result.rows[0].count;
      } else {
        const result = await pool.query(
          `INSERT INTO public.derivatives_market AS local
             (symbol, interval, ts, source, ${metrics.join(', ')})
           SELECT symbol, interval, ts, 'coinalyze', ${metrics.join(', ')}
           FROM (${eligibleRows}) AS eligible
           ON CONFLICT (symbol, interval, ts) DO UPDATE SET
             ${metrics.map((name) => `${name} = coalesce(local.${name}, excluded.${name})`).join(', ')}
           WHERE local.source = 'coinalyze' AND (${missingMetrics('excluded')})`,
          [incoming.payload, from, to],
        );
        changed = result.rowCount ?? 0;
      }
    }
    read += incoming.rows;
    rows += changed;
    options.onWeek({ from, to, read: incoming.rows, rows: changed });
  }
  return { read, rows };
}
