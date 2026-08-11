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
  runtimeLineage: lineage,
});

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
    } as RuntimeTradeRecord;

    await fs.writeFile(
      filePath,
      JSON.stringify({
        reportType: 'runtime-evidence',
        userName: 'root',
        window: { startTime: 100, endTime: 400 },
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
