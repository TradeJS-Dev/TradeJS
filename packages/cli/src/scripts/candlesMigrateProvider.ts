import args from 'args';
import chalk from 'chalk';
import { Pool } from 'pg';
import {
  runCandlesProviderMigration,
  type CandlesProviderMigrationSummary,
} from '../lib/candlesProviderMigration';

args.option('dry-run', 'Inspect the migration without changing the database');
args.option(
  'skip-recompress',
  'Leave decompressed chunks for the compression policy to recompress later',
  false,
);
args.option(
  'keep-policy-paused',
  'Do not re-enable the compression policy automatically after the migration',
  false,
);
args.option('schema', 'Schema name for the candles hypertable', 'public');
args.option('table', 'Candles hypertable name', 'candles');

const flags = args.parse(process.argv);

const pool = new Pool({
  host: process.env.PG_HOST || '127.0.0.1',
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER || 'app',
  password: String(process.env.PG_PASSWORD ?? 'app'),
  database: process.env.PG_DATABASE || process.env.PG_DB || 'app',
  max: 1,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

const printSummary = (summary: CandlesProviderMigrationSummary) => {
  const modeLabel = summary.dryRun
    ? chalk.yellow('DRY RUN')
    : chalk.green('DONE');
  const tableName = `${summary.schema}.${summary.table}`;
  const primaryKeyIsTarget =
    summary.primaryKeyColumnsBefore.join(',') === 'provider,symbol,interval,ts';

  console.log(chalk.cyan(`candles provider migration: ${modeLabel}`));
  console.log(`table: ${tableName}`);
  console.log(
    `provider column existed before: ${summary.providerColumnExistsBefore ? 'yes' : 'no'}`,
  );
  console.log(
    `primary key before: ${
      summary.primaryKeyColumnsBefore.join(', ') || '(missing)'
    }`,
  );
  console.log(
    `compression jobs: ${
      summary.compressionJobIds.length
        ? summary.compressionJobIds.join(', ')
        : '(none)'
    }`,
  );
  console.log(
    `compressed chunks before: ${summary.compressedChunksBefore.length}`,
  );

  if (summary.dryRun) {
    console.log(
      `needs primary key change: ${primaryKeyIsTarget ? 'no' : 'yes'}`,
    );
    return;
  }

  console.log(`backfilled provider rows: ${summary.providerBackfilledRows}`);
  console.log(
    `paused jobs: ${
      summary.pausedJobIds.length ? summary.pausedJobIds.join(', ') : '(none)'
    }`,
  );
  console.log(`decompressed chunks: ${summary.decompressedChunks.length}`);
  console.log(`recompressed chunks: ${summary.recompressedChunks.length}`);
  console.log(
    `resumed jobs: ${
      summary.resumedJobIds.length ? summary.resumedJobIds.join(', ') : '(none)'
    }`,
  );
};

const run = async () => {
  const summary = await runCandlesProviderMigration(pool, {
    schema: String(flags.schema || 'public'),
    table: String(flags.table || 'candles'),
    dryRun: Boolean(flags['dry-run']),
    recompress: !Boolean(flags['skip-recompress']),
    keepPolicyPaused: Boolean(flags['keep-policy-paused']),
  });

  printSummary(summary);
};

run()
  .catch((error) => {
    console.error(
      chalk.red(`candles:migrate-provider failed: ${String(error)}`),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
