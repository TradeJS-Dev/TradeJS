type QueryResultRow = Record<string, unknown>;

type QueryResult<T extends QueryResultRow = QueryResultRow> = {
  rows: T[];
  rowCount?: number | null;
};

export type MigrationQueryable = {
  query: <T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ) => Promise<QueryResult<T>>;
};

export type CandlesProviderMigrationOptions = {
  schema?: string;
  table?: string;
  dryRun?: boolean;
  recompress?: boolean;
  keepPolicyPaused?: boolean;
  onProgress?: (message: string) => void;
};

export type CandlesProviderMigrationSummary = {
  schema: string;
  table: string;
  dryRun: boolean;
  providerColumnExistsBefore: boolean;
  providerBackfilledRows: number;
  primaryKeyColumnsBefore: string[];
  primaryKeyChanged: boolean;
  compressionJobIds: number[];
  pausedJobIds: number[];
  resumedJobIds: number[];
  compressedChunksBefore: string[];
  decompressedChunks: string[];
  recompressedChunks: string[];
  indexEnsured: boolean;
  compressionSettingsUpdated: boolean;
};

const LOCK_KEY = 'tradejs:candles-provider-migration';

const assertIdentifier = (value: string, label: string) => {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return normalized;
};

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

const quoteQualifiedName = (schema: string, table: string) =>
  `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

const toQualifiedRegclass = (schema: string, table: string) =>
  `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

const getProviderColumnExists = async (
  db: MigrationQueryable,
  schema: string,
  table: string,
) => {
  const res = await db.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
          AND column_name = 'provider'
      ) AS exists
    `,
    [schema, table],
  );
  return Boolean(res.rows[0]?.exists);
};

const getPrimaryKeyColumns = async (
  db: MigrationQueryable,
  schema: string,
  table: string,
) => {
  const res = await db.query<{ column_name: string }>(
    `
      SELECT a.attname AS column_name
      FROM pg_index i
      JOIN pg_class t
        ON t.oid = i.indrelid
      JOIN pg_namespace n
        ON n.oid = t.relnamespace
      JOIN unnest(i.indkey) WITH ORDINALITY AS keys(attnum, ord)
        ON true
      JOIN pg_attribute a
        ON a.attrelid = t.oid
       AND a.attnum = keys.attnum
      WHERE i.indisprimary
        AND n.nspname = $1
        AND t.relname = $2
      ORDER BY keys.ord ASC
    `,
    [schema, table],
  );

  return res.rows.map((row) => String(row.column_name));
};

const getCompressionJobs = async (
  db: MigrationQueryable,
  schema: string,
  table: string,
) => {
  const res = await db.query<{ job_id: number; scheduled: boolean }>(
    `
      SELECT job_id, scheduled
      FROM timescaledb_information.jobs
      WHERE proc_name = 'policy_compression'
        AND hypertable_schema = $1
        AND hypertable_name = $2
      ORDER BY job_id ASC
    `,
    [schema, table],
  );

  return res.rows.map((row) => ({
    jobId: Number(row.job_id),
    scheduled: Boolean(row.scheduled),
  }));
};

const getCompressedChunks = async (
  db: MigrationQueryable,
  schema: string,
  table: string,
) => {
  const res = await db.query<{ chunk_name: string }>(
    `
      SELECT chunk::text AS chunk_name
      FROM timescaledb_information.chunk_compression_settings
      WHERE hypertable = $1::regclass
      ORDER BY chunk::text ASC
    `,
    [toQualifiedRegclass(schema, table)],
  );

  return res.rows.map((row) => String(row.chunk_name));
};

export const runCandlesProviderMigration = async (
  db: MigrationQueryable,
  options: CandlesProviderMigrationOptions = {},
) => {
  const schema = assertIdentifier(options.schema || 'public', 'schema');
  const table = assertIdentifier(options.table || 'candles', 'table');
  const dryRun = Boolean(options.dryRun);
  const recompress = options.recompress !== false;
  const keepPolicyPaused = Boolean(options.keepPolicyPaused);
  const quotedTable = quoteQualifiedName(schema, table);
  const onProgress =
    typeof options.onProgress === 'function' ? options.onProgress : undefined;
  const progress = (message: string) => {
    onProgress?.(message);
  };

  const summary: CandlesProviderMigrationSummary = {
    schema,
    table,
    dryRun,
    providerColumnExistsBefore: false,
    providerBackfilledRows: 0,
    primaryKeyColumnsBefore: [],
    primaryKeyChanged: false,
    compressionJobIds: [],
    pausedJobIds: [],
    resumedJobIds: [],
    compressedChunksBefore: [],
    decompressedChunks: [],
    recompressedChunks: [],
    indexEnsured: false,
    compressionSettingsUpdated: false,
  };

  const jobsToResume = new Set<number>();

  progress(`Acquire migration lock for ${schema}.${table}`);
  await db.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY]);

  try {
    progress('Inspect current candles schema');
    summary.providerColumnExistsBefore = await getProviderColumnExists(
      db,
      schema,
      table,
    );
    summary.primaryKeyColumnsBefore = await getPrimaryKeyColumns(
      db,
      schema,
      table,
    );

    const compressionJobs = await getCompressionJobs(db, schema, table);
    summary.compressionJobIds = compressionJobs.map((job) => job.jobId);
    progress(
      `Found ${summary.compressionJobIds.length} compression job(s) for ${schema}.${table}`,
    );
    summary.compressedChunksBefore = await getCompressedChunks(
      db,
      schema,
      table,
    );
    progress(
      `Found ${summary.compressedChunksBefore.length} compressed chunk(s) to process`,
    );

    if (dryRun) {
      progress('Dry run finished');
      return summary;
    }

    for (const [index, job] of compressionJobs.entries()) {
      if (!job.scheduled) continue;
      progress(
        `Pause compression job ${job.jobId} (${index + 1}/${compressionJobs.length})`,
      );
      await db.query('SELECT alter_job($1, scheduled => false)', [job.jobId]);
      summary.pausedJobIds.push(job.jobId);
      if (!keepPolicyPaused) {
        jobsToResume.add(job.jobId);
      }
    }

    for (const [index, chunkName] of summary.compressedChunksBefore.entries()) {
      progress(
        `Decompress chunk ${index + 1}/${summary.compressedChunksBefore.length}: ${chunkName}`,
      );
      await db.query('SELECT decompress_chunk($1::regclass, true)', [
        chunkName,
      ]);
      summary.decompressedChunks.push(chunkName);
    }

    progress('Ensure provider column exists');
    await db.query(
      `ALTER TABLE ${quotedTable} ADD COLUMN IF NOT EXISTS provider text`,
    );

    progress("Backfill provider='bybit' for existing rows");
    const updateResult = await db.query(
      `UPDATE ${quotedTable} SET provider = 'bybit' WHERE provider IS NULL`,
    );
    summary.providerBackfilledRows = Number(updateResult.rowCount ?? 0);

    progress('Set provider column default and NOT NULL');
    await db.query(
      `ALTER TABLE ${quotedTable}
         ALTER COLUMN provider SET DEFAULT 'bybit',
         ALTER COLUMN provider SET NOT NULL`,
    );

    const expectedPrimaryKey = ['provider', 'symbol', 'interval', 'ts'];
    if (
      summary.primaryKeyColumnsBefore.join(',') !== expectedPrimaryKey.join(',')
    ) {
      progress('Replace primary key with provider-aware key');
      await db.query(
        `ALTER TABLE ${quotedTable} DROP CONSTRAINT IF EXISTS candles_pkey`,
      );
      await db.query(
        `ALTER TABLE ${quotedTable}
           ADD CONSTRAINT candles_pkey
           PRIMARY KEY (provider, symbol, interval, ts)`,
      );
      summary.primaryKeyChanged = true;
    }

    progress('Recreate provider-aware candle index');
    await db.query('DROP INDEX IF EXISTS candles_symbol_interval_ts_idx');
    await db.query(
      `CREATE INDEX IF NOT EXISTS candles_provider_symbol_interval_ts_idx
         ON ${quotedTable} (provider, symbol, interval, ts DESC)`,
    );
    summary.indexEnsured = true;

    progress('Update Timescale compression settings');
    await db.query(
      `ALTER TABLE ${quotedTable} SET (
         timescaledb.compress,
         timescaledb.compress_segmentby = 'provider, symbol, interval'
       )`,
    );
    summary.compressionSettingsUpdated = true;

    if (recompress) {
      for (const [index, chunkName] of summary.decompressedChunks.entries()) {
        progress(
          `Recompress chunk ${index + 1}/${summary.decompressedChunks.length}: ${chunkName}`,
        );
        await db.query('SELECT compress_chunk($1::regclass, true)', [
          chunkName,
        ]);
        summary.recompressedChunks.push(chunkName);
      }
    }

    if (!keepPolicyPaused) {
      const jobIds = [...jobsToResume];
      for (const [index, jobId] of jobIds.entries()) {
        progress(
          `Resume compression job ${jobId} (${index + 1}/${jobIds.length})`,
        );
        await db.query('SELECT alter_job($1, scheduled => true)', [jobId]);
        summary.resumedJobIds.push(jobId);
      }
      jobsToResume.clear();
    }

    progress('Migration finished');
    return summary;
  } finally {
    for (const jobId of jobsToResume) {
      try {
        progress(`Best-effort resume of compression job ${jobId}`);
        await db.query('SELECT alter_job($1, scheduled => true)', [jobId]);
      } catch {
        // best effort: do not mask the original migration error
      }
    }

    progress(`Release migration lock for ${schema}.${table}`);
    await db.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]);
  }
};
