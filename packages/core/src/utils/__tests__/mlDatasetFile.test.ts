import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  appendMlDatasetRow,
  closeMlDatasetWriter,
  closeAllMlDatasetWriters,
  flushMlDatasetWriter,
  getMlChunkFilePath,
  listMlChunkFiles,
  mergeJsonlFiles,
  toFileToken,
} from '@tradejs/infra';

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

  it('normalizes file tokens and chunk file path', () => {
    expect(toFileToken('  Trend Line / V2  ')).toBe('trend_line_v2');
    expect(toFileToken('___')).toBe('any');
    expect(getMlChunkFilePath('Trend Line', 'Shard 01', '/tmp/out')).toBe(
      path.join('/tmp/out', 'ml-dataset-trend_line-chunk-shard_01.jsonl'),
    );
  });

  it('supports explicit flush/close no-op for unknown file path', async () => {
    const missing = path.join(tempDir, 'missing.jsonl');
    await expect(flushMlDatasetWriter(missing)).resolves.toBeUndefined();
    await expect(closeMlDatasetWriter(missing)).resolves.toBeUndefined();
  });

  it('flushes batched writes when batch size threshold is reached', async () => {
    const chunkPath = getMlChunkFilePath('TrendLine', 'batch-1', tempDir);
    for (let i = 0; i < 200; i += 1) {
      await appendMlDatasetRow({
        strategyName: 'TrendLine',
        chunkId: 'batch-1',
        outDir: tempDir,
        row: { i },
      });
    }

    // Second close call covers repeated-close branch while state is already closing.
    await Promise.all([
      closeMlDatasetWriter(chunkPath),
      closeMlDatasetWriter(chunkPath),
    ]);

    const content = await fs.readFile(chunkPath, 'utf8');
    expect(content.trim().split('\n')).toHaveLength(200);
  });

  it('lists only matching chunk files and sorts them', async () => {
    await fs.writeFile(
      path.join(tempDir, 'ml-dataset-trendline-chunk-b.jsonl'),
      '{"b":1}\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(tempDir, 'ml-dataset-trendline-chunk-a.jsonl'),
      '{"a":1}\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(tempDir, 'ml-dataset-trendline-merged.jsonl'),
      '{"x":1}\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(tempDir, 'other-file.jsonl'),
      '{"x":2}\n',
      'utf8',
    );

    const files = await listMlChunkFiles({
      strategyName: 'TrendLine',
      outDir: tempDir,
    });

    expect(files).toEqual([
      path.join(tempDir, 'ml-dataset-trendline-chunk-a.jsonl'),
      path.join(tempDir, 'ml-dataset-trendline-chunk-b.jsonl'),
    ]);
  });

  it('returns empty chunk list when output directory does not exist', async () => {
    const files = await listMlChunkFiles({
      strategyName: 'TrendLine',
      outDir: path.join(tempDir, 'not-exists'),
    });

    expect(files).toEqual([]);
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
