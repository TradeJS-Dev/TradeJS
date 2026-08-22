import {
  buildRuntimeStrategyIdentityKey,
  buildRuntimeStrategyMaxLossValueTimeline,
  getRuntimeStrategyAiGateObservedFrom,
} from '../runtimeTrades';

describe('runtime trade lineage', () => {
  it('builds a stable deployment identity', () => {
    expect(
      buildRuntimeStrategyIdentityKey({
        strategyName: 'TrendLine',
        accountId: 'main',
      }),
    ).toBe('TrendLine:config:crypto:main:default:default');
  });

  it('deduplicates risk changes across symbols', () => {
    const lineage = (revision: string, maxLossValue: number) => ({
      schemaVersion: 3 as const,
      strategyRevision: `sr1:${revision.repeat(16)}`,
      deploymentCompositionId: 'dc1:aaaaaaaaaaaaaaaa',
      strategyPackageVersion: '3.0.0',
      strategyDependencyVersions: { '@tradejs/strategy-kit': '3.0.0' },
      runtimePackageVersion: '3.2.0',
      maxLossValue,
    });
    const scopes = [
      ['BTCUSDT', 'old', 10, 50],
      ['ETHUSDT', 'old', 10, 50],
      ['BTCUSDT', 'new', 5, 200],
      ['ETHUSDT', 'new', 5, 200],
    ].map(([symbol, fingerprint, maxLossValue, timestamp]) => ({
      strategy: 'TrendLine',
      symbol: String(symbol),
      runtimeConfigId: 'config',
      lineage: lineage(String(fingerprint), Number(maxLossValue)),
      firstTimestamp: Number(timestamp),
      lastTimestamp: Number(timestamp) + 10,
    }));

    expect(
      buildRuntimeStrategyMaxLossValueTimeline({
        scopes,
        strategyName: 'TrendLine',
        startTime: 100,
        endTime: 500,
      }),
    ).toEqual({
      observedFrom: 50,
      initialValue: 10,
      changes: [{ timestamp: 200, previousValue: 10, value: 5 }],
    });
    expect(
      getRuntimeStrategyAiGateObservedFrom({
        scopes,
        strategyName: 'TrendLine',
        endTime: 500,
      }),
    ).toBe(50);
  });
});
