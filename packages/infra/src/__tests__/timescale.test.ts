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

    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_lock($1)', [610003]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS indicator_cache'),
    );
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [
      610003,
    ]);
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_lock($1)', [610004]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'ON CONFLICT (provider, symbol, interval, params_hash, version, ts)',
      ),
      [
        'bybit',
        'BTCUSDT',
        15,
        'hash-1',
        'v1',
        new Date(1_000),
        JSON.stringify({ ready: true }),
      ],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'CREATE TABLE IF NOT EXISTS indicator_cache_checkpoint',
      ),
    );
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [
      610004,
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'ON CONFLICT (provider, symbol, interval, params_hash, version, ts)',
      ),
      [
        'bybit',
        'BTCUSDT',
        15,
        'hash-1',
        'v1',
        new Date(1_000),
        JSON.stringify({ runtimeState: { seed: 1 } }),
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
    expect(coverageInsertCall?.[1]).toEqual([
      'bybit',
      'BTCUSDT',
      15,
      'hash-1',
      'v1',
      new Date(1_000),
      JSON.stringify({ ready: true }),
    ]);

    const checkpointInsertCall = query.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string' &&
        sql.includes('INSERT INTO indicator_cache_checkpoint') &&
        sql.includes(
          'ON CONFLICT (provider, symbol, interval, params_hash, version, ts)',
        ),
    );
    expect(checkpointInsertCall?.[1]).toEqual([
      'bybit',
      'BTCUSDT',
      15,
      'hash-1',
      'v1',
      new Date(2_000),
      JSON.stringify({ runtimeState: { seed: 2 } }),
    ]);
  });

  it('creates both indicator cache tables through the explicit migration helper', async () => {
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

  it('reads indicator cache coverage, range, and latest checkpoint with provider/params/version filters', async () => {
    const query = jest.fn(async (sql: string) => {
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
      expect.stringContaining('FROM indicator_cache_checkpoint'),
      ['bybit', 'BTCUSDT', 15, 'hash-1', 'v1', 2000],
    );
  });
});
