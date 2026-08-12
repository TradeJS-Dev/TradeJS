import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildAiTrainLineage,
  fingerprintResearchValue,
  summarizeAiTrainCoverage,
  summarizeAiTrainRejectReasons,
  summarizeAiTrainTerminalWindows,
  writeAiTrainResearchSnapshot,
} from '../lib/aiTrainResearch';

describe('aiTrainResearch', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('builds coverage and terminal windows relative to the dataset tail', () => {
    const evaluations = [
      {
        profit: 5,
        profitableTrade: true,
        aiApproved: true,
        quality: 5,
        direction: 'LONG',
        timestamp: 0,
      },
      {
        profit: -2,
        profitableTrade: false,
        aiApproved: false,
        quality: 3,
        direction: 'SHORT',
        timestamp: 25 * DAY_MS,
        rejectReason: 'missing derivatives; weak participation',
      },
      {
        profit: -3,
        profitableTrade: false,
        aiApproved: false,
        quality: 3,
        direction: 'SHORT',
        timestamp: 29 * DAY_MS,
        rejectReason: 'missing derivatives',
      },
      {
        profit: 4,
        profitableTrade: true,
        aiApproved: true,
        quality: 4,
        direction: 'LONG',
        timestamp: 30 * DAY_MS,
      },
    ];

    expect(summarizeAiTrainCoverage(evaluations, 32 * DAY_MS)).toEqual({
      timestamped: 4,
      missingTimestamps: 0,
      minTimestamp: 0,
      maxTimestamp: 30 * DAY_MS,
      spanDays: 30,
      dataLagDays: 2,
    });

    const [last30d, last7d] = summarizeAiTrainTerminalWindows(
      evaluations,
      [30, 7],
    );
    expect(last30d).toEqual(
      expect.objectContaining({
        label: 'last30d',
        complete: true,
        selected: 4,
        coverageDays: 30,
        approvedPerCalendarDay: 2 / 30,
      }),
    );
    expect(last7d).toEqual(
      expect.objectContaining({
        label: 'last7d',
        complete: true,
        selected: 3,
        coverageDays: 7,
        approvedPerCalendarDay: 1 / 7,
        topRejectReasons: [
          { reason: 'missing derivatives', count: 2 },
          { reason: 'weak participation', count: 1 },
        ],
        byDirection: [
          expect.objectContaining({ direction: 'LONG' }),
          expect.objectContaining({ direction: 'SHORT' }),
        ],
      }),
    );

    expect(
      summarizeAiTrainTerminalWindows(evaluations.slice(-2), [7])[0],
    ).toEqual(
      expect.objectContaining({
        label: 'last7d',
        complete: false,
        selected: 2,
      }),
    );
  });

  it('handles missing timestamps and ignores approved reject reasons', () => {
    const evaluations = [
      {
        profit: 1,
        profitableTrade: true,
        aiApproved: true,
        quality: 5,
        rejectReason: 'stale reason',
      },
    ];

    expect(summarizeAiTrainCoverage(evaluations, 0)).toEqual({
      timestamped: 0,
      missingTimestamps: 1,
      minTimestamp: null,
      maxTimestamp: null,
      spanDays: null,
      dataLagDays: null,
    });
    expect(summarizeAiTrainTerminalWindows(evaluations, [7])).toEqual([]);
    expect(summarizeAiTrainRejectReasons(evaluations)).toEqual([]);
  });

  it('uses stable fingerprints for equivalent key ordering', () => {
    expect(fingerprintResearchValue({ a: 1, b: { c: 2 } })).toBe(
      fingerprintResearchValue({ b: { c: 2 }, a: 1 }),
    );
  });

  it('builds safe context and config lineage without secret env fields', async () => {
    const lineage = await buildAiTrainLineage({
      projectRoot: '/path/that/does/not/exist',
      strategyName: 'TrendFollow',
      configIds: ['cfg-b', 'cfg-a', 'cfg-a', ''],
      sourceSha256s: ['b'.repeat(64), 'a'.repeat(64), 'b'.repeat(64)],
      runContext: { mode: 'local-deterministic', minQuality: 4 },
      env: {
        AI_MODE: 'gate',
        DERIVATIVES_CONTEXT_INTERVALS: '15m,1h',
        DERIVATIVES_CONTEXT_TARGET_ENABLED: 'false',
        OPENROUTER_API_KEY: 'must-not-leak',
      },
    });

    expect(lineage.configIds).toEqual(['cfg-a', 'cfg-b']);
    expect(lineage.context).toEqual(
      expect.objectContaining({
        AI_MODE: 'gate',
        DERIVATIVES_CONTEXT_TARGET_ENABLED: 'false',
        derivativesSourceIntervals: '15m',
        derivativesDerivedIntervals: '1h',
        derivativesHourlyFallback: 'stored-1h',
        derivativesDataModelVersion: 2,
        mode: 'local-deterministic',
        minQuality: 4,
      }),
    );
    expect(lineage.context).not.toHaveProperty('DERIVATIVES_CONTEXT_INTERVALS');
    expect(lineage.context).not.toHaveProperty('OPENROUTER_API_KEY');
    expect(lineage.gateFingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(lineage.gateFingerprintFiles).toEqual([]);
    expect(lineage.contextFingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(lineage.sourceSha256s).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  });

  it('writes a formatted structured research snapshot', async () => {
    const temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tradejs-ai-train-research-'),
    );
    const outputPath = path.join(temporaryDirectory, 'nested', 'report.json');

    try {
      await expect(
        writeAiTrainResearchSnapshot({
          outputPath,
          result: { run: { strategy: 'TrendFollow' }, outcome: { total: 2 } },
        }),
      ).resolves.toBe(path.resolve(outputPath));
      await expect(fs.readFile(outputPath, 'utf8')).resolves.toBe(
        '{\n  "run": {\n    "strategy": "TrendFollow"\n  },\n  "outcome": {\n    "total": 2\n  }\n}\n',
      );
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
