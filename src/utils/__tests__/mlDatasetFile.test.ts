import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  appendMlDatasetRow,
  closeAllMlDatasetWriters,
  listMlChunkFiles,
  mergeJsonlFiles,
} from '../mlDatasetFile';

describe('mlDatasetFile', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ml-dataset-'));
  });

  afterEach(async () => {
    await closeAllMlDatasetWriters();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('appends rows into strategy chunk file', async () => {
    await appendMlDatasetRow({
      strategyName: 'TrendLine',
      chunkId: 'chunk-1',
      outDir: tempDir,
      row: { symbol: 'ETHUSDT', label: 1 },
    });
    await appendMlDatasetRow({
      strategyName: 'TrendLine',
      chunkId: 'chunk-1',
      outDir: tempDir,
      row: { symbol: 'BTCUSDT', label: 0 },
    });
    await closeAllMlDatasetWriters();

    const files = await listMlChunkFiles({
      strategyName: 'TrendLine',
      outDir: tempDir,
    });
    expect(files).toHaveLength(1);
    const content = await fs.readFile(files[0], 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('merges chunk files line-by-line into single dataset', async () => {
    const chunkA = path.join(tempDir, 'ml-dataset-trendline-a.jsonl');
    const chunkB = path.join(tempDir, 'ml-dataset-trendline-b.jsonl');
    await fs.writeFile(chunkA, '{"a":1}\n{"a":2}\n', 'utf8');
    await fs.writeFile(chunkB, '{"b":1}\n', 'utf8');

    const merged = path.join(tempDir, 'ml-dataset-trendline-merged.jsonl');
    await mergeJsonlFiles({ filePaths: [chunkA, chunkB], outPath: merged });

    const content = await fs.readFile(merged, 'utf8');
    expect(content).toBe('{"a":1}\n{"a":2}\n{"b":1}\n');
  });
});
