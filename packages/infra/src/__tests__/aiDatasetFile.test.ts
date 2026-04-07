import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  appendAiDatasetRow,
  closeAiDatasetWriter,
  closeAllAiDatasetWriters,
  flushAiDatasetWriter,
  getAiChunkFilePath,
  listAiChunkFiles,
  mergeAiJsonlFiles,
  readAiDatasetRows,
  toFileToken,
} from '@tradejs/infra/ai';

describe('aiDatasetFile', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-dataset-'));
  });

  afterEach(async () => {
    await closeAllAiDatasetWriters();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('appends rows into strategy chunk file', async () => {
    await appendAiDatasetRow({
      strategyName: 'TrendLine',
      chunkId: 'chunk-1',
      outDir: tempDir,
      row: {
        signalId: 'a',
        strategyName: 'TrendLine',
        symbol: 'ETHUSDT',
        direction: 'LONG',
        timestamp: 1,
        profit: 1,
        systemPrompt: 's1',
        humanPrompt: 'h1',
      },
    });
    await appendAiDatasetRow({
      strategyName: 'TrendLine',
      chunkId: 'chunk-1',
      outDir: tempDir,
      row: {
        signalId: 'b',
        strategyName: 'TrendLine',
        symbol: 'BTCUSDT',
        direction: 'SHORT',
        timestamp: 2,
        profit: -1,
        systemPrompt: 's2',
        humanPrompt: 'h2',
      },
    });
    await closeAllAiDatasetWriters();

    const files = await listAiChunkFiles({
      strategyName: 'TrendLine',
      outDir: tempDir,
    });
    expect(files).toHaveLength(1);
    const content = await fs.readFile(files[0], 'utf8');
    expect(content.trim().split('\n')).toHaveLength(2);
  });

  it('normalizes file tokens and chunk file path', () => {
    expect(toFileToken('  Trend Line / V2  ')).toBe('trend_line_v2');
    expect(getAiChunkFilePath('Trend Line', 'Shard 01', '/tmp/out')).toBe(
      path.join('/tmp/out', 'ai-dataset-trend_line-chunk-shard_01.jsonl'),
    );
  });

  it('supports explicit flush/close no-op for unknown file path', async () => {
    const missing = path.join(tempDir, 'missing.jsonl');
    await expect(flushAiDatasetWriter(missing)).resolves.toBeUndefined();
    await expect(closeAiDatasetWriter(missing)).resolves.toBeUndefined();
  });

  it('merges chunk files and reads only recent rows from tail', async () => {
    const chunkA = path.join(tempDir, 'ai-dataset-trendline-a.jsonl');
    const chunkB = path.join(tempDir, 'ai-dataset-trendline-b.jsonl');
    await fs.writeFile(
      chunkA,
      [
        JSON.stringify({
          signalId: 'a',
          strategyName: 'TrendLine',
          symbol: 'ETHUSDT',
          direction: 'LONG',
          timestamp: 1,
          profit: 1,
          systemPrompt: 'sa',
          humanPrompt: 'ha',
        }),
        JSON.stringify({
          signalId: 'b',
          strategyName: 'TrendLine',
          symbol: 'BTCUSDT',
          direction: 'SHORT',
          timestamp: 2,
          profit: -1,
          systemPrompt: 'sb',
          humanPrompt: 'hb',
        }),
      ].join('\n') + '\n',
      'utf8',
    );
    await fs.writeFile(
      chunkB,
      JSON.stringify({
        signalId: 'c',
        strategyName: 'TrendLine',
        symbol: 'SOLUSDT',
        direction: 'LONG',
        timestamp: 3,
        profit: 3,
        systemPrompt: 'sc',
        humanPrompt: 'hc',
      }) + '\n',
      'utf8',
    );

    const merged = path.join(tempDir, 'ai-dataset-trendline-merged.jsonl');
    await mergeAiJsonlFiles({ filePaths: [chunkA, chunkB], outPath: merged });

    const parseSpy = jest.spyOn(JSON, 'parse');
    let allRows: Awaited<ReturnType<typeof readAiDatasetRows>>;
    let recentRows: Awaited<ReturnType<typeof readAiDatasetRows>>;
    try {
      allRows = await readAiDatasetRows({ filePath: merged });
      expect(parseSpy).toHaveBeenCalledTimes(3);

      parseSpy.mockClear();
      recentRows = await readAiDatasetRows({
        filePath: merged,
        limitFromEnd: 2,
      });
      expect(parseSpy).toHaveBeenCalledTimes(2);
    } finally {
      parseSpy.mockRestore();
    }

    expect(allRows.totalRows).toBe(3);
    expect(allRows.rows).toHaveLength(3);
    expect(recentRows.totalRows).toBe(3);
    expect(recentRows.rows.map((row) => row.signalId)).toEqual(['b', 'c']);
  });

  it('supports skipping rows from the end before selecting recent rows', async () => {
    const merged = path.join(tempDir, 'ai-dataset-trendline-windowed.jsonl');
    await fs.writeFile(
      merged,
      [
        {
          signalId: 'a',
          symbol: 'BTCUSDT',
          strategyName: 'TrendLine',
          direction: 'LONG',
          timestamp: 1,
          profit: 1,
          systemPrompt: 'sa',
          humanPrompt: 'ha',
        },
        {
          signalId: 'b',
          symbol: 'ETHUSDT',
          strategyName: 'TrendLine',
          direction: 'LONG',
          timestamp: 2,
          profit: 2,
          systemPrompt: 'sb',
          humanPrompt: 'hb',
        },
        {
          signalId: 'c',
          symbol: 'SOLUSDT',
          strategyName: 'TrendLine',
          direction: 'LONG',
          timestamp: 3,
          profit: 3,
          systemPrompt: 'sc',
          humanPrompt: 'hc',
        },
        {
          signalId: 'd',
          symbol: 'XRPUSDT',
          strategyName: 'TrendLine',
          direction: 'LONG',
          timestamp: 4,
          profit: 4,
          systemPrompt: 'sd',
          humanPrompt: 'hd',
        },
        {
          signalId: 'e',
          symbol: 'ADAUSDT',
          strategyName: 'TrendLine',
          direction: 'LONG',
          timestamp: 5,
          profit: 5,
          systemPrompt: 'se',
          humanPrompt: 'he',
        },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n') + '\n',
      'utf8',
    );

    const parseSpy = jest.spyOn(JSON, 'parse');
    let windowedRows: Awaited<ReturnType<typeof readAiDatasetRows>>;
    try {
      windowedRows = await readAiDatasetRows({
        filePath: merged,
        limitFromEnd: 2,
        skipFromEnd: 2,
      });
      expect(parseSpy).toHaveBeenCalledTimes(2);
    } finally {
      parseSpy.mockRestore();
    }

    expect(windowedRows.totalRows).toBe(5);
    expect(windowedRows.rows.map((row) => row.signalId)).toEqual(['b', 'c']);
  });
});
