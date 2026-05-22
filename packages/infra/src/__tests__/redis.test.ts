type MockRedisClient = {
  on: jest.Mock;
  scan: jest.Mock;
  call: jest.Mock;
  get: jest.Mock;
  del: jest.Mock;
  expire: jest.Mock;
  set: jest.Mock;
  emit: (event: string, payload?: any) => void;
};

const createMockRedisClient = (): MockRedisClient => {
  const handlers: Record<string, (payload?: any) => void> = {};
  const client: MockRedisClient = {
    on: jest.fn((event: string, callback: (payload?: any) => void) => {
      handlers[event] = callback;
      return client;
    }),
    scan: jest.fn(),
    call: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    expire: jest.fn(),
    set: jest.fn(),
    emit: (event: string, payload?: any) => {
      handlers[event]?.(payload);
    },
  };
  return client;
};

describe('redis utils', () => {
  const originalHost = process.env.REDIS_HOST;
  const originalPort = process.env.REDIS_PORT;
  const originalConnectTimeout = process.env.REDIS_CONNECT_TIMEOUT_MS;
  const originalMaxRetries = process.env.REDIS_MAX_RETRIES_PER_REQUEST;

  afterEach(() => {
    process.env.REDIS_HOST = originalHost;
    process.env.REDIS_PORT = originalPort;
    process.env.REDIS_CONNECT_TIMEOUT_MS = originalConnectTimeout;
    process.env.REDIS_MAX_RETRIES_PER_REQUEST = originalMaxRetries;
    delete (global as any).__redis__;
    jest.resetModules();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  const setup = async () => {
    const redisClient = createMockRedisClient();
    const redisCtorMock = jest.fn(() => redisClient);
    const consoleWarnMock = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const consoleLogMock = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const consoleErrorMock = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    jest.doMock('ioredis', () => ({
      __esModule: true,
      default: redisCtorMock,
    }));

    const redisModule = await import('@tradejs/infra/redis');
    return {
      redisModule,
      redisClient,
      redisCtorMock,
      consoleWarnMock,
      consoleLogMock,
      consoleErrorMock,
    };
  };

  it('creates singleton redis client with env host/port and reuses it', async () => {
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6380';
    process.env.REDIS_CONNECT_TIMEOUT_MS = '4500';
    process.env.REDIS_MAX_RETRIES_PER_REQUEST = '2';

    const { redisModule, redisClient, redisCtorMock } = await setup();
    redisClient.call.mockResolvedValue('{"ok":1}');

    await expect(redisModule.getData('k1', null)).resolves.toEqual({ ok: 1 });
    await expect(redisModule.getData('k2', null)).resolves.toEqual({ ok: 1 });

    expect(redisCtorMock).toHaveBeenCalledTimes(1);
    expect(redisCtorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        port: 6380,
        connectTimeout: 4500,
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
        retryStrategy: expect.any(Function),
      }),
    );
    expect(redisClient.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(redisClient.on).toHaveBeenCalledWith('ready', expect.any(Function));
  });

  it('handles redis connectivity and generic error events with warning suppression/recovery', async () => {
    const {
      redisModule,
      redisClient,
      consoleWarnMock,
      consoleLogMock,
      consoleErrorMock,
    } = await setup();
    redisClient.call.mockResolvedValue('null');

    await redisModule.getData('bootstrap', null);

    redisClient.emit('error', new Error('ECONNREFUSED: connect failed'));
    redisClient.emit('error', new Error('EAI_AGAIN: dns'));
    redisClient.emit('ready');
    redisClient.emit('error', new Error('ENOTFOUND: redis'));
    redisClient.emit('error', new Error('SOME_OTHER_ERROR'));

    expect(consoleWarnMock).toHaveBeenCalledTimes(2);
    expect(consoleLogMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorMock).toHaveBeenCalledTimes(1);
  });

  it('scans keys by prefix and returns empty array on scan failure', async () => {
    const { redisModule, redisClient, consoleWarnMock } = await setup();

    redisClient.scan
      .mockResolvedValueOnce(['1', ['users:1', 'other:1']])
      .mockResolvedValueOnce(['0', ['users:2']]);

    await expect(redisModule.getKeys('users:')).resolves.toEqual([
      'users:1',
      'users:2',
    ]);

    redisClient.scan.mockRejectedValueOnce(new Error('scan-failed'));
    await expect(redisModule.getKeys('users:')).resolves.toEqual([]);
    expect(consoleWarnMock).toHaveBeenCalledWith(
      '[infra:redis] failed SCAN for %s: %s',
      'users:',
      'Error: scan-failed',
    );
  });

  it('reads JSON.GET first, handles invalid payload, and falls back to GET on JSON.GET error', async () => {
    const { redisModule, redisClient, consoleErrorMock } = await setup();

    redisClient.call.mockResolvedValueOnce('{"a":1}');
    await expect(redisModule.getData('json-ok', {})).resolves.toEqual({ a: 1 });

    redisClient.call.mockResolvedValueOnce(Buffer.from('{bad-json'));
    await expect(
      redisModule.getData('json-bad', { fallback: 1 }),
    ).resolves.toEqual({ fallback: 1 });
    expect(redisClient.del).toHaveBeenCalledWith('json-bad');

    redisClient.call.mockRejectedValueOnce(new Error('json-get-error'));
    redisClient.get.mockResolvedValueOnce('{"b":2}');
    await expect(redisModule.getData('fallback-get', null)).resolves.toEqual({
      b: 2,
    });

    redisClient.call.mockRejectedValueOnce(new Error('json-get-error-2'));
    redisClient.get.mockResolvedValueOnce('not-json');
    await expect(redisModule.getData('fallback-bad-json', [])).resolves.toEqual(
      [],
    );
    expect(redisClient.del).toHaveBeenCalledWith('fallback-bad-json');

    redisClient.call.mockRejectedValueOnce(new Error('json-get-error-3'));
    redisClient.get.mockRejectedValueOnce(new Error('get-error'));
    await expect(redisModule.getData('fallback-get-error', 'x')).resolves.toBe(
      'x',
    );

    expect(consoleErrorMock).toHaveBeenCalledWith(
      '[infra:redis] failed GET %s: %s',
      'fallback-get-error',
      'Error: get-error',
    );
  });

  it('marks redis unavailable on connectivity errors and short-circuits until ready', async () => {
    const { redisModule, redisClient, consoleWarnMock } = await setup();

    redisClient.call.mockRejectedValueOnce(
      new Error(
        'MaxRetriesPerRequestError: Reached the max retries per request limit',
      ),
    );

    await expect(redisModule.getData('k1', { fallback: 1 })).resolves.toEqual({
      fallback: 1,
    });
    expect(redisClient.get).not.toHaveBeenCalled();
    expect(consoleWarnMock).toHaveBeenCalledWith(
      '[infra:redis] Redis is unavailable: %s. Cache-dependent features are temporarily disabled.',
      expect.stringContaining('MaxRetriesPerRequestError'),
    );

    redisClient.call.mockClear();
    await expect(redisModule.getData('k2', { fallback: 2 })).resolves.toEqual({
      fallback: 2,
    });
    expect(redisClient.call).not.toHaveBeenCalled();

    redisClient.emit('ready');
    redisClient.call.mockResolvedValueOnce('{"ok":2}');
    await expect(redisModule.getData('k3', null)).resolves.toEqual({ ok: 2 });
  });

  it('supports delKey/delKeyWithOptions and raises on MISCONF when requested', async () => {
    const { redisModule, redisClient, consoleErrorMock } = await setup();

    redisClient.del.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await expect(redisModule.delKey('key-1')).resolves.toBe(true);
    await expect(redisModule.delKeyWithOptions('key-2')).resolves.toBe(false);

    redisClient.del.mockRejectedValueOnce(
      new Error('MISCONF redis write stop'),
    );
    await expect(
      redisModule.delKeyWithOptions('key-3', { raiseOnMisconf: true }),
    ).rejects.toThrow(redisModule.RedisWriteBlockedError);

    redisClient.del.mockRejectedValueOnce(new Error('DEL failed'));
    await expect(redisModule.delKeyWithOptions('key-4')).resolves.toBe(false);
    expect(consoleErrorMock).toHaveBeenCalledWith(
      '[infra:redis] failed DEL %s: %s',
      'key-4',
      'Error: DEL failed',
    );
  });

  it('writes data via JSON.SET, expires keys, and falls back to SET when JSON.SET fails', async () => {
    const { redisModule, redisClient, consoleErrorMock } = await setup();

    redisClient.call.mockResolvedValueOnce('OK');
    await redisModule.setData('json-set-ok', { x: 1 });
    expect(redisClient.call).toHaveBeenCalledWith(
      'JSON.SET',
      'json-set-ok',
      '$',
      '{"x":1}',
    );
    expect(redisClient.expire).toHaveBeenCalledWith('json-set-ok', 86400);

    redisClient.call.mockResolvedValueOnce('OK');
    const expireCallsBefore = redisClient.expire.mock.calls.length;
    await redisModule.setData('json-set-no-expire', { x: 2 }, { expire: 0 });
    expect(redisClient.expire.mock.calls.length).toBe(expireCallsBefore);

    redisClient.call.mockRejectedValueOnce(new Error('json-set-failed'));
    redisClient.set.mockResolvedValueOnce('OK');
    await redisModule.setData('set-fallback-expire', { x: 3 }, { expire: 12 });
    expect(redisClient.set).toHaveBeenCalledWith(
      'set-fallback-expire',
      '{"x":3}',
      'EX',
      12,
    );

    redisClient.call.mockRejectedValueOnce(new Error('json-set-failed-2'));
    redisClient.set.mockResolvedValueOnce('OK');
    await redisModule.setData(
      'set-fallback-no-expire',
      { x: 4 },
      { expire: 0 },
    );
    expect(redisClient.set).toHaveBeenCalledWith(
      'set-fallback-no-expire',
      '{"x":4}',
    );

    redisClient.call.mockRejectedValueOnce(new Error('json-set-failed-3'));
    redisClient.set.mockRejectedValueOnce(new Error('set-failed'));
    await redisModule.setData('set-fallback-failed', { x: 5 }, { expire: 1 });
    expect(consoleErrorMock).toHaveBeenCalledWith(
      '[infra:redis] failed SET %s: %s',
      'set-fallback-failed',
      'Error: set-failed',
    );
  });

  it('writes and reads hash-backed JSON bucket fields and string counters', async () => {
    const { redisModule, redisClient, consoleErrorMock } = await setup();

    redisClient.call.mockResolvedValueOnce(1);
    await redisModule.setHashJsonField('bucket:1', 'field-1', { x: 1 });
    expect(redisClient.call).toHaveBeenCalledWith(
      'HSET',
      'bucket:1',
      'field-1',
      '{"x":1}',
    );
    expect(redisClient.expire).toHaveBeenCalledWith('bucket:1', 86400);

    redisClient.call.mockResolvedValueOnce({
      'field-1': '{"x":1}',
      'field-2': '{"y":2}',
    });
    await expect(redisModule.getHashJsonValues('bucket:1')).resolves.toEqual([
      { x: 1 },
      { y: 2 },
    ]);

    redisClient.call.mockResolvedValueOnce(['field-1', '2', 'field-2', '7']);
    await expect(redisModule.getHashData('bucket:stats')).resolves.toEqual({
      'field-1': '2',
      'field-2': '7',
    });

    redisClient.call.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    await redisModule.incrHashFields(
      'bucket:stats',
      { evaluated: 2, signals: 1 },
      { expire: 10 },
    );
    expect(redisClient.call).toHaveBeenNthCalledWith(
      4,
      'HINCRBY',
      'bucket:stats',
      'evaluated',
      2,
    );
    expect(redisClient.call).toHaveBeenNthCalledWith(
      5,
      'HINCRBY',
      'bucket:stats',
      'signals',
      1,
    );
    expect(redisClient.expire).toHaveBeenCalledWith('bucket:stats', 10);

    redisClient.call.mockRejectedValueOnce(new Error('hset-failed'));
    await redisModule.setHashJsonField('bucket:2', 'field-2', { y: 2 });
    expect(consoleErrorMock).toHaveBeenCalledWith(
      '[infra:redis] failed HSET %s[%s]: %s',
      'bucket:2',
      'field-2',
      'Error: hset-failed',
    );
  });

  it('builds all redis key helpers with expected format', async () => {
    const { redisModule } = await setup();
    const { redisKeys } = redisModule;

    expect(redisKeys.users()).toBe('users:index:');
    expect(redisKeys.user('root')).toBe('users:index:root');
    expect(redisKeys.bots('root')).toBe('users:root:bots');
    expect(redisKeys.botsPrefix()).toBe('users:');
    expect(redisKeys.bot('root', 'bot-1')).toBe('users:root:bots:bot-1');
    expect(redisKeys.backtestConfig('root', 'TrendLine:base')).toBe(
      'users:root:backtests:configs:TrendLine:base',
    );
    expect(redisKeys.researchRuns('root')).toBe('users:root:research:runs:');
    expect(redisKeys.researchRun('root', 'run-1')).toBe(
      'users:root:research:runs:run-1',
    );
    expect(redisKeys.researchLatestRun('root', 'TrendLine')).toBe(
      'users:root:research:latest:TrendLine',
    );
    expect(redisKeys.strategies('root')).toBe('users:root:strategies');
    expect(redisKeys.strategyConfig('root', 'TrendLine')).toBe(
      'users:root:strategies:TrendLine:config',
    );
    expect(redisKeys.strategyResults('root', 'TrendLine')).toBe(
      'users:root:strategies:TrendLine:results',
    );
    expect(redisKeys.tests('root')).toBe('users:root:tests:');
    expect(redisKeys.tests('root', 'TrendLine')).toBe(
      'users:root:tests:TrendLine',
    );
    expect(redisKeys.testOrders('root', 'TrendLine', 't1')).toBe(
      'users:root:tests:TrendLine:t1:orders',
    );
    expect(redisKeys.testConfig('root', 'TrendLine', 't1')).toBe(
      'users:root:tests:TrendLine:t1:config',
    );
    expect(redisKeys.testStat('root', 'TrendLine', 't1')).toBe(
      'users:root:tests:TrendLine:t1:stat',
    );
    expect(redisKeys.testSummaries('root')).toBe(
      'users:root:tests:index:summary',
    );
    expect(redisKeys.cacheChunk('root', 'c1')).toBe(
      'users:root:cache:tests:chunks:c1',
    );
    expect(redisKeys.cacheOrders('root', 'o1')).toBe(
      'users:root:cache:tests:orders:o1',
    );
    expect(redisKeys.cachePositions('root', 'p1')).toBe(
      'users:root:cache:tests:positions:p1',
    );
    expect(redisKeys.signal('BTCUSDT', 's1')).toBe('signals:BTCUSDT:s1');
    expect(redisKeys.signalsBySymbol('BTCUSDT')).toBe('signals:BTCUSDT:');
    expect(redisKeys.storeSignal('BTCUSDT', 's1')).toBe(
      'store:signals:BTCUSDT:s1',
    );
    expect(redisKeys.runtimeSignals('root')).toBe(
      'users:root:runtime:signals:',
    );
    expect(redisKeys.runtimeSignal('root', 's1')).toBe(
      'users:root:runtime:signals:s1',
    );
    expect(redisKeys.runtimeSignalBuckets('root')).toBe(
      'users:root:runtime:signals:days:',
    );
    expect(
      redisKeys.runtimeSignalBucket('root', '2026-05-02', 'TrendLine'),
    ).toBe('users:root:runtime:signals:days:2026-05-02:TrendLine');
    expect(redisKeys.runtimeSignalEvaluations('root')).toBe(
      'users:root:runtime:signal-evaluations:',
    );
    expect(redisKeys.runtimeSignalEvaluation('root', 'e1')).toBe(
      'users:root:runtime:signal-evaluations:e1',
    );
    expect(redisKeys.runtimeSignalEvaluationBuckets('root')).toBe(
      'users:root:runtime:signal-evaluations:days:',
    );
    expect(
      redisKeys.runtimeSignalEvaluationBucket(
        'root',
        '2026-05-02',
        'TrendLine',
      ),
    ).toBe('users:root:runtime:signal-evaluations:days:2026-05-02:TrendLine');
    expect(redisKeys.runtimeSignalEvaluationStatsBuckets('root')).toBe(
      'users:root:runtime:signal-evaluation-stats:days:',
    );
    expect(
      redisKeys.runtimeSignalEvaluationStatsBucket(
        'root',
        '2026-05-02',
        'TrendLine',
      ),
    ).toBe(
      'users:root:runtime:signal-evaluation-stats:days:2026-05-02:TrendLine',
    );
    expect(redisKeys.runtimeTrades('root')).toBe(
      'users:root:runtime:trade-records:',
    );
    expect(redisKeys.runtimeTrade('root', 'o1')).toBe(
      'users:root:runtime:trade-records:o1',
    );
    expect(redisKeys.runtimeTradeBuckets('root')).toBe(
      'users:root:runtime:trade-records:days:',
    );
    expect(redisKeys.runtimeTradeBucket('root', '2026-05-02')).toBe(
      'users:root:runtime:trade-records:days:2026-05-02',
    );
    expect(redisKeys.runtimeActiveTrades('root')).toBe(
      'users:root:runtime:active-trades:',
    );
    expect(redisKeys.runtimeActiveTrade('root', 'BTCUSDT')).toBe(
      'users:root:runtime:active-trades:BTCUSDT',
    );
    expect(redisKeys.aiChatHistory('root', 'BTCUSDT')).toBe(
      'users:root:ai:chats:BTCUSDT',
    );
    expect(redisKeys.analysis('BTCUSDT', 's1')).toBe('analysis:BTCUSDT:s1');
    expect(redisKeys.screenshotSessionToken('token-1')).toBe(
      'auth:screenshot:token-1',
    );
    expect(redisKeys.backtestResults('root', 'TrendLine:base', '123')).toBe(
      'users:root:backtests:results:TrendLine:base:123',
    );
    expect(redisKeys.mlSignalsByStrategy('TrendLine')).toBe(
      'ml:TrendLine:signals:',
    );
    expect(redisKeys.mlSignals()).toBe('ml:');
    expect(redisKeys.mlSignal('TrendLine', 'sid')).toBe(
      'ml:TrendLine:signals:sid',
    );
    expect(redisKeys.mlResultsByStrategy('TrendLine')).toBe(
      'ml:TrendLine:results:',
    );
    expect(redisKeys.mlResults()).toBe('ml:');
    expect(redisKeys.mlResult('TrendLine', 'sid')).toBe(
      'ml:TrendLine:results:sid',
    );
  });
});
