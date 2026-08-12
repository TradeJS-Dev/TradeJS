import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  appendAiDatasetRow,
  countAiDatasetRows,
  closeAiDatasetWriter,
  closeAllAiDatasetWriters,
  flushAiDatasetWriter,
  getAiChunkFilePath,
  listAiChunkFiles,
  listAiChunkRunIds,
  listAiChunkStrategies,
  mergeAiJsonlFiles,
  readAiDatasetRows,
  streamAiDatasetRows,
  toFileToken,
} from '@tradejs/infra/ai';

const makePayload = ({
  signalId,
  symbol,
  direction,
  timestamp,
  strategyName = 'TrendLine',
}: {
  signalId: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  timestamp: number;
  strategyName?: string;
}) => ({
  signal: {
    symbol,
    signalId,
    interval: '15' as const,
    direction,
    timestamp,
    strategy: strategyName,
    prices: {
      currentPrice: 100,
      takeProfitPrice: direction === 'LONG' ? 103 : 97,
      stopLossPrice: direction === 'LONG' ? 99 : 101,
    },
  },
  figures: {},
  indicators: {},
  additionalIndicators: {},
});

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
        payload: makePayload({
          signalId: 'a',
          symbol: 'ETHUSDT',
          direction: 'LONG',
          timestamp: 1,
        }),
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
        payload: makePayload({
          signalId: 'b',
          symbol: 'BTCUSDT',
          direction: 'SHORT',
          timestamp: 2,
        }),
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

  it('preserves concurrent first rows for the same chunk file', async () => {
    const rows = [
      { signalId: 'first', symbol: 'ETHUSDT' },
      { signalId: 'second', symbol: 'BTCUSDT' },
    ].map(({ signalId, symbol }, index) => ({
      signalId,
      strategyName: 'TrendLine',
      symbol,
      direction: 'LONG' as const,
      timestamp: index + 1,
      profit: 1,
      payload: makePayload({
        signalId,
        symbol,
        direction: 'LONG',
        timestamp: index + 1,
      }),
    }));
    const appendRow = (chunkId: string, row: (typeof rows)[number]) =>
      appendAiDatasetRow({
        strategyName: 'TrendLine',
        chunkId,
        outDir: tempDir,
        row,
      });

    for (const row of rows) {
      await appendRow('sequential-chunk', row);
    }
    const sequentialPath = getAiChunkFilePath(
      'TrendLine',
      'sequential-chunk',
      tempDir,
    );
    await closeAiDatasetWriter(sequentialPath);

    await Promise.all(rows.map((row) => appendRow('concurrent-chunk', row)));
    const concurrentPath = getAiChunkFilePath(
      'TrendLine',
      'concurrent-chunk',
      tempDir,
    );
    await closeAiDatasetWriter(concurrentPath);

    const [sequentialContent, concurrentContent] = await Promise.all([
      fs.readFile(sequentialPath, 'utf8'),
      fs.readFile(concurrentPath, 'utf8'),
    ]);
    expect(concurrentContent).toBe(sequentialContent);
    const serializedRows = concurrentContent
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(serializedRows.map((row) => row.signalId)).toEqual([
      'first',
      'second',
    ]);
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

  it('lists unique AI chunk strategies found in directory', async () => {
    await fs.writeFile(
      path.join(tempDir, 'ai-dataset-volumedivergence-chunk-b.jsonl'),
      '{"b":1}\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(tempDir, 'ai-dataset-trendline-chunk-a.jsonl'),
      '{"a":1}\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(tempDir, 'ai-dataset-trendline-merged.jsonl'),
      '{"x":1}\n',
      'utf8',
    );

    await expect(
      listAiChunkStrategies({
        outDir: tempDir,
      }),
    ).resolves.toEqual(['trendline', 'volumedivergence']);
  });

  it('lists and filters run-scoped AI chunk files', async () => {
    await fs.writeFile(
      path.join(
        tempDir,
        'ai-dataset-trendline-chunk-202606201200-aaaaaaaa-old.jsonl',
      ),
      '{"a":1}\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(
        tempDir,
        'ai-dataset-trendline-chunk-202606201201-bbbbbbbb-new.jsonl',
      ),
      '{"b":1}\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(tempDir, 'ai-dataset-trendline-chunk-legacy.jsonl'),
      '{"legacy":1}\n',
      'utf8',
    );

    await expect(
      listAiChunkRunIds({ strategyName: 'TrendLine', outDir: tempDir }),
    ).resolves.toEqual(['202606201200-aaaaaaaa', '202606201201-bbbbbbbb']);
    await expect(
      listAiChunkFiles({
        strategyName: 'TrendLine',
        outDir: tempDir,
        runId: '202606201201-bbbbbbbb',
      }),
    ).resolves.toEqual([
      path.join(
        tempDir,
        'ai-dataset-trendline-chunk-202606201201-bbbbbbbb-new.jsonl',
      ),
    ]);
  });

  it('merges chunk files in chronological order and reads recent rows from tail', async () => {
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
          timestamp: 3,
          profit: 1,
          payload: makePayload({
            signalId: 'a',
            symbol: 'ETHUSDT',
            direction: 'LONG',
            timestamp: 3,
          }),
        }),
        JSON.stringify({
          signalId: 'b',
          strategyName: 'TrendLine',
          symbol: 'BTCUSDT',
          direction: 'SHORT',
          timestamp: 1,
          profit: -1,
          payload: makePayload({
            signalId: 'b',
            symbol: 'BTCUSDT',
            direction: 'SHORT',
            timestamp: 1,
          }),
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
        timestamp: 2,
        profit: 3,
        payload: makePayload({
          signalId: 'c',
          symbol: 'SOLUSDT',
          direction: 'LONG',
          timestamp: 2,
        }),
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
    expect(allRows.rows.map((row) => row.signalId)).toEqual(['b', 'c', 'a']);
    expect(recentRows.totalRows).toBe(3);
    expect(recentRows.rows.map((row) => row.signalId)).toEqual(['c', 'a']);
  });

  it('counts and streams selected rows without loading the whole file into memory', async () => {
    const merged = path.join(tempDir, 'ai-dataset-trendline-windowed.jsonl');
    await fs.writeFile(
      merged,
      [
        { signalId: 'a', timestamp: 1 },
        { signalId: 'b', timestamp: 2 },
        { signalId: 'c', timestamp: 3 },
        { signalId: 'd', timestamp: 4 },
      ]
        .map((entry) =>
          JSON.stringify({
            strategyName: 'TrendLine',
            symbol: 'ETHUSDT',
            direction: 'LONG',
            profit: 1,
            payload: makePayload({
              signalId: entry.signalId,
              symbol: 'ETHUSDT',
              direction: 'LONG',
              timestamp: entry.timestamp,
            }),
            ...entry,
          }),
        )
        .join('\n') + '\n',
      'utf8',
    );

    await expect(
      countAiDatasetRows({
        filePath: merged,
        limitFromEnd: 2,
        skipFromEnd: 1,
      }),
    ).resolves.toEqual({
      totalRows: 4,
      selectedRows: 2,
    });

    const streamedSignalIds: string[] = [];
    await streamAiDatasetRows({
      filePath: merged,
      limitFromEnd: 2,
      skipFromEnd: 1,
      onRow: (row) => {
        streamedSignalIds.push(row.signalId);
      },
    });
    expect(streamedSignalIds).toEqual(['b', 'c']);
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
          payload: makePayload({
            signalId: 'a',
            symbol: 'BTCUSDT',
            direction: 'LONG',
            timestamp: 1,
          }),
        },
        {
          signalId: 'b',
          symbol: 'ETHUSDT',
          strategyName: 'TrendLine',
          direction: 'LONG',
          timestamp: 2,
          profit: 2,
          payload: makePayload({
            signalId: 'b',
            symbol: 'ETHUSDT',
            direction: 'LONG',
            timestamp: 2,
          }),
        },
        {
          signalId: 'c',
          symbol: 'SOLUSDT',
          strategyName: 'TrendLine',
          direction: 'LONG',
          timestamp: 3,
          profit: 3,
          payload: makePayload({
            signalId: 'c',
            symbol: 'SOLUSDT',
            direction: 'LONG',
            timestamp: 3,
          }),
        },
        {
          signalId: 'd',
          symbol: 'XRPUSDT',
          strategyName: 'TrendLine',
          direction: 'LONG',
          timestamp: 4,
          profit: 4,
          payload: makePayload({
            signalId: 'd',
            symbol: 'XRPUSDT',
            direction: 'LONG',
            timestamp: 4,
          }),
        },
        {
          signalId: 'e',
          symbol: 'ADAUSDT',
          strategyName: 'TrendLine',
          direction: 'LONG',
          timestamp: 5,
          profit: 5,
          payload: makePayload({
            signalId: 'e',
            symbol: 'ADAUSDT',
            direction: 'LONG',
            timestamp: 5,
          }),
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

  it('merges AI chunk files with external sort when in-memory run size is small', async () => {
    const chunkA = path.join(tempDir, 'ai-dataset-volumedivergence-a.jsonl');
    const chunkB = path.join(tempDir, 'ai-dataset-volumedivergence-b.jsonl');

    await fs.writeFile(
      chunkA,
      [
        {
          signalId: 'e',
          symbol: 'ETHUSDT',
          strategyName: 'VolumeDivergence',
          direction: 'LONG',
          timestamp: 5,
          profit: 5,
          payload: makePayload({
            signalId: 'e',
            symbol: 'ETHUSDT',
            direction: 'LONG',
            timestamp: 5,
            strategyName: 'VolumeDivergence',
          }),
        },
        {
          signalId: 'a',
          symbol: 'BTCUSDT',
          strategyName: 'VolumeDivergence',
          direction: 'LONG',
          timestamp: 1,
          profit: 1,
          payload: makePayload({
            signalId: 'a',
            symbol: 'BTCUSDT',
            direction: 'LONG',
            timestamp: 1,
            strategyName: 'VolumeDivergence',
          }),
        },
        {
          signalId: 'd',
          symbol: 'ADAUSDT',
          strategyName: 'VolumeDivergence',
          direction: 'LONG',
          timestamp: 4,
          profit: 4,
          payload: makePayload({
            signalId: 'd',
            symbol: 'ADAUSDT',
            direction: 'LONG',
            timestamp: 4,
            strategyName: 'VolumeDivergence',
          }),
        },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n') + '\n',
      'utf8',
    );

    await fs.writeFile(
      chunkB,
      [
        {
          signalId: 'c',
          symbol: 'SOLUSDT',
          strategyName: 'VolumeDivergence',
          direction: 'SHORT',
          timestamp: 3,
          profit: -3,
          payload: makePayload({
            signalId: 'c',
            symbol: 'SOLUSDT',
            direction: 'SHORT',
            timestamp: 3,
            strategyName: 'VolumeDivergence',
          }),
        },
        {
          signalId: 'b',
          symbol: 'BNBUSDT',
          strategyName: 'VolumeDivergence',
          direction: 'SHORT',
          timestamp: 2,
          profit: -2,
          payload: makePayload({
            signalId: 'b',
            symbol: 'BNBUSDT',
            direction: 'SHORT',
            timestamp: 2,
            strategyName: 'VolumeDivergence',
          }),
        },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n') + '\n',
      'utf8',
    );

    const merged = path.join(
      tempDir,
      'ai-dataset-volumedivergence-merged.jsonl',
    );
    await mergeAiJsonlFiles({
      filePaths: [chunkA, chunkB],
      outPath: merged,
      maxRowsInMemory: 2,
      maxBytesInMemory: 256,
    });

    const mergedRows = await readAiDatasetRows({ filePath: merged });
    expect(mergedRows.rows.map((row) => row.signalId)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('merges sorted runs in bounded fan-in passes', async () => {
    const chunkPaths: string[] = [];
    const timestamps = [7, 1, 6, 2, 5, 3, 4];

    for (const timestamp of timestamps) {
      const chunkPath = path.join(
        tempDir,
        `ai-dataset-trendfollow-${timestamp}.jsonl`,
      );
      chunkPaths.push(chunkPath);
      await fs.writeFile(
        chunkPath,
        JSON.stringify({
          signalId: `signal-${timestamp}`,
          strategyName: 'TrendFollow',
          symbol: 'ETHUSDT',
          direction: 'LONG',
          timestamp,
          profit: timestamp,
          payload: makePayload({
            signalId: `signal-${timestamp}`,
            symbol: 'ETHUSDT',
            direction: 'LONG',
            timestamp,
            strategyName: 'TrendFollow',
          }),
        }) + '\n',
        'utf8',
      );
    }

    const merged = path.join(tempDir, 'ai-dataset-trendfollow-merged.jsonl');
    await mergeAiJsonlFiles({
      filePaths: chunkPaths,
      outPath: merged,
      maxRowsInMemory: 1,
      maxBytesInMemory: 128,
      maxOpenRuns: 2,
    });

    const mergedRows = await readAiDatasetRows({ filePath: merged });
    expect(mergedRows.rows.map((row) => row.signalId)).toEqual([
      'signal-1',
      'signal-2',
      'signal-3',
      'signal-4',
      'signal-5',
      'signal-6',
      'signal-7',
    ]);
  });

  it('filters orphan AI rows while merging checkpointed attempts', async () => {
    const oldChunk = path.join(
      tempDir,
      'ai-dataset-trendfollow-chunk-202606201200-aaaaaaaa-old.jsonl',
    );
    const newChunk = path.join(
      tempDir,
      'ai-dataset-trendfollow-chunk-202606201200-aaaaaaaa-new.jsonl',
    );
    const makeRow = ({
      chunkId,
      signalId,
      timestamp,
    }: {
      chunkId: string;
      signalId: string;
      timestamp: number;
    }) => ({
      signalId,
      strategyName: 'TrendFollow',
      symbol: 'ETHUSDT',
      direction: 'LONG' as const,
      timestamp,
      profit: timestamp,
      backtestRunId: '202606201200-aaaaaaaa',
      backtestTestKey: 'test-key',
      backtestChunkId: chunkId,
      payload: makePayload({
        signalId,
        symbol: 'ETHUSDT',
        direction: 'LONG',
        timestamp,
        strategyName: 'TrendFollow',
      }),
    });
    await fs.writeFile(
      oldChunk,
      JSON.stringify(
        makeRow({ chunkId: 'old', signalId: 'old', timestamp: 1 }),
      ) + '\n',
      'utf8',
    );
    await fs.writeFile(
      newChunk,
      JSON.stringify(
        makeRow({ chunkId: 'new', signalId: 'new', timestamp: 2 }),
      ) + '\n',
      'utf8',
    );

    const merged = path.join(tempDir, 'ai-dataset-trendfollow-merged.jsonl');
    await mergeAiJsonlFiles({
      filePaths: [oldChunk, newChunk],
      outPath: merged,
      shouldIncludeRow: (row) =>
        `${row.backtestTestKey}:${row.backtestChunkId}` === 'test-key:new',
    });

    const mergedRows = await readAiDatasetRows({ filePath: merged });
    expect(mergedRows.rows.map((row) => row.signalId)).toEqual(['new']);
  });
});
