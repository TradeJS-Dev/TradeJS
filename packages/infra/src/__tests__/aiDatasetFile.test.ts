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

    const allRows = await readAiDatasetRows({ filePath: merged });
    const recentRows = await readAiDatasetRows({
      filePath: merged,
      limitFromEnd: 2,
    });

    expect(allRows.totalRows).toBe(3);
    expect(allRows.rows).toHaveLength(3);
    expect(recentRows.totalRows).toBe(3);
    expect(recentRows.rows.map((row) => row.signalId)).toEqual(['b', 'c']);
  });
});
