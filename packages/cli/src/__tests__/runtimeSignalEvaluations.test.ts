const getHashJsonField = jest.fn();
const setHashJsonField = jest.fn();
const incrHashFields = jest.fn();

jest.mock('@tradejs/infra/redis', () => ({
  getHashJsonField: (...args: unknown[]) => getHashJsonField(...args),
  setHashJsonField: (...args: unknown[]) => setHashJsonField(...args),
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

describe('saveRuntimeSignalEvaluation lineage scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getHashJsonField.mockResolvedValue(null);
    setHashJsonField.mockResolvedValue(undefined);
    incrHashFields.mockResolvedValue(undefined);
  });

  it('persists bounded first/last timestamps for every evaluated scope', async () => {
    const { saveRuntimeSignalEvaluation } = await import(
      '../lib/signals/evaluations'
    );
    const runtimeLineage = {
      schemaVersion: 1 as const,
      gitSha: 'abc123',
      gitDirty: false,
      gateFingerprint: 'gate',
      configFingerprint: 'config',
      contextFingerprint: 'context',
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

    await saveRuntimeSignalEvaluation({
      ...base,
      evaluationId: 'first',
      timestamp: firstTimestamp,
    });
    await saveRuntimeSignalEvaluation({
      ...base,
      evaluationId: 'second',
      timestamp: secondTimestamp,
    });

    const lineageWrites = setHashJsonField.mock.calls.filter(([key]) =>
      String(key).startsWith('lineage:root:'),
    );
    expect(lineageWrites).toHaveLength(2);
    expect(lineageWrites[1][2]).toMatchObject({
      strategy: 'TrendShift',
      symbol: 'BTCUSDT',
      runtimeConfigId: 'config',
      lineage: runtimeLineage,
      firstTimestamp,
      lastTimestamp: secondTimestamp,
    });
    expect(getHashJsonField).toHaveBeenCalledTimes(1);
  });
});
