import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  RuntimeLineage,
  RuntimeSignalEvaluationRecord,
  RuntimeTradeRecord,
  Signal,
} from '@tradejs/types';
import {
  buildRuntimeEvidenceLineageScopes,
  loadReplayRuntimeEvidenceSource,
} from '../lib/replay/runtimeEvidenceSource';

const lineage: RuntimeLineage = {
  schemaVersion: 1,
  gitSha: 'abc123',
  gitDirty: false,
  gateFingerprint: 'gate',
  configFingerprint: 'config',
  contextFingerprint: 'context',
};

const signal = (timestamp: number): Signal =>
  ({
    signalId: `signal-${timestamp}`,
    strategy: 'TrendShift',
    symbol: 'BTCUSDT',
    interval: '15',
    direction: 'LONG',
    timestamp,
    runtimeConfigId: 'config',
    deploymentId: 'production',
    accountId: 'bybit-default',
    runtimeLineage: lineage,
  }) as Signal;

const evaluation = (timestamp: number): RuntimeSignalEvaluationRecord => ({
  evaluationId: `evaluation-${timestamp}`,
  userName: 'root',
  strategy: 'TrendShift',
  symbol: 'BTCUSDT',
  interval: '15',
  timestamp,
  evaluatedAt: timestamp,
  status: 'signal',
  runtimeConfigId: 'config',
  deploymentId: 'production',
  accountId: 'bybit-default',
  runtimeLineage: lineage,
});

const deployment = {
  schemaVersion: 2,
  id: 'production',
  deploymentCompositionId: 'dc1:1111111111111111',
  label: 'Production',
  connectorName: 'bybit',
  provider: 'bybit',
  accountId: 'bybit-default',
  enabled: true,
  tickers: ['BTCUSDT', 'ETHUSDT'],
  strategies: [
    {
      strategyName: 'TrendShift',
      strategyRevision: 'sr1:1111111111111111',
      enabled: true,
      controlState: 'active',
      interval: '15',
      universe: 'crypto',
      strategyPackage: '@tradejs/strategy-trend-shift',
      strategyPackageVersion: '3.0.0',
      strategyDependencyVersions: {
        '@tradejs/indicators': '3.2.0',
        '@tradejs/strategy-kit': '3.0.2',
      },
      runtimePackageVersion: '3.2.0',
      strategyConfig: { INTERVAL: '15', UNIVERSE: 'crypto' },
    },
  ],
} as const;

describe('runtime evidence replay source', () => {
  it('unwraps the immutable artifact and derives lineage scopes', async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tradejs-runtime-evidence-'),
    );
    const filePath = path.join(projectRoot, 'runtime-evidence.json');
    const trade = {
      orderId: 'order-1',
      signalId: 'signal-100',
      strategy: 'TrendShift',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1,
      entryPrice: 100,
      entryTimestamp: 100,
      status: 'active',
      deploymentId: 'production',
      accountId: 'bybit-default',
    } as RuntimeTradeRecord;

    await fs.writeFile(
      filePath,
      JSON.stringify({
        reportType: 'runtime-evidence',
        userName: 'root',
        window: { startTime: 100, endTime: 400 },
        deployment,
        runtime: {
          trades: [{ trade }],
          signals: [{ signal: signal(100) }],
          evaluations: [{ evaluation: evaluation(300) }],
        },
      }),
    );

    const result = await loadReplayRuntimeEvidenceSource({
      filePath,
      projectRoot,
      expectedUserName: 'root',
      expectedWindow: { start: 100, end: 400 },
    });

    expect(result.trades).toEqual([trade]);
    expect(result.signals).toHaveLength(1);
    expect(result.evaluations).toHaveLength(1);
    expect(result.deployment).toEqual(deployment);
    expect(result.lineageScopes).toEqual([
      expect.objectContaining({
        strategy: 'TrendShift',
        symbol: 'BTCUSDT',
        firstTimestamp: 100,
        lastTimestamp: 300,
        lineage,
      }),
    ]);
  });

  it('rejects an artifact from another replay window', async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tradejs-runtime-evidence-window-'),
    );
    const filePath = path.join(projectRoot, 'runtime-evidence.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        userName: 'root',
        window: { startTime: 100, endTime: 400 },
        deployment,
        runtime: { trades: [], signals: [], evaluations: [] },
      }),
    );

    await expect(
      loadReplayRuntimeEvidenceSource({
        filePath,
        projectRoot,
        expectedUserName: 'root',
        expectedWindow: { start: 200, end: 400 },
      }),
    ).rejects.toThrow(
      'Runtime evidence window mismatch: expected=200..400, actual=100..400',
    );
  });

  it('accepts replay inclusive end one millisecond before artifact end', async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tradejs-runtime-evidence-inclusive-end-'),
    );
    const filePath = path.join(projectRoot, 'runtime-evidence.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        userName: 'root',
        window: { startTime: 100, endTime: 400 },
        deployment,
        runtime: { trades: [], signals: [], evaluations: [] },
      }),
    );

    await expect(
      loadReplayRuntimeEvidenceSource({
        filePath,
        projectRoot,
        expectedUserName: 'root',
        expectedWindow: { start: 100, end: 399 },
      }),
    ).resolves.toMatchObject({ startTime: 100, endTime: 400 });
  });

  it('uses persisted skip-only lineage scopes from immutable evidence', async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tradejs-runtime-evidence-scopes-'),
    );
    const filePath = path.join(projectRoot, 'runtime-evidence.json');
    const lineageScope = {
      strategy: 'TrendShift',
      symbol: 'ETHUSDT',
      deploymentId: 'production',
      accountId: 'bybit-default',
      runtimeConfigId: 'sr1:1111111111111111',
      strategyRevision: 'sr1:1111111111111111',
      lineage: {
        schemaVersion: 3,
        strategyRevision: 'sr1:1111111111111111',
        deploymentCompositionId: 'dc1:1111111111111111',
        strategyPackageVersion: '3.0.0',
        strategyDependencyVersions: {
          '@tradejs/indicators': '3.2.0',
          '@tradejs/strategy-kit': '3.0.2',
        },
        runtimePackageVersion: '3.2.0',
        maxLossValue: 1,
      },
      firstTimestamp: 100,
      lastTimestamp: 300,
    };
    await fs.writeFile(
      filePath,
      JSON.stringify({
        userName: 'root',
        window: { startTime: 100, endTime: 400 },
        deployment: { ...deployment, tickers: undefined },
        runtime: {
          trades: [],
          signals: [],
          evaluations: [],
          lineageScopes: [lineageScope],
        },
      }),
    );

    await expect(
      loadReplayRuntimeEvidenceSource({
        filePath,
        projectRoot,
        expectedUserName: 'root',
        expectedWindow: { start: 100, end: 400 },
      }),
    ).resolves.toMatchObject({
      deployment: { tickers: ['ETHUSDT'] },
      lineageScopes: [lineageScope],
    });
  });
});

describe('runtime evidence lineage scopes', () => {
  it('keeps different lineages in separate deployment windows', () => {
    const changedLineage = { ...lineage, gitSha: 'def456' };
    const changedSignal = {
      ...signal(500),
      runtimeLineage: changedLineage,
    };

    expect(
      buildRuntimeEvidenceLineageScopes({
        signals: [signal(100), changedSignal],
        evaluations: [evaluation(300)],
      }),
    ).toEqual([
      expect.objectContaining({
        lineage,
        firstTimestamp: 100,
        lastTimestamp: 300,
      }),
      expect.objectContaining({
        lineage: changedLineage,
        firstTimestamp: 500,
        lastTimestamp: 500,
      }),
    ]);
  });
});
