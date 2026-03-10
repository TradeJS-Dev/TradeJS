import 'dotenv/config';
import args from 'args';
import chalk from 'chalk';
import Redis from 'ioredis';
import { Pool } from 'pg';
import net from 'node:net';

type CheckResult = {
  name: string;
  required: boolean;
  ok: boolean;
  detail: string;
};

const okLabel = (text: string) => `${chalk.green('OK')} ${text}`;
const failLabel = (text: string) => `${chalk.red('FAIL')} ${text}`;
const infoLabel = (text: string) => `${chalk.yellow('INFO')} ${text}`;

const toPort = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseAddress = (value: string | undefined, fallback: string) => {
  const raw = String(value || fallback).trim();
  const idx = raw.lastIndexOf(':');
  if (idx <= 0) {
    return { host: '127.0.0.1', port: 50051 };
  }
  const host = raw.slice(0, idx);
  const port = toPort(raw.slice(idx + 1), 50051);
  return { host, port };
};

const checkRedis = async (): Promise<CheckResult> => {
  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = toPort(process.env.REDIS_PORT, 6379);
  const redis = new Redis({
    host,
    port,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    connectTimeout: 3_000,
    retryStrategy: () => null,
  });

  redis.on('error', () => {
    // suppress duplicate noisy event output in doctor mode
  });

  try {
    await redis.connect();
    const pong = await redis.ping();
    await redis.disconnect();
    return {
      name: 'Redis',
      required: true,
      ok: pong === 'PONG',
      detail: `${host}:${port} -> ${pong}`,
    };
  } catch (error) {
    redis.disconnect();
    return {
      name: 'Redis',
      required: true,
      ok: false,
      detail: `${host}:${port} -> ${String(error)}`,
    };
  }
};

const checkPostgres = async (): Promise<CheckResult> => {
  const host = process.env.PG_HOST || '127.0.0.1';
  const port = toPort(process.env.PG_PORT, 5432);
  const user = process.env.PG_USER || 'app';
  const password = process.env.PG_PASSWORD || 'app';
  const database = process.env.PG_DATABASE || process.env.PG_DB || 'app';

  const pool = new Pool({
    host,
    port,
    user,
    password,
    database,
    max: 1,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 3_000,
  });

  try {
    await pool.query('SELECT 1 as ok');
    await pool.end();
    return {
      name: 'Postgres',
      required: true,
      ok: true,
      detail: `${host}:${port}/${database} -> connected`,
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    return {
      name: 'Postgres',
      required: true,
      ok: false,
      detail: `${host}:${port}/${database} -> ${String(error)}`,
    };
  }
};

const checkMlGrpc = async (): Promise<CheckResult> => {
  const { host, port } = parseAddress(
    process.env.ML_GRPC_ADDRESS,
    '127.0.0.1:50051',
  );

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const done = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        name: 'ML gRPC',
        required: false,
        ok,
        detail,
      });
    };

    socket.setTimeout(2_500);
    socket.on('connect', () => done(true, `${host}:${port} -> reachable`));
    socket.on('timeout', () => done(false, `${host}:${port} -> timeout`));
    socket.on('error', (error) =>
      done(false, `${host}:${port} -> ${String(error)}`),
    );
  });
};

args
  .option('require-ml', 'Treat ML gRPC connectivity as required', false)
  .option('skip-ml', 'Skip ML gRPC check', false);

const flags = args.parse(process.argv);

const run = async () => {
  const checks: CheckResult[] = [];
  checks.push(await checkRedis());
  checks.push(await checkPostgres());

  if (!flags.skipMl) {
    const ml = await checkMlGrpc();
    if (flags.requireMl) {
      ml.required = true;
    }
    checks.push(ml);
  }

  console.log(chalk.cyan('TradeJS doctor'));
  for (const item of checks) {
    const label = item.ok ? okLabel(item.name) : failLabel(item.name);
    console.log(`${label} (${item.required ? 'required' : 'optional'})`);
    console.log(`  ${item.detail}`);
  }

  const failedRequired = checks.filter((item) => item.required && !item.ok);
  const failedOptional = checks.filter((item) => !item.required && !item.ok);

  if (failedRequired.length) {
    console.log('');
    console.log(
      chalk.red(
        `Doctor failed: ${failedRequired.length} required check(s) failed.`,
      ),
    );
    console.log(
      infoLabel(
        'Start infra: npx @tradejs/cli infra-init && npx @tradejs/cli infra-up',
      ),
    );
    process.exit(1);
  }

  if (failedOptional.length) {
    console.log('');
    console.log(
      infoLabel(
        `${failedOptional.length} optional check(s) failed (non-fatal).`,
      ),
    );
  }

  console.log('');
  console.log(chalk.green('Doctor passed.'));
};

run().catch((error) => {
  console.error(chalk.red(`doctor failed: ${String(error)}`));
  process.exit(1);
});
