import {
  runCandlesProviderMigration,
  type MigrationQueryable,
} from '../lib/candlesProviderMigration';

type MockResponse = {
  rows?: Array<Record<string, unknown>>;
  rowCount?: number | null;
};

const createDbMock = (
  handlers: Record<string, MockResponse | (() => MockResponse)>,
) => {
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    for (const [pattern, result] of Object.entries(handlers)) {
      if (!sql.includes(pattern)) continue;
      const value = typeof result === 'function' ? result() : result;
      return {
        rows: value.rows ?? [],
        rowCount: value.rowCount ?? null,
      };
    }

    throw new Error(
      `Unhandled query: ${sql} :: ${JSON.stringify(params || [])}`,
    );
  });

  return {
    query,
  } as unknown as MigrationQueryable & {
    query: jest.MockedFunction<MigrationQueryable['query']>;
  };
};

describe('runCandlesProviderMigration', () => {
  it('inspects migration state in dry-run mode without changing the table', async () => {
    const db = createDbMock({
      pg_advisory_lock: { rows: [] },
      'information_schema.columns': { rows: [{ exists: false }] },
      'FROM pg_index i': {
        rows: [
          { column_name: 'symbol' },
          { column_name: 'interval' },
          { column_name: 'ts' },
        ],
      },
      'timescaledb_information.jobs': {
        rows: [{ job_id: 101, scheduled: true }],
      },
      'timescaledb_information.chunk_compression_settings': {
        rows: [{ chunk_name: '_timescaledb_internal._hyper_1_1_chunk' }],
      },
      pg_advisory_unlock: { rows: [] },
    });

    const summary = await runCandlesProviderMigration(db, { dryRun: true });

    expect(summary).toEqual(
      expect.objectContaining({
        dryRun: true,
        providerColumnExistsBefore: false,
        primaryKeyColumnsBefore: ['symbol', 'interval', 'ts'],
        compressionJobIds: [101],
        compressedChunksBefore: ['_timescaledb_internal._hyper_1_1_chunk'],
        pausedJobIds: [],
        decompressedChunks: [],
        recompressedChunks: [],
      }),
    );
    expect(db.query).not.toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE'),
      expect.anything(),
    );
  });

  it('pauses policy, decompresses chunks, updates schema, and resumes policy', async () => {
    const db = createDbMock({
      pg_advisory_lock: { rows: [] },
      'information_schema.columns': { rows: [{ exists: false }] },
      'FROM pg_index i': {
        rows: [
          { column_name: 'symbol' },
          { column_name: 'interval' },
          { column_name: 'ts' },
        ],
      },
      'timescaledb_information.jobs': {
        rows: [{ job_id: 17, scheduled: true }],
      },
      'timescaledb_information.chunk_compression_settings': {
        rows: [
          { chunk_name: '_timescaledb_internal._hyper_1_1_chunk' },
          { chunk_name: '_timescaledb_internal._hyper_1_2_chunk' },
        ],
      },
      'alter_job($1, scheduled => false)': { rows: [] },
      'decompress_chunk($1::regclass, true)': { rows: [] },
      'ADD COLUMN IF NOT EXISTS provider text': { rows: [] },
      "SET provider = 'bybit' WHERE provider IS NULL": {
        rows: [],
        rowCount: 42,
      },
      'ALTER COLUMN provider SET DEFAULT': { rows: [] },
      'DROP CONSTRAINT IF EXISTS candles_pkey': { rows: [] },
      'ADD CONSTRAINT candles_pkey': { rows: [] },
      'DROP INDEX IF EXISTS candles_symbol_interval_ts_idx': { rows: [] },
      'CREATE INDEX IF NOT EXISTS candles_provider_symbol_interval_ts_idx': {
        rows: [],
      },
      "timescaledb.compress_segmentby = 'provider, symbol, interval'": {
        rows: [],
      },
      'compress_chunk($1::regclass, true)': { rows: [] },
      'alter_job($1, scheduled => true)': { rows: [] },
      pg_advisory_unlock: { rows: [] },
    });

    const summary = await runCandlesProviderMigration(db, {
      recompress: true,
    });

    expect(summary.providerBackfilledRows).toBe(42);
    expect(summary.primaryKeyChanged).toBe(true);
    expect(summary.pausedJobIds).toEqual([17]);
    expect(summary.decompressedChunks).toEqual([
      '_timescaledb_internal._hyper_1_1_chunk',
      '_timescaledb_internal._hyper_1_2_chunk',
    ]);
    expect(summary.recompressedChunks).toEqual([
      '_timescaledb_internal._hyper_1_1_chunk',
      '_timescaledb_internal._hyper_1_2_chunk',
    ]);
    expect(summary.resumedJobIds).toEqual([17]);

    expect(db.query).toHaveBeenCalledWith(
      'SELECT alter_job($1, scheduled => false)',
      [17],
    );
    expect(db.query).toHaveBeenCalledWith(
      'SELECT decompress_chunk($1::regclass, true)',
      ['_timescaledb_internal._hyper_1_1_chunk'],
    );
    expect(db.query).toHaveBeenCalledWith(
      'SELECT compress_chunk($1::regclass, true)',
      ['_timescaledb_internal._hyper_1_2_chunk'],
    );
    expect(db.query).toHaveBeenCalledWith(
      'SELECT alter_job($1, scheduled => true)',
      [17],
    );
  });

  it('keeps a correct primary key unchanged and can leave the policy paused', async () => {
    const db = createDbMock({
      pg_advisory_lock: { rows: [] },
      'information_schema.columns': { rows: [{ exists: true }] },
      'FROM pg_index i': {
        rows: [
          { column_name: 'provider' },
          { column_name: 'symbol' },
          { column_name: 'interval' },
          { column_name: 'ts' },
        ],
      },
      'timescaledb_information.jobs': {
        rows: [{ job_id: 19, scheduled: true }],
      },
      'timescaledb_information.chunk_compression_settings': { rows: [] },
      'alter_job($1, scheduled => false)': { rows: [] },
      "SET provider = 'bybit' WHERE provider IS NULL": {
        rows: [],
        rowCount: 0,
      },
      'ADD COLUMN IF NOT EXISTS provider text': { rows: [] },
      'ALTER COLUMN provider SET DEFAULT': { rows: [] },
      'DROP INDEX IF EXISTS candles_symbol_interval_ts_idx': { rows: [] },
      'CREATE INDEX IF NOT EXISTS candles_provider_symbol_interval_ts_idx': {
        rows: [],
      },
      "timescaledb.compress_segmentby = 'provider, symbol, interval'": {
        rows: [],
      },
      pg_advisory_unlock: { rows: [] },
    });

    const summary = await runCandlesProviderMigration(db, {
      recompress: false,
      keepPolicyPaused: true,
    });

    expect(summary.primaryKeyChanged).toBe(false);
    expect(summary.pausedJobIds).toEqual([19]);
    expect(summary.resumedJobIds).toEqual([]);
    expect(db.query).not.toHaveBeenCalledWith(
      expect.stringContaining('DROP CONSTRAINT IF EXISTS candles_pkey'),
      expect.anything(),
    );
    expect(db.query).not.toHaveBeenCalledWith(
      'SELECT alter_job($1, scheduled => true)',
      [19],
    );
  });
});
