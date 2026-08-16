import type { RuntimeTradeRecord } from '@tradejs/types';
import {
  assignLegacyRuntimeTradeAccountScopes,
  buildRuntimeStrategyAiGateChanges,
  buildRuntimeStrategyIdentityKey,
  buildRuntimeStrategyMaxLossValueTimeline,
  getRuntimeStrategyAiGateObservedFrom,
} from '../runtimeTrades';

describe('runtime trade lineage', () => {
  const trade = {
    orderId: 'legacy',
    strategy: 'TrendLine',
    symbol: 'BTCUSDT',
    direction: 'LONG',
    qty: 1,
    entryPrice: 100,
    entryTimestamp: 1,
    status: 'closed',
    universe: 'crypto',
  } satisfies RuntimeTradeRecord;

  it('builds a stable identity and assigns only unambiguous legacy accounts', () => {
    expect(
      buildRuntimeStrategyIdentityKey({
        strategyName: 'TrendLine',
        accountId: 'main',
      }),
    ).toBe('TrendLine:config:crypto:main:default:default');
    expect(
      assignLegacyRuntimeTradeAccountScopes(
        [trade],
        [
          {
            strategyName: 'TrendLine',
            configId: 'config',
            universe: 'crypto',
            accountId: 'main',
          },
        ],
      ),
    ).toEqual([{ ...trade, accountId: 'main' }]);
    expect(
      assignLegacyRuntimeTradeAccountScopes(
        [trade],
        ['main', 'alt'].map((accountId) => ({
          strategyName: 'TrendLine',
          configId: 'config',
          universe: 'crypto' as const,
          accountId,
        })),
      ),
    ).toEqual([trade]);
  });

  it('deduplicates gate and risk changes across symbols', () => {
    const lineage = (gateFingerprint: string, maxLossValue: number) => ({
      schemaVersion: 1 as const,
      gitSha: 'sha',
      gitDirty: false,
      gateFingerprint,
      configFingerprint: 'config',
      contextFingerprint: 'context',
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
      buildRuntimeStrategyAiGateChanges({
        scopes,
        strategyName: 'TrendLine',
        startTime: 100,
        endTime: 500,
      }),
    ).toEqual([
      { timestamp: 200, previousFingerprint: 'old', fingerprint: 'new' },
    ]);
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
