import type { RuntimeTradeRecord } from '@tradejs/types';

const startTime = Date.parse('2026-10-25T18:00:00Z');
const endTime = Date.parse('2026-10-26T18:00:00Z');
const trade = (orderId: string, fields = {}): RuntimeTradeRecord => ({
  orderId,
  strategy: 'StructureZones',
  symbol: 'DNAUSDT',
  direction: 'SHORT',
  qty: 49,
  entryPrice: 0.1893,
  entryTimestamp: startTime - 3600000,
  deploymentId: 'production',
  accountId: 'bybit-default',
  status: 'active',
  ...fields,
});

test('collector retains carry-ins, including positions closed after the historical cutoff', async () => {
  jest.resetModules();
  const active = trade('active');
  const olderActive = trade('older-active', {
    entryTimestamp: startTime - 3 * 86400000,
  });
  const laterClosed = trade('later-closed', {
    status: 'closed',
    exitTimestamp: endTime + 653281,
    exitPrice: 0.2076,
    actualExitPrice: 0.2076,
    closedPnl: -0.91526611,
    currentPnl: -0.91526611,
    currentPrice: 0.2076,
    closeFee: 0.01,
    fundingFee: 0.002,
    totalFee: 0.02,
    lastSyncedAt: endTime + 1000000,
  });
  const closedInside = trade('closed-inside', {
    status: 'closed',
    exitTimestamp: startTime + 1000,
    closedPnl: 1,
  });
  const closedBefore = trade('closed-before', {
    status: 'closed',
    exitTimestamp: startTime - 1,
  });
  const future = trade('future', { entryTimestamp: endTime });
  const other = trade('other', { deploymentId: 'other' });
  const exitsAtCutoff = trade('cutoff-close', {
    status: 'closed',
    exitTimestamp: endTime,
    exitPrice: 0.2,
    closedPnl: -0.5,
  });
  const buckets: Record<string, RuntimeTradeRecord[]> = {
    'entries:2026-10-22': [olderActive],
    'entries:2026-10-25': [
      active,
      laterClosed,
      closedInside,
      closedBefore,
      other,
      exitsAtCutoff,
    ],
    'entries:2026-10-26': [future],
    'closed:2026-10-25': [closedInside],
  };
  const getKeys = jest.fn(async (prefix: string) =>
    Object.keys(buckets).filter((k) => k.startsWith(prefix)),
  );
  jest.doMock('@tradejs/infra/redis', () => ({
    getKeys,
    getData: jest.fn(),
    getHashJsonValues: jest.fn(async (key: string) => buckets[key] ?? []),
    redisKeys: {
      runtimeTradeBuckets: () => 'entries:',
      runtimeTradeBucket: (_u: string, d: string) => 'entries:' + d,
      runtimeClosedTradeBucket: (_u: string, d: string) => 'closed:' + d,
    },
  }));
  jest.doMock('../lib/runtimeSignalsLoader', () => ({
    loadRuntimeSignals: async () => [],
    loadRuntimeSignalEvaluations: async () => [],
    loadRuntimeSignalEvaluationStatsBuckets: async () => [],
    loadRuntimeLineageScopes: async () => [],
  }));
  const { collectRuntimeDebugEvidence } = await import(
    '../lib/runtimeDebugEvidence'
  );
  const result = await collectRuntimeDebugEvidence({
    userName: 'root',
    startTime,
    endTime,
    deploymentId: 'production',
  });
  expect(result.trades.map((t) => t.orderId)).toEqual([
    'older-active',
    'active',
    'later-closed',
    'closed-inside',
    'cutoff-close',
  ]);
  expect(result.trades.find((t) => t.orderId === 'later-closed')).toMatchObject(
    {
      status: 'active',
      exitTimestamp: null,
      exitPrice: null,
      actualExitPrice: null,
      closedPnl: null,
      currentPrice: null,
      currentPnl: null,
      closeFee: null,
      fundingFee: null,
      totalFee: null,
    },
  );
  expect(laterClosed.status).toBe('closed');
  expect(result.trades.find((t) => t.orderId === 'cutoff-close')).toMatchObject(
    { status: 'active', exitTimestamp: null, closedPnl: null },
  );
  expect(
    result.trades.find((t) => t.orderId === 'closed-inside')?.closedPnl,
  ).toBe(1);
});
