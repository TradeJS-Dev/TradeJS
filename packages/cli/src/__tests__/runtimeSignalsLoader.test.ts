export {};

describe('runtimeSignalsLoader', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('loads canonical runtime signals from bucket refs and deduplicates by signal id', async () => {
    const getKeys = jest.fn(async (prefix: string) => {
      if (prefix === 'users:root:runtime:signals:days:') {
        return [
          'users:root:runtime:signals:days:2026-05-01:TrendLine',
          'users:root:runtime:signals:days:2026-05-02:TrendLine',
        ];
      }
      return [];
    });
    const getHashJsonValues = jest.fn(async (key: string) => {
      if (key.endsWith(':2026-05-01:TrendLine')) {
        return [
          {
            signalId: 'sig-1',
            symbol: 'BTCUSDT',
            strategy: 'TrendLine',
            timestamp: 2,
          },
        ];
      }

      return [
        {
          signalId: 'sig-1',
          symbol: 'BTCUSDT',
          strategy: 'TrendLine',
          timestamp: 2,
        },
        {
          signalId: 'sig-2',
          symbol: 'ETHUSDT',
          strategy: 'TrendLine',
          timestamp: 1,
        },
      ];
    });
    const getData = jest.fn(async (key: string) => {
      if (key === 'store:signals:BTCUSDT:sig-1') {
        return {
          signalId: 'sig-1',
          strategy: 'TrendLine',
          symbol: 'BTCUSDT',
          direction: 'LONG',
          timestamp: 2,
        };
      }
      if (key === 'store:signals:ETHUSDT:sig-2') {
        return {
          signalId: 'sig-2',
          strategy: 'TrendLine',
          symbol: 'ETHUSDT',
          direction: 'LONG',
          timestamp: 1,
        };
      }
      return null;
    });

    jest.doMock('@tradejs/infra/redis', () => ({
      getData,
      getHashData: jest.fn(),
      getHashJsonValues,
      getKeys,
      redisKeys: {
        runtimeSignalBuckets: (userName: string) =>
          `users:${userName}:runtime:signals:days:`,
        runtimeSignalEvaluationBuckets: (userName: string) =>
          `users:${userName}:runtime:signal-evaluations:days:`,
        runtimeSignalEvaluationStatsBuckets: (userName: string) =>
          `users:${userName}:runtime:signal-evaluation-stats:days:`,
        storeSignal: (symbol: string, signalId: string) =>
          `store:signals:${symbol}:${signalId}`,
      },
    }));

    const { loadRuntimeSignals } = await import('../lib/runtimeSignalsLoader');
    await expect(loadRuntimeSignals('root')).resolves.toEqual([
      expect.objectContaining({ signalId: 'sig-2', timestamp: 1 }),
      expect.objectContaining({ signalId: 'sig-1', timestamp: 2 }),
    ]);
    expect(getData).toHaveBeenCalledTimes(2);
  });

  it('loads runtime signal evaluations and stats from day buckets', async () => {
    const getKeys = jest.fn(async (prefix: string) => {
      if (prefix === 'users:root:runtime:signal-evaluations:days:') {
        return [
          'users:root:runtime:signal-evaluations:days:2026-05-02:TrendLine',
        ];
      }
      if (prefix === 'users:root:runtime:signal-evaluation-stats:days:') {
        return [
          'users:root:runtime:signal-evaluation-stats:days:2026-05-02:production:TrendLine',
        ];
      }
      return [];
    });
    const getHashJsonValues = jest.fn(async () => [
      {
        evaluationId: 'eval-2',
        userName: 'root',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        interval: '15',
        timestamp: 2,
        evaluatedAt: 2,
        status: 'skip',
        reason: 'NO_SIGNAL',
      },
      {
        evaluationId: 'eval-1',
        userName: 'root',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        interval: '15',
        timestamp: 1,
        evaluatedAt: 1,
        status: 'signal',
        signalId: 'sig-1',
        direction: 'LONG',
      },
      {
        evaluationId: 'eval-1',
        userName: 'root',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        interval: '15',
        timestamp: 1,
        evaluatedAt: 1,
        status: 'signal',
        signalId: 'sig-1',
        direction: 'LONG',
      },
    ]);
    const getHashData = jest.fn(async () => ({
      evaluated: '33',
      signals: '2',
      'reason:skip from core:NO_SIGNAL': '30',
    }));

    jest.doMock('@tradejs/infra/redis', () => ({
      getData: jest.fn(),
      getHashData,
      getHashJsonValues,
      getKeys,
      redisKeys: {
        runtimeSignalBuckets: (userName: string) =>
          `users:${userName}:runtime:signals:days:`,
        runtimeSignalEvaluationBuckets: (userName: string) =>
          `users:${userName}:runtime:signal-evaluations:days:`,
        runtimeSignalEvaluationStatsBuckets: (userName: string) =>
          `users:${userName}:runtime:signal-evaluation-stats:days:`,
        storeSignal: (symbol: string, signalId: string) =>
          `store:signals:${symbol}:${signalId}`,
      },
    }));

    const {
      loadRuntimeSignalEvaluations,
      loadRuntimeSignalEvaluationStatsBuckets,
    } = await import('../lib/runtimeSignalsLoader');

    await expect(loadRuntimeSignalEvaluations('root')).resolves.toEqual([
      expect.objectContaining({ evaluationId: 'eval-1', timestamp: 1 }),
      expect.objectContaining({ evaluationId: 'eval-2', timestamp: 2 }),
    ]);
    await expect(
      loadRuntimeSignalEvaluationStatsBuckets('root'),
    ).resolves.toEqual([
      {
        key: 'users:root:runtime:signal-evaluation-stats:days:2026-05-02:production:TrendLine',
        dayKey: '2026-05-02',
        deploymentId: 'production',
        strategy: 'TrendLine',
        stats: expect.objectContaining({
          evaluated: 33,
          signals: 2,
        }),
      },
    ]);
  });

  it('limits runtime signal bucket reads to the requested time window', async () => {
    const getKeys = jest.fn(async (prefix: string) => {
      if (prefix === 'users:root:runtime:signals:days:') {
        return [
          'users:root:runtime:signals:days:2026-05-01:TrendLine',
          'users:root:runtime:signals:days:2026-05-02:TrendLine',
          'users:root:runtime:signals:days:2026-05-03:TrendLine',
        ];
      }
      if (prefix === 'users:root:runtime:signal-evaluations:days:') {
        return [
          'users:root:runtime:signal-evaluations:days:2026-05-01:TrendLine',
          'users:root:runtime:signal-evaluations:days:2026-05-02:TrendLine',
          'users:root:runtime:signal-evaluations:days:2026-05-03:TrendLine',
        ];
      }
      return [];
    });
    const getHashJsonValues = jest.fn(async (key: string) => {
      if (key.startsWith('users:root:runtime:signals:days:')) {
        return [
          {
            signalId: 'sig-2',
            symbol: 'BTCUSDT',
            strategy: 'TrendLine',
            timestamp: Date.parse('2026-05-02T12:00:00.000Z'),
          },
        ];
      }

      return [
        {
          evaluationId: 'eval-2',
          userName: 'root',
          strategy: 'TrendLine',
          symbol: 'BTCUSDT',
          interval: '15',
          timestamp: Date.parse('2026-05-02T12:00:00.000Z'),
          evaluatedAt: Date.parse('2026-05-02T12:00:00.000Z'),
          status: 'skip',
          reason: 'NO_SIGNAL',
        },
      ];
    });
    const getData = jest.fn(async () => ({
      signalId: 'sig-2',
      strategy: 'TrendLine',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      timestamp: Date.parse('2026-05-02T12:00:00.000Z'),
    }));

    jest.doMock('@tradejs/infra/redis', () => ({
      getData,
      getHashData: jest.fn(),
      getHashJsonValues,
      getKeys,
      redisKeys: {
        runtimeSignalBuckets: (userName: string) =>
          `users:${userName}:runtime:signals:days:`,
        runtimeSignalEvaluationBuckets: (userName: string) =>
          `users:${userName}:runtime:signal-evaluations:days:`,
        runtimeSignalEvaluationStatsBuckets: (userName: string) =>
          `users:${userName}:runtime:signal-evaluation-stats:days:`,
        storeSignal: (symbol: string, signalId: string) =>
          `store:signals:${symbol}:${signalId}`,
      },
    }));

    const { loadRuntimeSignals, loadRuntimeSignalEvaluations } = await import(
      '../lib/runtimeSignalsLoader'
    );

    const startTime = Date.parse('2026-05-02T00:00:00.000Z');
    const endTime = Date.parse('2026-05-03T00:00:00.000Z');

    await loadRuntimeSignals('root', { startTime, endTime });
    await loadRuntimeSignalEvaluations('root', { startTime, endTime });

    expect(getHashJsonValues).toHaveBeenCalledTimes(4);
    expect(getHashJsonValues).toHaveBeenCalledWith(
      'users:root:runtime:signals:days:2026-05-02:TrendLine',
    );
    expect(getHashJsonValues).toHaveBeenCalledWith(
      'users:root:runtime:signals:days:2026-05-03:TrendLine',
    );
    expect(getHashJsonValues).toHaveBeenCalledWith(
      'users:root:runtime:signal-evaluations:days:2026-05-02:TrendLine',
    );
    expect(getHashJsonValues).toHaveBeenCalledWith(
      'users:root:runtime:signal-evaluations:days:2026-05-03:TrendLine',
    );
    expect(getHashJsonValues).not.toHaveBeenCalledWith(
      'users:root:runtime:signals:days:2026-05-01:TrendLine',
    );
    expect(getHashJsonValues).not.toHaveBeenCalledWith(
      'users:root:runtime:signal-evaluations:days:2026-05-01:TrendLine',
    );
  });
});
