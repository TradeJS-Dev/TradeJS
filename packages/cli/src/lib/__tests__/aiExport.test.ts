import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { listAiChunkFiles } from '@tradejs/infra/ai';
import {
  exportAiStrategiesSequentially,
  exportAiStrategy,
  type AiExportProgress,
  type AiExportStrategyResult,
} from '../aiExport';

type FixtureRow = {
  signalId: string;
  strategyName: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  timestamp: number;
  profit: number;
};

const createFixtureRows = (
  strategyName: string,
  entries: Array<Pick<FixtureRow, 'signalId' | 'timestamp'>>,
): FixtureRow[] =>
  entries.map(({ signalId, timestamp }, index) => ({
    signalId,
    strategyName,
    symbol: index % 2 === 0 ? 'ETHUSDT' : 'BTCUSDT',
    direction: index % 2 === 0 ? 'LONG' : 'SHORT',
    timestamp,
    profit: index + 1,
  }));

const writeFixture = async (outDir: string) => {
  await fs.mkdir(outDir, { recursive: true });
  const january = Date.UTC(2026, 0, 15);
  const february = Date.UTC(2026, 1, 15);
  const fixtures = {
    alpha: [
      createFixtureRows('alpha', [
        { signalId: 'alpha-3', timestamp: february + 2 },
        { signalId: 'alpha-1', timestamp: january + 1 },
      ]),
      createFixtureRows('alpha', [
        { signalId: 'alpha-2', timestamp: january + 2 },
      ]),
    ],
    beta: [
      createFixtureRows('beta', [
        { signalId: 'beta-2', timestamp: february + 1 },
        { signalId: 'beta-1', timestamp: january + 3 },
      ]),
    ],
  };

  for (const [strategyName, chunks] of Object.entries(fixtures)) {
    for (let index = 0; index < chunks.length; index += 1) {
      await fs.writeFile(
        path.join(
          outDir,
          `ai-dataset-${strategyName}-chunk-${index + 1}.jsonl`,
        ),
        `${chunks[index].map((row) => JSON.stringify(row)).join('\n')}\n`,
        'utf8',
      );
    }
  }
};

const readResultRows = async (result: AiExportStrategyResult) => {
  const rows: FixtureRow[] = [];
  for (const filePath of result.partPaths) {
    const content = await fs.readFile(filePath, 'utf8');
    rows.push(
      ...content
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as FixtureRow),
    );
  }
  return rows;
};

describe('AI export sequencing', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-export-all-'));
  });

  afterEach(async () => {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('exports all strategies exactly like separate sequential exports without mixing or losing rows', async () => {
    const allDir = path.join(tempRoot, 'all');
    const separateDir = path.join(tempRoot, 'separate');
    await writeFixture(allDir);
    await writeFixture(separateDir);
    const strategyNames = ['alpha', 'beta'];
    const progress: AiExportProgress[] = [];
    const sharedOptions = {
      keepChunks: false,
      now: () => 123456789,
      partMonths: 1,
      requestedRunId: undefined,
      userName: 'root',
    };

    const allResults = await exportAiStrategiesSequentially({
      ...sharedOptions,
      outDir: allDir,
      strategyNames,
      onProgress: (event) => progress.push(event),
    });
    const separateResults = [];
    for (const strategyName of strategyNames) {
      const result = await exportAiStrategy({
        ...sharedOptions,
        outDir: separateDir,
        strategyName,
      });
      expect(result).not.toBeNull();
      separateResults.push(result!);
    }

    expect(allResults).toHaveLength(separateResults.length);
    for (let index = 0; index < allResults.length; index += 1) {
      const allRows = await readResultRows(allResults[index]);
      const separateRows = await readResultRows(separateResults[index]);

      expect(allRows).toEqual(separateRows);
      expect(allRows).toHaveLength(index === 0 ? 3 : 2);
      expect(new Set(allRows.map((row) => row.strategyName))).toEqual(
        new Set([strategyNames[index]]),
      );
      expect(allResults[index].partCount).toBe(
        separateResults[index].partCount,
      );
      expect(allResults[index].sourceChunkCount).toBe(
        separateResults[index].sourceChunkCount,
      );
    }

    await expect(
      listAiChunkFiles({ outDir: allDir, strategyName: 'alpha' }),
    ).resolves.toEqual([]);
    await expect(
      listAiChunkFiles({ outDir: allDir, strategyName: 'beta' }),
    ).resolves.toEqual([]);
    expect(progress).toEqual([
      {
        strategyName: 'alpha',
        current: 0,
        total: 2,
        status: 'started',
      },
      {
        strategyName: 'alpha',
        current: 1,
        total: 2,
        status: 'completed',
      },
      {
        strategyName: 'beta',
        current: 1,
        total: 2,
        status: 'started',
      },
      {
        strategyName: 'beta',
        current: 2,
        total: 2,
        status: 'completed',
      },
    ]);
  });

  it('never overlaps strategy exporters', async () => {
    let activeExports = 0;
    let maxActiveExports = 0;
    const completed: string[] = [];
    const exportStrategy = jest.fn(
      async ({
        strategyName,
      }: {
        strategyName: string;
      }): Promise<AiExportStrategyResult> => {
        activeExports += 1;
        maxActiveExports = Math.max(maxActiveExports, activeExports);
        await new Promise((resolve) => setImmediate(resolve));
        completed.push(strategyName);
        activeExports -= 1;
        return {
          strategyName,
          sourceChunkCount: 1,
          deleteChunks: false,
          partMonths: 0,
          partPaths: [`${strategyName}.jsonl`],
          partCount: 1,
          splitApplied: false,
        };
      },
    );

    await exportAiStrategiesSequentially(
      {
        outDir: '/unused',
        strategyNames: ['alpha', 'beta', 'gamma'],
        keepChunks: true,
        partMonths: 0,
        userName: 'root',
      },
      { exportStrategy },
    );

    expect(completed).toEqual(['alpha', 'beta', 'gamma']);
    expect(maxActiveExports).toBe(1);
  });
});
