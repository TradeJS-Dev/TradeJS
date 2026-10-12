import {
  parseAiPocketTestSince,
  splitAiPocketResearchRowsByTimestamp,
} from '../lib/aiPocketSearchCli';
import { resolveAiPocketSearchCommandOptions } from '../lib/aiPocketSearch/commandOptions';
import { runAiPocketSearchResearch } from '../lib/aiPocketSearch/research';
import { evaluateAiPocketSearchDataset } from '../lib/aiPocketSearch/dataset';
import type { AiPocketSearchRow } from '../lib/aiPocketSearch';

const options = (flags: Record<string, unknown> = {}, argv: string[] = []) =>
  resolveAiPocketSearchCommandOptions({
    argv: ['-m', '5', ...argv],
    flags: {
      recent: 0,
      minSupport: 5,
      scope: 'all',
      objective: 'standalone',
      minProfitFactor: 1,
      maxBatch: 0,
      maxDepth: 1,
      coverageMode: 'auto',
      maxEventCountShare: 1,
      maxSymbolCountShare: 1,
      testSince: 36,
      ...flags,
    },
  });

const rows = (): AiPocketSearchRow[] =>
  Array.from({ length: 60 }, (_, timestamp) => ({
    timestamp,
    exitTimestamp: timestamp,
    signalId: `s${timestamp}`,
    direction: timestamp % 2 === 0 ? 'LONG' : 'SHORT',
    profit: 1,
    profitableTrade: true,
    aiApproved: true,
    quality: 4,
    features: { useful: timestamp % 2 === 0 },
    featureCoverage: { cmc: timestamp < 36, coinalyze: timestamp >= 36 },
  }));

it('parses an explicit UTC ISO or safe epoch ms and retains nominal split metadata', () => {
  const cutoff = Date.parse('2025-03-03T00:00:00Z');
  for (const value of ['2025-03-03T00:00:00Z', String(cutoff), cutoff]) {
    expect(parseAiPocketTestSince(value)).toBe(cutoff);
    const result = options({ testSince: value });
    expect(result).toMatchObject({
      testSince: cutoff,
      testSplit: 0.4,
      validationSplit: 0,
      sealTest: true,
    });
  }
  expect(options({}, ['--testSince=2025-03-03T00:00:00Z']).testSince).toBe(
    cutoff,
  );
});

it.each([
  null,
  undefined,
  '',
  true,
  NaN,
  Infinity,
  -1,
  0,
  1.2,
  'tomorrow',
  '2025-03-03',
  '2025-03-03T00:00:00',
  '2025-02-30T00:00:00Z',
  '2025-03-03T24:00:00Z',
  '99999999999999999999',
])('rejects invalid calendar cutoff %p', (cutoff) => {
  expect(() => parseAiPocketTestSince(cutoff)).toThrow('--testSince');
});

it('rejects ambiguous tuning and preserves positive testSplit seal requirement', () => {
  expect(() => options({}, ['--validationSplit', '0.2'])).toThrow(
    '--validationSplit 0',
  );
  expect(() => options({}, ['--testSplit', '0'])).toThrow(
    'positive --testSplit',
  );
  expect(() => options({}, ['--testSince'])).toThrow('--testSince');
  expect(() =>
    splitAiPocketResearchRowsByTimestamp(rows(), 0.2, 0.4, 36),
  ).toThrow('--validationSplit 0');
});

it('never shifts the boundary for different frequency, direction or timestamp fan-out', () => {
  const original = rows();
  const dense = [
    ...original,
    ...original
      .filter((row) => row.timestamp! < 10)
      .flatMap((row) => Array.from({ length: 8 }, () => ({ ...row }))),
  ];
  for (const sample of [
    original,
    dense,
    original.filter((row) => row.timestamp! % 3 !== 1),
  ]) {
    const split = splitAiPocketResearchRowsByTimestamp(sample, 0, 0.4, 36);
    expect(split.validationRows).toEqual([]);
    expect(split.trainRows.every((row) => row.timestamp! < 36)).toBe(true);
    expect(split.testRows.every((row) => row.timestamp! >= 36)).toBe(true);
    expect(split.testRows.filter((row) => row.timestamp === 36)).toHaveLength(
      sample.filter((row) => row.timestamp === 36).length,
    );
    for (const direction of ['LONG', 'SHORT']) {
      const result = runAiPocketSearchResearch({
        rows: sample,
        options: options({ direction }),
      });
      expect(result.trainRows).toEqual(
        split.trainRows.filter((row) => row.direction === direction),
      );
      expect(result.sealedTest.rows).toBe(
        split.testRows.filter((row) => row.direction === direction).length,
      );
      expect(result.testRows).toEqual([]);
      expect(result.scopeRows.every((row) => row.timestamp! < 36)).toBe(true);
    }
  }
});

it.each([undefined, null, NaN, Infinity])(
  'fails closed for invalid row timestamp %p even in a suppressed direction',
  (timestamp) => {
    const sample = [
      ...rows(),
      { ...rows()[0], timestamp, direction: 'SUPPRESSED' },
    ];
    expect(() =>
      runAiPocketSearchResearch({
        rows: sample,
        options: options({ direction: 'LONG' }),
      }),
    ).toThrow('finite timestamp on every row');
  },
);

it('fails closed for empty calendar partitions and does not move an empty side into discovery', () => {
  expect(() =>
    splitAiPocketResearchRowsByTimestamp(rows(), 0, 0.4, 100),
  ).toThrow('non-empty development and test');
  expect(() =>
    splitAiPocketResearchRowsByTimestamp(rows().slice(40), 0, 0.4, 36),
  ).toThrow('non-empty development and test');
  const sample = rows().map((row) => ({
    ...row,
    direction: row.timestamp! < 36 ? 'LONG' : 'SHORT',
  }));
  for (const direction of ['LONG', 'SHORT']) {
    expect(() =>
      runAiPocketSearchResearch({
        rows: sample,
        options: options({ direction }),
      }),
    ).toThrow(
      'non-empty development and test partitions for the selected direction',
    );
  }
});

it('keeps sealed test labels, feature values, gate decisions and provider sentinel out of all discovery outputs', () => {
  const original = rows();
  const opts = options();
  const baseline = runAiPocketSearchResearch({ rows: original, options: opts });
  const changed = original.map((row) =>
    row.timestamp! < 36
      ? row
      : {
          ...row,
          profit: -999999,
          profitableTrade: false,
          aiApproved: false,
          quality: 1,
          features: { tailOnlySentinel: 987654321 },
          featureCoverage: { cmc: true, coinalyze: false },
        },
  );
  const candidate = runAiPocketSearchResearch({ rows: changed, options: opts });
  expect(candidate).toEqual(baseline);
  expect(JSON.stringify(candidate)).not.toContain('tailOnlySentinel');
  expect(JSON.stringify(candidate)).not.toContain('987654321');
  expect(candidate.currentGateSummary.approved).toBe(36);
  expect(candidate.validationRows).toEqual([]);
  expect(candidate.testRows).toEqual([]);
  expect(candidate.sealedTest).toEqual({
    sealed: true,
    rows: 24,
    events: 24,
    startTimestamp: 36,
    endTimestamp: 59,
  });
  expect(
    candidate.coverageSearches.find((v) => v.family === 'coinalyze')!.trainRows,
  ).toBe(0);
  const stability = candidate.search.positivePockets[0]?.stability;
  expect(stability?.folds).toHaveLength(3);
});

it.each([undefined, null, '36', 'NaN', NaN])(
  'rejects raw filesystem export timestamp %p before date filters or evaluation',
  async (timestamp) => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'pocket-cutoff-'),
    );
    const filePath = path.join(directory, 'fixture.jsonl');
    try {
      await fs.writeFile(
        filePath,
        `${JSON.stringify({
          signalId: 'invalid',
          strategyName: 'LiquidityZones',
          symbol: 'TESTUSDT',
          direction: 'SHORT',
          timestamp,
        })}\n`,
      );
      const progress = jest.fn();
      await expect(
        evaluateAiPocketSearchDataset({
          prepared: {
            filePaths: [filePath],
            totalRows: 1,
            selectedRows: 1,
            sinceTimestamp: 100,
            resolvedStrategyName: 'LiquidityZones',
          },
          options: options({ direction: 'LONG' }),
          onProgress: progress,
        }),
      ).rejects.toThrow('finite numeric timestamp on every export row');
      expect(progress).not.toHaveBeenCalled();
      // The legacy ingestion path still date-skips these malformed rows.
      const legacy = await evaluateAiPocketSearchDataset({
        prepared: {
          filePaths: [filePath],
          totalRows: 1,
          selectedRows: 1,
          sinceTimestamp: 100,
          resolvedStrategyName: 'LiquidityZones',
        },
        options: options({ testSince: null }),
      });
      expect(legacy).toMatchObject({ dateSkipped: 1, failed: 0, rows: [] });
    } finally {
      await fs.rm(directory, { recursive: true });
    }
  },
);

it('purges crossing and unknown development labels before every discovery calculation', () => {
  const base = rows();
  const contaminated: AiPocketSearchRow[] = [
    { ...base[2], signalId: 'crossing', exitTimestamp: 36 },
    { ...base[3], signalId: 'unknown', exitTimestamp: undefined },
    { ...base[4], signalId: 'nonfinite', exitTimestamp: NaN },
  ];
  const original = runAiPocketSearchResearch({
    rows: [...base, ...contaminated],
    options: options(),
  });
  const mutated = runAiPocketSearchResearch({
    rows: [
      ...base,
      ...contaminated.map((row) => ({
        ...row,
        profit: -12345678,
        profitableTrade: false,
        aiApproved: false,
        quality: 1,
        features: { forbiddenFutureLabelSentinel: 12345678 },
      })),
    ],
    options: options(),
  });
  expect(mutated).toEqual(original);
  const baseline = runAiPocketSearchResearch({
    rows: base,
    options: options(),
  });
  expect(original).toEqual({
    ...baseline,
    labelHorizonPurge: { crossing: 1, unknown: 2 },
  });
  expect(JSON.stringify(original)).not.toContain(
    'forbiddenFutureLabelSentinel',
  );
  expect(() =>
    runAiPocketSearchResearch({
      rows: [{ ...base[2], exitTimestamp: 1 }, ...base],
      options: options(),
    }),
  ).toThrow('exitTimestamp >= decision timestamp');
  expect(() =>
    splitAiPocketResearchRowsByTimestamp(
      base.map((row) => ({ ...row, exitTimestamp: undefined })),
      0,
      0.4,
      36,
    ),
  ).toThrow('non-empty development');
  const legacy = splitAiPocketResearchRowsByTimestamp(
    [...base, ...contaminated],
    0,
    0.4,
  );
  expect(legacy.trainRows).toEqual(expect.arrayContaining(contaminated));
});

it('filesystem ingestion purges horizons and retains sealed support without evaluating outcomes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pocket-horizon-'));
  const filePath = path.join(directory, 'fixture.jsonl');
  try {
    const records = [
      { timestamp: 5, tradeResult: { exitTimestamp: 36 } },
      { timestamp: 6 },
      { timestamp: 7, tradeResult: { exitTimestamp: '20' } },
      { timestamp: 40 },
    ].map((row, index) => ({
      ...row,
      signalId: `h${index}`,
      strategyName: 'LiquidityZones',
      symbol: 'TESTUSDT',
      direction: 'SHORT',
      profit: 987654321,
      payload: { futureSentinel: true },
    }));
    await fs.writeFile(
      filePath,
      records.map((row) => JSON.stringify(row)).join('\n'),
    );
    const progress = jest.fn();
    const result = await evaluateAiPocketSearchDataset({
      prepared: {
        filePaths: [filePath],
        totalRows: 4,
        selectedRows: 4,
        sinceTimestamp: null,
        resolvedStrategyName: 'LiquidityZones',
      },
      options: options(),
      onProgress: progress,
    });
    expect(result.labelHorizonPurge).toEqual({ crossing: 1, unknown: 2 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      timestamp: 40,
      profit: 0,
      features: {},
    });
    expect(result.failed).toBe(0);
    expect(progress).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('987654321');
    expect(JSON.stringify(result)).not.toContain('futureSentinel');
  } finally {
    await fs.rm(directory, { recursive: true });
  }
});
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
