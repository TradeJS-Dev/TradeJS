import { once } from 'events';
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import type { AiDatasetRow } from '@tradejs/types';
import { mergeJsonlFiles, toFileToken } from './mlDatasetFile';

const DEFAULT_DIR = 'data/ai/export';
const AI_DATASET_WRITE_BATCH_SIZE = 100;
const AI_MERGE_SORT_RUN_MAX_ROWS = 2_000;
const AI_MERGE_SORT_RUN_MAX_BYTES = 16 * 1024 * 1024;
const AI_CHUNK_FILE_RE = /^ai-dataset-(.+)-chunk-[^.]+\.jsonl$/;

type WriterState = {
  filePath: string;
  stream: ReturnType<typeof createWriteStream>;
  buffer: string[];
  writeQueue: Promise<void>;
  closed: boolean;
};

type AiDatasetSortKey = {
  timestamp: number;
  symbol: string;
  signalId: string;
};

type SortableAiDatasetLine = {
  line: string;
  sortKey: AiDatasetSortKey;
  sourceIndex: number;
};

type SortedRunHead = {
  runIndex: number;
  line: string;
  sortKey: AiDatasetSortKey;
  iterator: AsyncIterator<string>;
  reader: readline.Interface;
};

const writerByPath = new Map<string, WriterState>();

export { mergeJsonlFiles, toFileToken };

export const getAiChunkFilePath = (
  strategyName: string,
  chunkId: string,
  outDir = DEFAULT_DIR,
) =>
  path.join(
    outDir,
    `ai-dataset-${toFileToken(strategyName)}-chunk-${toFileToken(chunkId)}.jsonl`,
  );

export const appendAiDatasetRow = async (params: {
  strategyName: string;
  chunkId: string;
  row: AiDatasetRow;
  outDir?: string;
}) => {
  const { strategyName, chunkId, row, outDir = DEFAULT_DIR } = params;
  const filePath = getAiChunkFilePath(strategyName, chunkId, outDir);
  let state = writerByPath.get(filePath);
  if (!state) {
    await fs.mkdir(outDir, { recursive: true });
    const stream = createWriteStream(filePath, {
      encoding: 'utf8',
      flags: 'a',
    });
    state = {
      filePath,
      stream,
      buffer: [],
      writeQueue: Promise.resolve(),
      closed: false,
    };
    writerByPath.set(filePath, state);
  }
  if (state.closed) {
    throw new Error(`AI dataset writer is closed: ${filePath}`);
  }

  state.buffer.push(`${JSON.stringify(row)}\n`);
  if (state.buffer.length >= AI_DATASET_WRITE_BATCH_SIZE) {
    await flushAiDatasetWriter(filePath);
  }
  return filePath;
};

const flushState = async (state: WriterState) => {
  if (state.closed || state.buffer.length === 0) {
    return;
  }
  const chunk = state.buffer.join('');
  state.buffer = [];
  if (!state.stream.write(chunk)) {
    await once(state.stream, 'drain');
  }
};

export const flushAiDatasetWriter = async (filePath: string) => {
  const state = writerByPath.get(filePath);
  if (!state || state.closed) {
    return;
  }
  state.writeQueue = state.writeQueue.then(() => flushState(state));
  await state.writeQueue;
};

const closeState = async (state: WriterState) => {
  if (state.closed) {
    return;
  }
  await flushState(state);
  state.closed = true;
  state.stream.end();
  await Promise.all([
    once(state.stream, 'finish'),
    once(state.stream, 'close'),
  ]);
};

export const closeAiDatasetWriter = async (filePath: string) => {
  const state = writerByPath.get(filePath);
  if (!state) {
    return;
  }
  state.writeQueue = state.writeQueue.then(() => closeState(state));
  await state.writeQueue;
  writerByPath.delete(filePath);
};

export const closeAllAiDatasetWriters = async () => {
  const filePaths = [...writerByPath.keys()];
  for (const filePath of filePaths) {
    await closeAiDatasetWriter(filePath);
  }
};

export const listAiChunkFiles = async (params: {
  strategyName: string;
  outDir?: string;
}) => {
  const { strategyName, outDir = DEFAULT_DIR } = params;
  const prefix = `ai-dataset-${toFileToken(strategyName)}-chunk-`;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(outDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.startsWith(prefix) && name.endsWith('.jsonl'))
    .map((name) => path.join(outDir, name))
    .sort();
};

export const listAiChunkStrategies = async (params?: { outDir?: string }) => {
  const outDir = params?.outDir ?? DEFAULT_DIR;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(outDir);
  } catch {
    return [];
  }

  return [
    ...new Set(
      entries
        .map((name) => name.match(AI_CHUNK_FILE_RE)?.[1] || '')
        .filter(Boolean),
    ),
  ].sort();
};

const parseAiDatasetLine = (line: string, filePath: string): AiDatasetRow => {
  try {
    return JSON.parse(line) as AiDatasetRow;
  } catch (error) {
    const message = (error as Error)?.message || String(error);
    throw new Error(
      `Failed to parse AI dataset row from ${filePath}: ${message}`,
    );
  }
};

const getAiDatasetSortKey = (row: AiDatasetRow): AiDatasetSortKey => {
  const timestamp = Number(row.timestamp);

  return {
    timestamp: Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER,
    symbol: String(row.symbol || ''),
    signalId: String(row.signalId || ''),
  };
};

const compareAiDatasetSortKeys = (
  left: AiDatasetSortKey,
  right: AiDatasetSortKey,
) => {
  if (left.timestamp !== right.timestamp) {
    return left.timestamp - right.timestamp;
  }

  const symbolCompare = left.symbol.localeCompare(right.symbol);
  if (symbolCompare !== 0) {
    return symbolCompare;
  }

  return left.signalId.localeCompare(right.signalId);
};

const compareSortableAiDatasetLines = (
  left: SortableAiDatasetLine,
  right: SortableAiDatasetLine,
) => {
  const keyCompare = compareAiDatasetSortKeys(left.sortKey, right.sortKey);
  if (keyCompare !== 0) {
    return keyCompare;
  }

  return left.sourceIndex - right.sourceIndex;
};

const compareSortedRunHeads = (left: SortedRunHead, right: SortedRunHead) => {
  const keyCompare = compareAiDatasetSortKeys(left.sortKey, right.sortKey);
  if (keyCompare !== 0) {
    return keyCompare;
  }

  return left.runIndex - right.runIndex;
};

const writeJsonlLines = async (params: {
  filePath: string;
  lines: string[];
}) => {
  const { filePath, lines } = params;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const stream = createWriteStream(filePath, { encoding: 'utf8' });
  const done = Promise.all([once(stream, 'finish'), once(stream, 'close')]);

  try {
    for (const line of lines) {
      if (!stream.write(`${line}\n`)) {
        await once(stream, 'drain');
      }
    }
  } finally {
    stream.end();
    await done;
  }
};

const flushSortedRun = async (params: {
  tempDir: string;
  runIndex: number;
  entries: SortableAiDatasetLine[];
}) => {
  const { tempDir, runIndex, entries } = params;
  entries.sort(compareSortableAiDatasetLines);

  const filePath = path.join(
    tempDir,
    `run-${String(runIndex).padStart(6, '0')}.jsonl`,
  );
  await writeJsonlLines({
    filePath,
    lines: entries.map(({ line }) => line),
  });

  return filePath;
};

const readNextNonEmptyLine = async (
  iterator: AsyncIterator<string>,
): Promise<string | null> => {
  while (true) {
    const next = await iterator.next();
    if (next.done) {
      return null;
    }

    const trimmed = String(next.value || '').trim();
    if (trimmed) {
      return trimmed;
    }
  }
};

const mergeSortedRuns = async (params: {
  runPaths: string[];
  outPath: string;
}) => {
  const { runPaths, outPath } = params;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const output = createWriteStream(outPath, { encoding: 'utf8' });
  const outputDone = Promise.all([
    once(output, 'finish'),
    once(output, 'close'),
  ]);
  const heads: SortedRunHead[] = [];

  try {
    for (let runIndex = 0; runIndex < runPaths.length; runIndex += 1) {
      const runPath = runPaths[runIndex];
      const reader = readline.createInterface({
        input: createReadStream(runPath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });
      const iterator = reader[Symbol.asyncIterator]();
      const line = await readNextNonEmptyLine(iterator);

      if (!line) {
        reader.close();
        continue;
      }

      heads.push({
        runIndex,
        line,
        sortKey: getAiDatasetSortKey(parseAiDatasetLine(line, runPath)),
        iterator,
        reader,
      });
    }

    while (heads.length > 0) {
      let bestIndex = 0;

      for (let index = 1; index < heads.length; index += 1) {
        if (compareSortedRunHeads(heads[index], heads[bestIndex]) < 0) {
          bestIndex = index;
        }
      }

      const best = heads[bestIndex];
      if (!output.write(`${best.line}\n`)) {
        await once(output, 'drain');
      }

      const nextLine = await readNextNonEmptyLine(best.iterator);
      if (!nextLine) {
        best.reader.close();
        heads.splice(bestIndex, 1);
        continue;
      }

      best.line = nextLine;
      best.sortKey = getAiDatasetSortKey(
        parseAiDatasetLine(nextLine, runPaths[best.runIndex]),
      );
    }
  } finally {
    for (const head of heads) {
      head.reader.close();
    }

    output.end();
    await outputDone;
  }
};

export const mergeAiJsonlFiles = async (params: {
  filePaths: string[];
  outPath: string;
  maxRowsInMemory?: number;
  maxBytesInMemory?: number;
}) => {
  const {
    filePaths,
    outPath,
    maxRowsInMemory = AI_MERGE_SORT_RUN_MAX_ROWS,
    maxBytesInMemory = AI_MERGE_SORT_RUN_MAX_BYTES,
  } = params;

  const tempDir = path.join(
    path.dirname(outPath),
    `.ai-merge-${path.basename(outPath)}-${Date.now()}-${process.pid}`,
  );
  let batch: SortableAiDatasetLine[] = [];
  let batchBytes = 0;
  let sourceIndex = 0;
  let runIndex = 0;
  const runPaths: string[] = [];

  const flushBatch = async () => {
    if (!batch.length) {
      return;
    }

    runPaths.push(
      await flushSortedRun({
        tempDir,
        runIndex,
        entries: batch,
      }),
    );
    runIndex += 1;
    batch = [];
    batchBytes = 0;
  };

  try {
    await fs.mkdir(tempDir, { recursive: true });

    for (const filePath of filePaths) {
      const reader = readline.createInterface({
        input: createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });

      try {
        for await (const line of reader) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          batch.push({
            line: trimmed,
            sortKey: getAiDatasetSortKey(parseAiDatasetLine(trimmed, filePath)),
            sourceIndex,
          });
          sourceIndex += 1;
          batchBytes += Buffer.byteLength(trimmed, 'utf8') + 1;

          if (
            batch.length >= maxRowsInMemory ||
            batchBytes >= maxBytesInMemory
          ) {
            await flushBatch();
          }
        }
      } finally {
        reader.close();
      }
    }

    await flushBatch();

    if (!runPaths.length) {
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, '', 'utf8');
      return;
    }

    await mergeSortedRuns({
      runPaths,
      outPath,
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};

export const readAiDatasetRows = async (params: {
  filePath: string;
  limitFromEnd?: number;
  skipFromEnd?: number;
}) => {
  const { filePath, limitFromEnd = 0, skipFromEnd = 0 } = params;
  const rows: AiDatasetRow[] = [];
  const recentLines: string[] = [];
  let totalRows = 0;
  const recentWindowLimit =
    limitFromEnd > 0 ? limitFromEnd + Math.max(0, skipFromEnd) : 0;
  const reader = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    totalRows += 1;
    if (limitFromEnd > 0) {
      if (recentLines.length === recentWindowLimit) {
        recentLines.shift();
      }
      recentLines.push(trimmed);
    } else {
      const row = JSON.parse(trimmed) as AiDatasetRow;
      rows.push(row);
    }
  }

  const effectiveSkip = Math.max(0, skipFromEnd);
  const selectedRecentLines =
    effectiveSkip > 0
      ? recentLines.slice(0, Math.max(0, recentLines.length - effectiveSkip))
      : recentLines;
  const selectedRows =
    limitFromEnd > 0
      ? selectedRecentLines.map((line) => JSON.parse(line) as AiDatasetRow)
      : effectiveSkip > 0
        ? rows.slice(0, Math.max(0, rows.length - effectiveSkip))
        : rows;

  return {
    rows: selectedRows,
    totalRows,
  };
};
