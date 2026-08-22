const getHashJsonValues = jest.fn();
const setHashJsonFields = jest.fn();
const incrHashFields = jest.fn();

jest.mock('@tradejs/infra/redis', () => ({
  getHashJsonValues: (...args: unknown[]) => getHashJsonValues(...args),
  setHashJsonFields: (...args: unknown[]) => setHashJsonFields(...args),
  incrHashFields: (...args: unknown[]) => incrHashFields(...args),
  redisKeys: {
    runtimeLineageScopeBucket: (userName: string, dayKey: string) =>
      `lineage:${userName}:${dayKey}`,
    runtimeSignalEvaluationBucket: (
      userName: string,
      dayKey: string,
      strategy: string,
    ) => `evaluations:${userName}:${dayKey}:${strategy}`,
    runtimeSignalEvaluationStatsBucket: (
      userName: string,
      dayKey: string,
      strategy: string,
    ) => `stats:${userName}:${dayKey}:${strategy}`,
  },
}));

describe('runtime signal evaluation buffering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getHashJsonValues.mockResolvedValue([]);
    setHashJsonFields.mockResolvedValue(undefined);
    incrHashFields.mockResolvedValue(undefined);
  });

  it('binds evaluation identity to deployment and account', async () => {
    const { buildRuntimeSignalEvaluationId } = await import(
      '../lib/signals/evaluations'
    );

    expect(
      buildRuntimeSignalEvaluationId({
        strategyName: 'TrendShift',
        symbol: 'BTCUSDT',
        timestamp: 123,
        strategyRevision: 'sr1:2222222222222222',
        deploymentId: 'production',
        accountId: 'bybit-main',
      }),
    ).toBe('production:bybit-main:TrendShift:sr1:2222222222222222:BTCUSDT:123');
    expect(
      buildRuntimeSignalEvaluationId({
        strategyName: 'TrendShift',
        symbol: 'BTCUSDT',
        timestamp: 123,
        strategyRevision: 'sr1:2222222222222222',
      }),
    ).toBe('TrendShift:sr1:2222222222222222:BTCUSDT:123');
  });

  it('batches lineage and stats while preserving bounded timestamps', async () => {
    const { createRuntimeSignalEvaluationBuffer } = await import(
      '../lib/signals/evaluations'
    );
    const runtimeLineage = {
      schemaVersion: 3 as const,
      strategyRevision: 'sr1:1111111111111111',
      deploymentCompositionId: 'dc1:2222222222222222',
      strategyPackageVersion: '3.0.0',
      strategyDependencyVersions: { '@tradejs/strategy-kit': '3.0.0' },
      runtimePackageVersion: '3.2.0',
    };
    const firstTimestamp = Date.UTC(2026, 6, 24, 10, 0);
    const secondTimestamp = Date.UTC(2026, 6, 24, 10, 15);
    const base = {
      userName: 'root',
      strategy: 'TrendShift',
      symbol: 'BTCUSDT',
      interval: '15' as const,
      evaluatedAt: secondTimestamp,
      status: 'skip' as const,
      reason: 'NO_SIGNAL',
      runtimeConfigId: 'config',
      runtimeLineage,
    };
    const buffer = createRuntimeSignalEvaluationBuffer();

    await buffer.save({
      ...base,
      evaluationId: 'first',
      timestamp: firstTimestamp,
    });
    await buffer.save({
      ...base,
      evaluationId: 'second',
      timestamp: secondTimestamp,
    });
    expect(setHashJsonFields).not.toHaveBeenCalled();
    expect(incrHashFields).not.toHaveBeenCalled();

    await buffer.flush();

    expect(getHashJsonValues).toHaveBeenCalledTimes(1);
    expect(setHashJsonFields).toHaveBeenCalledTimes(1);
    const lineageEntries = setHashJsonFields.mock.calls[0][1];
    expect(lineageEntries).toHaveLength(1);
    expect(lineageEntries[0].data).toMatchObject({
      strategy: 'TrendShift',
      symbol: 'BTCUSDT',
      runtimeConfigId: 'config',
      lineage: runtimeLineage,
      firstTimestamp,
      lastTimestamp: secondTimestamp,
    });
    expect(incrHashFields).toHaveBeenCalledWith(
      expect.stringContaining('stats:root:'),
      {
        evaluated: 2,
        'reason:skip from core:NO_SIGNAL': 2,
      },
      { expire: 259_200 },
    );
  });

  it('batches detailed signal records by strategy bucket', async () => {
    const { createRuntimeSignalEvaluationBuffer } = await import(
      '../lib/signals/evaluations'
    );
    const timestamp = Date.UTC(2026, 6, 24, 10, 0);
    const buffer = createRuntimeSignalEvaluationBuffer();
    const base = {
      userName: 'root',
      strategy: 'TrendLine',
      interval: '15' as const,
      evaluatedAt: timestamp,
      status: 'signal' as const,
      reason: 'SIGNAL',
      timestamp,
      direction: 'LONG' as const,
    };

    await buffer.save({
      ...base,
      evaluationId: 'ETH',
      symbol: 'ETHUSDT',
      signalId: 'signal-eth',
    });
    await buffer.save({
      ...base,
      evaluationId: 'SOL',
      symbol: 'SOLUSDT',
      signalId: 'signal-sol',
    });
    await buffer.flush();

    expect(setHashJsonFields).toHaveBeenCalledTimes(1);
    expect(setHashJsonFields).toHaveBeenCalledWith(
      expect.stringContaining('evaluations:root:'),
      [
        expect.objectContaining({ field: 'ETH' }),
        expect.objectContaining({ field: 'SOL' }),
      ],
      { expire: 259_200 },
    );
    expect(incrHashFields).toHaveBeenCalledWith(
      expect.stringContaining('stats:root:'),
      { evaluated: 2, signals: 2 },
      { expire: 259_200 },
    );
  });
});
