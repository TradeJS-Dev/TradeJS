describe('timescale candle helpers', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.restoreAllMocks();
    delete (global as typeof globalThis & { __pgPool__?: unknown }).__pgPool__;
  });

  it('normalizes provider and symbol in toRows', async () => {
    const { toRows } = await import('@tradejs/infra/timescale');

    const rows = toRows(' Binance ', 'btcusdt', 15, [
      {
        timestamp: 1_000,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
        turnover: 20,
        dt: '1970-01-01T00:00:01.000Z',
      },
    ]);

    expect(rows).toEqual([
      {
        provider: 'binance',
        symbol: 'BTCUSDT',
        interval: 15,
        ts: new Date(1_000),
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
        turnover: 20,
      },
    ]);
  });

  it('throws when provider is empty in toRows', async () => {
    const { toRows } = await import('@tradejs/infra/timescale');

    expect(() => toRows('  ', 'BTCUSDT', 15, [])).toThrow(
      'Candle provider is required',
    );
  });

  it('uses provider in upsert conflict key and query params', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined),
      release: jest.fn(),
    };
    const connect = jest.fn().mockResolvedValue(client);

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect,
        query: jest.fn(),
      })),
    }));

    const { upsertCandles } = await import('@tradejs/infra/timescale');

    await upsertCandles([
      {
        provider: 'Coinbase',
        symbol: 'btcusdt',
        interval: 15,
        ts: new Date(1_000),
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
        turnover: 20,
      },
    ]);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('ON CONFLICT (provider, symbol, interval, ts)'),
      ['coinbase', 'BTCUSDT', 15, new Date(1_000), 1, 2, 0.5, 1.5, 10, 20],
    );
    expect(client.query).toHaveBeenNthCalledWith(3, 'COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('closes singleton pool so one-shot CLI commands can exit', async () => {
    const end = jest.fn().mockResolvedValue(undefined);
    const query = jest.fn().mockResolvedValue({ rows: [] });

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query,
        end,
      })),
    }));

    const { closeTimescalePool, getCandlesRange } = await import(
      '@tradejs/infra/timescale'
    );

    await getCandlesRange('ByBit', 'btcusdt', 15, 1_000, 2_000);
    await closeTimescalePool();
    await closeTimescalePool();

    expect(end).toHaveBeenCalledTimes(1);
    expect(
      (global as typeof globalThis & { __pgPool__?: unknown }).__pgPool__,
    ).toBeUndefined();
  });

  it('scopes candle reads and deletes by provider', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ ts: new Date(1_000) }] })
      .mockResolvedValueOnce({ rows: [{ ms: '1000' }] })
      .mockResolvedValueOnce({ rows: [{ ms: '2000' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { ts: new Date(2_000), prev_ts: new Date(1_000), diff_seconds: 120 },
        ],
      });

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query,
      })),
    }));

    const { getCandlesRange, getDataEdges, deleteCandles, findContinuityGap } =
      await import('@tradejs/infra/timescale');

    await getCandlesRange('ByBit', 'btcusdt', 15, 1_000, 2_000);
    await expect(getDataEdges('ByBit', 'btcusdt', 15)).resolves.toEqual({
      min: 1_000,
      max: 2_000,
    });
    await deleteCandles('ByBit', 'btcusdt', 15);
    await expect(findContinuityGap('ByBit', 'btcusdt', 2)).resolves.toEqual({
      ts: 2_000,
      prevTs: 1_000,
      diffSeconds: 120,
    });

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        'WHERE provider = $1 AND symbol = $2 AND interval = $3',
      ),
      ['bybit', 'BTCUSDT', 15, 1_000, 2_000],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        'WHERE provider=$1 AND symbol=$2 AND interval=$3',
      ),
      ['bybit', 'BTCUSDT', 15],
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining(
        'WHERE provider=$1 AND symbol=$2 AND interval=$3',
      ),
      ['bybit', 'BTCUSDT', 15],
    );
    expect(query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('DELETE FROM candles'),
      ['bybit', 'BTCUSDT', 15],
    );
    expect(query).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining(
        'WHERE provider = $1 AND symbol = $2 AND interval = $3',
      ),
      ['bybit', 'BTCUSDT', 2, 120],
    );
  });

  it('stores indicator coverage rows and checkpoint rows with provider/params/version scope', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query,
      })),
    }));

    const {
      upsertIndicatorCacheCheckpointRows,
      upsertIndicatorCacheCoverageRows,
      upsertIndicatorCacheManifest,
    } = await import('@tradejs/infra/timescale');

    await upsertIndicatorCacheCoverageRows([
      {
        provider: 'ByBit',
        symbol: 'btcusdt',
        interval: 15,
        paramsHash: 'hash-1',
        version: 'v1',
        ts: new Date(1_000),
        snapshot: { ready: true },
      },
    ]);
    await upsertIndicatorCacheCheckpointRows([
      {
        provider: 'ByBit',
        symbol: 'btcusdt',
        interval: 15,
        paramsHash: 'hash-1',
        version: 'v1',
        ts: new Date(1_000),
        snapshot: { runtimeState: { seed: 1 } },
      },
    ]);
    await upsertIndicatorCacheManifest({
      provider: 'ByBit',
      symbol: 'btcusdt',
      interval: 15,
      paramsHash: 'hash-1',
      version: 'v1',
      startTs: new Date(1_000),
      endTs: new Date(2_000),
      rowCount: 2,
      rangeDigest: 'digest-1',
      lastCheckpointTs: new Date(2_000),
    });

    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_lock($1)', [610003]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS indicator_cache'),
    );
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [
      610003,
    ]);
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_lock($1)', [610004]);
    const coverageInsertCall = query.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string' &&
        sql.includes('INSERT INTO indicator_cache') &&
        sql.includes(
          'ON CONFLICT (provider, symbol, interval, params_hash, version, ts)',
        ),
    );
    expect(JSON.parse(coverageInsertCall?.[1]?.[0] as string)).toEqual([
      {
        provider: 'bybit',
        symbol: 'BTCUSDT',
        interval: 15,
        params_hash: 'hash-1',
        version: 'v1',
        ts: new Date(1_000).toISOString(),
        snapshot: { ready: true },
      },
    ]);
    expect(coverageInsertCall?.[0]).toEqual(
      expect.stringContaining('FROM jsonb_to_recordset($1::jsonb)'),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'CREATE TABLE IF NOT EXISTS indicator_cache_checkpoint',
      ),
    );
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [
      610004,
    ]);
    const checkpointInsertCall = query.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string' &&
        sql.includes('INSERT INTO indicator_cache_checkpoint') &&
        sql.includes(
          'ON CONFLICT (provider, symbol, interval, params_hash, version, ts)',
        ),
    );
    expect(JSON.parse(checkpointInsertCall?.[1]?.[0] as string)).toEqual([
      {
        provider: 'bybit',
        symbol: 'BTCUSDT',
        interval: 15,
        params_hash: 'hash-1',
        version: 'v1',
        ts: new Date(1_000).toISOString(),
        snapshot: { runtimeState: { seed: 1 } },
      },
    ]);
    expect(checkpointInsertCall?.[0]).toEqual(
      expect.stringContaining('FROM jsonb_to_recordset($1::jsonb)'),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO indicator_cache_manifest'),
      [
        'bybit',
        'BTCUSDT',
        15,
        'hash-1',
        'v1',
        new Date(1_000),
        new Date(2_000),
        2,
        'digest-1',
        new Date(2_000),
      ],
    );
  });

  it('deduplicates indicator cache rows inside one upsert batch by conflict key', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query,
      })),
    }));

    const {
      upsertIndicatorCacheCheckpointRows,
      upsertIndicatorCacheCoverageRows,
    } = await import('@tradejs/infra/timescale');

    await upsertIndicatorCacheCoverageRows([
      {
        provider: 'ByBit',
        symbol: 'btcusdt',
        interval: 15,
        paramsHash: 'hash-1',
        version: 'v1',
        ts: new Date(1_000),
        snapshot: { ready: false },
      },
      {
        provider: 'bybit',
        symbol: 'BTCUSDT',
        interval: 15,
        paramsHash: 'hash-1',
        version: 'v1',
        ts: new Date(1_000),
        snapshot: { ready: true },
      },
    ]);

    await upsertIndicatorCacheCheckpointRows([
      {
        provider: 'ByBit',
        symbol: 'btcusdt',
        interval: 15,
        paramsHash: 'hash-1',
        version: 'v1',
        ts: new Date(2_000),
        snapshot: { runtimeState: { seed: 1 } },
      },
      {
        provider: 'bybit',
        symbol: 'BTCUSDT',
        interval: 15,
        paramsHash: 'hash-1',
        version: 'v1',
        ts: new Date(2_000),
        snapshot: { runtimeState: { seed: 2 } },
      },
    ]);

    const coverageInsertCall = query.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string' &&
        sql.includes('INSERT INTO indicator_cache') &&
        sql.includes(
          'ON CONFLICT (provider, symbol, interval, params_hash, version, ts)',
        ),
    );
    expect(JSON.parse(coverageInsertCall?.[1]?.[0] as string)).toEqual([
      {
        provider: 'bybit',
        symbol: 'BTCUSDT',
        interval: 15,
        params_hash: 'hash-1',
        version: 'v1',
        ts: new Date(1_000).toISOString(),
        snapshot: { ready: true },
      },
    ]);

    const checkpointInsertCall = query.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string' &&
        sql.includes('INSERT INTO indicator_cache_checkpoint') &&
        sql.includes(
          'ON CONFLICT (provider, symbol, interval, params_hash, version, ts)',
        ),
    );
    expect(JSON.parse(checkpointInsertCall?.[1]?.[0] as string)).toEqual([
      {
        provider: 'bybit',
        symbol: 'BTCUSDT',
        interval: 15,
        params_hash: 'hash-1',
        version: 'v1',
        ts: new Date(2_000).toISOString(),
        snapshot: { runtimeState: { seed: 2 } },
      },
    ]);
  });

  it('creates indicator cache tables through the explicit migration helper', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query,
      })),
    }));

    const { ensureIndicatorCacheTables } = await import(
      '@tradejs/infra/timescale'
    );

    await ensureIndicatorCacheTables();

    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_lock($1)', [610003]);
    expect(query).toHaveBeenCalledWith(
      'CREATE EXTENSION IF NOT EXISTS timescaledb',
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS indicator_cache'),
    );
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [
      610003,
    ]);
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_lock($1)', [610004]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'CREATE TABLE IF NOT EXISTS indicator_cache_checkpoint',
      ),
    );
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [
      610004,
    ]);
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_lock($1)', [610005]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'CREATE TABLE IF NOT EXISTS indicator_cache_manifest',
      ),
    );
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [
      610005,
    ]);
  });

  it('serializes concurrent indicator cache schema init within one process', async () => {
    let lockResolved = false;
    let createTableCalls = 0;
    const query = jest.fn().mockImplementation(async (sql: string) => {
      if (sql === 'SELECT pg_advisory_lock($1)') {
        await new Promise((resolve) => setTimeout(resolve, 5));
        lockResolved = true;
        return { rows: [] };
      }
      if (sql.includes('CREATE TABLE IF NOT EXISTS indicator_cache (')) {
        createTableCalls += 1;
      }
      if (sql === 'SELECT pg_advisory_unlock($1)') {
        expect(lockResolved).toBe(true);
      }
      return { rows: [] };
    });

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query,
      })),
    }));

    const { ensureIndicatorCacheTables } = await import(
      '@tradejs/infra/timescale'
    );

    await Promise.all([
      ensureIndicatorCacheTables(),
      ensureIndicatorCacheTables(),
    ]);

    expect(createTableCalls).toBe(1);
  });

  it('reads indicator cache coverage, range, manifest, and latest checkpoint with provider/params/version filters', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM indicator_cache_manifest')) {
        return {
          rows: [
            {
              start_ts: new Date(1_000),
              end_ts: new Date(2_000),
              row_count: '2',
              range_digest: 'digest-1',
              last_checkpoint_ts: new Date(2_000),
            },
          ],
        };
      }
      if (sql.includes('COUNT(*)::int AS count')) {
        return { rows: [{ min: '1000', max: '2000', count: '3' }] };
      }
      if (sql.includes('SELECT ts, snapshot')) {
        if (sql.includes('FROM indicator_cache_checkpoint')) {
          return {
            rows: [
              { ts: new Date(2_000), snapshot: { runtimeState: { seed: 2 } } },
            ],
          };
        }
        return {
          rows: [{ ts: new Date(1_000), snapshot: { ready: true } }],
        };
      }
      return { rows: [] };
    });

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query,
      })),
    }));

    const {
      getIndicatorCacheCoverage,
      getIndicatorCacheManifest,
      getIndicatorCacheRange,
      getLatestIndicatorCacheCheckpointAtOrBefore,
    } = await import('@tradejs/infra/timescale');

    await expect(
      getIndicatorCacheCoverage({
        provider: 'ByBit',
        symbol: 'btcusdt',
        interval: 15,
        paramsHash: 'hash-1',
        version: 'v1',
        startMs: 1_000,
        endMs: 2_000,
      }),
    ).resolves.toEqual({ min: 1000, max: 2000, count: 3 });

    await expect(
      getIndicatorCacheRange({
        provider: 'ByBit',
        symbol: 'btcusdt',
        interval: 15,
        paramsHash: 'hash-1',
        version: 'v1',
        startMs: 1_000,
        endMs: 2_000,
      }),
    ).resolves.toEqual([
      {
        ts: new Date(1_000),
        snapshot: { ready: true },
      },
    ]);
    await expect(
      getIndicatorCacheManifest({
        provider: 'ByBit',
        symbol: 'btcusdt',
        interval: 15,
        paramsHash: 'hash-1',
        version: 'v1',
        startMs: 1_000,
        endMs: 2_000,
        rowCount: 2,
      }),
    ).resolves.toEqual({
      startTs: new Date(1_000),
      endTs: new Date(2_000),
      rowCount: 2,
      rangeDigest: 'digest-1',
      lastCheckpointTs: new Date(2_000),
    });

    await expect(
      getLatestIndicatorCacheCheckpointAtOrBefore({
        provider: 'ByBit',
        symbol: 'btcusdt',
        interval: 15,
        paramsHash: 'hash-1',
        version: 'v1',
        tsMs: 2_000,
      }),
    ).resolves.toEqual({
      ts: new Date(2_000),
      snapshot: { runtimeState: { seed: 2 } },
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM indicator_cache'),
      ['bybit', 'BTCUSDT', 15, 'hash-1', 'v1', 1000, 2000],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM indicator_cache'),
      ['bybit', 'BTCUSDT', 15, 'hash-1', 'v1', 1000, 2000],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM indicator_cache_manifest'),
      ['bybit', 'BTCUSDT', 15, 'hash-1', 'v1', 1000, 2000, 2],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM indicator_cache_checkpoint'),
      ['bybit', 'BTCUSDT', 15, 'hash-1', 'v1', 2000],
    );
  });

  it('stores and reads derivatives backfill coverage markers', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM derivatives_backfill_coverage')) {
        return {
          rows: [
            {
              symbol: 'BTCUSDT',
              interval: '1h',
              from_ms: '1000',
              to_ms: '2000',
              rows_count: '0',
            },
          ],
        };
      }
      return { rows: [] };
    });

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query,
      })),
    }));

    const {
      getDerivativesBackfillCoverage,
      upsertDerivativesBackfillCoverage,
    } = await import('@tradejs/infra/timescale');

    await upsertDerivativesBackfillCoverage([
      {
        source: 'Coinalyze',
        symbol: 'btcusdt',
        interval: '1h',
        fromMs: 1_000,
        toMs: 2_000,
        rowsCount: 0,
      },
    ]);

    await expect(
      getDerivativesBackfillCoverage({
        source: 'coinalyze',
        symbols: ['btcusdt'],
        interval: '1h',
        fromMs: 1_000,
        toMs: 2_000,
      }),
    ).resolves.toEqual([
      {
        symbol: 'BTCUSDT',
        interval: '1h',
        fromMs: 1_000,
        toMs: 2_000,
        rowsCount: 0,
      },
    ]);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO derivatives_backfill_coverage'),
      ['coinalyze', 'BTCUSDT', '1h', new Date(1_000), new Date(2_000), 0],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM derivatives_backfill_coverage'),
      ['coinalyze', ['BTCUSDT'], '1h', 1_000, 2_000],
    );
  });

  it('deletes all obsolete indicator cache versions by keep version', async () => {
    const progress = jest.fn();
    const query = jest.fn(async (sql: string) => {
      if (
        sql.includes('COUNT(*)::int AS count') &&
        sql.includes('FROM indicator_cache_manifest')
      ) {
        return { rows: [{ count: 1 }] };
      }
      if (
        sql.includes('COUNT(*)::int AS count') &&
        sql.includes('FROM indicator_cache_checkpoint')
      ) {
        return { rows: [{ count: 2 }] };
      }
      if (
        sql.includes('COUNT(*)::int AS count') &&
        sql.includes('FROM indicator_cache')
      ) {
        return { rows: [{ count: 3 }] };
      }
      if (
        sql.includes('DELETE FROM indicator_cache_checkpoint') &&
        sql.includes('version <> $1')
      ) {
        return { rows: [], rowCount: 2 };
      }
      if (
        sql.includes('DELETE FROM indicator_cache_manifest') &&
        sql.includes('version <> $1')
      ) {
        return { rows: [], rowCount: 1 };
      }
      if (
        sql.includes('DELETE FROM indicator_cache') &&
        sql.includes('version <> $1')
      ) {
        return { rows: [], rowCount: 3 };
      }
      return { rows: [] };
    });

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query,
      })),
    }));

    const { deleteAllIndicatorCacheObsoleteVersions } = await import(
      '@tradejs/infra/timescale'
    );

    await expect(
      deleteAllIndicatorCacheObsoleteVersions({
        keepVersion: 'v8',
        batchSize: 10,
        onProgress: progress,
      }),
    ).resolves.toEqual({
      coverageRows: 3,
      checkpointRows: 2,
      manifestRows: 1,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /CREATE INDEX IF NOT EXISTS indicator_cache_version_cleanup_idx/,
      ),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM indicator_cache'),
      ['v8', 10],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM indicator_cache_checkpoint'),
      ['v8', 10],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM indicator_cache_manifest'),
      ['v8', 10],
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'coverage',
        phase: 'delete',
        deletedRows: 3,
        totalRows: 3,
      }),
    );
  });

  it('resets indicator cache tables by dropping and recreating hypertables', async () => {
    const query = jest.fn(async () => ({ rows: [] }));

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query,
      })),
    }));

    const { resetIndicatorCacheTables } = await import(
      '@tradejs/infra/timescale'
    );

    await expect(resetIndicatorCacheTables()).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_lock($1)', [610003]);
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_lock($1)', [610004]);
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_lock($1)', [610005]);
    expect(query).toHaveBeenCalledWith(
      'DROP TABLE IF EXISTS indicator_cache_checkpoint CASCADE',
    );
    expect(query).toHaveBeenCalledWith(
      'DROP TABLE IF EXISTS indicator_cache_manifest CASCADE',
    );
    expect(query).toHaveBeenCalledWith(
      'DROP TABLE IF EXISTS indicator_cache CASCADE',
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS indicator_cache'),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'CREATE TABLE IF NOT EXISTS indicator_cache_checkpoint',
      ),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'CREATE TABLE IF NOT EXISTS indicator_cache_manifest',
      ),
    );
  });
});
