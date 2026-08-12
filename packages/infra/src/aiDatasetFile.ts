import { once } from 'events';
import { createWriteStream, type WriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import { addMonths, startOfMonth } from 'date-fns';
import type { AiDatasetRow } from '@tradejs/types';
import { mergeJsonlFiles, toFileToken } from './mlDatasetFile';

const DEFAULT_DIR = 'data/ai/export';
const AI_DATASET_WRITE_BATCH_SIZE = 100;
const AI_MERGE_SORT_RUN_MAX_ROWS = 2_000;
const AI_MERGE_SORT_RUN_MAX_BYTES = 16 * 1024 * 1024;
const AI_MERGE_SORT_MAX_OPEN_RUNS = 16;
const AI_CHUNK_FILE_RE = /^ai-dataset-(.+)-chunk-[^.]+\.jsonl$/;
const BACKTEST_RUN_CHUNK_ID_RE = /^(\d{12}-[a-f0-9]{8})-/;

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

const writerByPath = new Map<string, Promise<WriterState>>();

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

const getAiChunkFilePrefix = (strategyName: string, runId?: string) =>
  `ai-dataset-${toFileToken(strategyName)}-chunk-${
    runId ? `${toFileToken(runId)}-` : ''
  }`;

const getRunIdFromAiChunkFileName = (
  strategyName: string,
  fileName: string,
) => {
  const prefix = getAiChunkFilePrefix(strategyName);
  if (!fileName.startsWith(prefix) || !fileName.endsWith('.jsonl')) {
    return '';
  }

  const chunkToken = fileName.slice(prefix.length, -'.jsonl'.length);
  return chunkToken.match(BACKTEST_RUN_CHUNK_ID_RE)?.[1] ?? '';
};

export const appendAiDatasetRow = async (params: {
  strategyName: string;
  chunkId: string;
  row: AiDatasetRow;
  outDir?: string;
}) => {
  const { strategyName, chunkId, row, outDir = DEFAULT_DIR } = params;
  const filePath = getAiChunkFilePath(strategyName, chunkId, outDir);
  let statePromise = writerByPath.get(filePath);
  if (!statePromise) {
    statePromise = (async () => {
      await fs.mkdir(outDir, { recursive: true });
      const stream = createWriteStream(filePath, {
        encoding: 'utf8',
        flags: 'a',
      });
      return {
        filePath,
        stream,
        buffer: [],
        writeQueue: Promise.resolve(),
        closed: false,
      } satisfies WriterState;
    })();
    writerByPath.set(filePath, statePromise);
  }

  let state: WriterState;
  try {
    state = await statePromise;
  } catch (error) {
    if (writerByPath.get(filePath) === statePromise) {
      writerByPath.delete(filePath);
    }
    throw error;
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
  const statePromise = writerByPath.get(filePath);
  if (!statePromise) {
    return;
  }
  const state = await statePromise;
  if (state.closed) return;
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
  const statePromise = writerByPath.get(filePath);
  if (!statePromise) {
    return;
  }
  const state = await statePromise;
  state.writeQueue = state.writeQueue.then(() => closeState(state));
  await state.writeQueue;
  if (writerByPath.get(filePath) === statePromise) {
    writerByPath.delete(filePath);
  }
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
  runId?: string;
}) => {
  const { strategyName, outDir = DEFAULT_DIR, runId } = params;
  const prefix = getAiChunkFilePrefix(strategyName, runId);
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

export const listAiChunkRunIds = async (params: {
  strategyName: string;
  outDir?: string;
}) => {
  const { strategyName, outDir = DEFAULT_DIR } = params;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(outDir);
  } catch {
    return [];
  }

  return [
    ...new Set(
      entries
        .map((name) => getRunIdFromAiChunkFileName(strategyName, name))
        .filter(Boolean),
    ),
  ].sort();
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

const mergeSortedRunBatch = async (params: {
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

const mergeSortedRuns = async (params: {
  runPaths: string[];
  outPath: string;
  tempDir: string;
  maxOpenRuns?: number;
}) => {
  const {
    runPaths,
    outPath,
    tempDir,
    maxOpenRuns = AI_MERGE_SORT_MAX_OPEN_RUNS,
  } = params;
  const resolvedMaxOpenRuns = Math.max(2, Math.trunc(maxOpenRuns));
  let currentRunPaths = [...runPaths];
  let passIndex = 0;

  while (currentRunPaths.length > resolvedMaxOpenRuns) {
    const nextRunPaths: string[] = [];

    for (
      let groupStart = 0, groupIndex = 0;
      groupStart < currentRunPaths.length;
      groupStart += resolvedMaxOpenRuns, groupIndex += 1
    ) {
      const groupRunPaths = currentRunPaths.slice(
        groupStart,
        groupStart + resolvedMaxOpenRuns,
      );

      if (groupRunPaths.length === 1) {
        nextRunPaths.push(groupRunPaths[0]);
        continue;
      }

      const passPath = path.join(
        tempDir,
        `merge-pass-${String(passIndex).padStart(3, '0')}-${String(
          groupIndex,
        ).padStart(6, '0')}.jsonl`,
      );

      await mergeSortedRunBatch({
        runPaths: groupRunPaths,
        outPath: passPath,
      });
      nextRunPaths.push(passPath);

      await Promise.all(
        groupRunPaths.map((runPath) => fs.rm(runPath, { force: true })),
      );
    }

    currentRunPaths = nextRunPaths;
    passIndex += 1;
  }

  await mergeSortedRunBatch({
    runPaths: currentRunPaths,
    outPath,
  });
};

export const mergeAiJsonlFiles = async (params: {
  filePaths: string[];
  outPath: string;
  maxRowsInMemory?: number;
  maxBytesInMemory?: number;
  maxOpenRuns?: number;
  shouldIncludeRow?: (row: AiDatasetRow) => boolean;
}) => {
  const {
    filePaths,
    outPath,
    maxRowsInMemory = AI_MERGE_SORT_RUN_MAX_ROWS,
    maxBytesInMemory = AI_MERGE_SORT_RUN_MAX_BYTES,
    maxOpenRuns = AI_MERGE_SORT_MAX_OPEN_RUNS,
    shouldIncludeRow,
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

          const row = parseAiDatasetLine(trimmed, filePath);
          if (shouldIncludeRow && !shouldIncludeRow(row)) {
            continue;
          }

          batch.push({
            line: trimmed,
            sortKey: getAiDatasetSortKey(row),
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
      tempDir,
      maxOpenRuns,
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};

const getAiDatasetPartPath = (filePath: string, partIndex: number) => {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}-part${partIndex}${parsed.ext}`);
};

const getPartWindowEndExclusive = (
  timestamp: number,
  monthsPerPart: number,
): number => {
  const partStart = startOfMonth(new Date(timestamp));
  return addMonths(partStart, Math.max(1, monthsPerPart)).getTime();
};

export const splitAiMergedDatasetFile = async (params: {
  filePath: string;
  monthsPerPart?: number;
}) => {
  const { filePath, monthsPerPart = 2 } = params;
  const resolvedMonthsPerPart = Math.max(1, Math.trunc(monthsPerPart));
  const reader = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  const partPaths: string[] = [];
  let currentPartIndex = 0;
  let currentPartPath = '';
  let currentPartEndExclusive = Number.NaN;
  let currentWriter: WriteStream | null = null;
  let currentWriterDone: Promise<unknown[]> | null = null;
  let rowCount = 0;

  const openPart = async (timestamp: number) => {
    currentPartIndex += 1;
    currentPartPath = getAiDatasetPartPath(filePath, currentPartIndex);
    currentPartEndExclusive = getPartWindowEndExclusive(
      timestamp,
      resolvedMonthsPerPart,
    );
    currentWriter = createWriteStream(currentPartPath, { encoding: 'utf8' });
    currentWriterDone = Promise.all([
      once(currentWriter, 'finish'),
      once(currentWriter, 'close'),
    ]);
    partPaths.push(currentPartPath);
  };

  const closeCurrentWriter = async () => {
    if (!currentWriter || !currentWriterDone) {
      return;
    }

    currentWriter.end();
    await currentWriterDone;
    currentWriter = null;
    currentWriterDone = null;
  };

  const getCurrentWriter = () => {
    if (!currentWriter) {
      throw new Error(
        `AI dataset part writer was not initialized for ${filePath}`,
      );
    }

    return currentWriter;
  };

  try {
    for await (const line of reader) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const row = parseAiDatasetLine(trimmed, filePath);
      const timestamp = Number(row.timestamp);
      const safeTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now();

      if (
        !currentWriter ||
        !Number.isFinite(currentPartEndExclusive) ||
        safeTimestamp >= currentPartEndExclusive
      ) {
        await closeCurrentWriter();
        await openPart(safeTimestamp);
      }

      const writer = getCurrentWriter();
      if (!writer.write(`${trimmed}\n`)) {
        await once(writer, 'drain');
      }
      rowCount += 1;
    }
  } finally {
    reader.close();
    await closeCurrentWriter();
  }

  if (partPaths.length <= 1) {
    for (const partPath of partPaths) {
      await fs.rm(partPath, { force: true });
    }
    return {
      partPaths: [filePath],
      partCount: partPaths.length || (rowCount > 0 ? 1 : 0),
      rowCount,
      splitApplied: false,
    };
  }

  await fs.rm(filePath, { force: true });
  return {
    partPaths,
    partCount: partPaths.length,
    rowCount,
    splitApplied: true,
  };
};

export const readAiDatasetRows = async (params: {
  filePath?: string;
  filePaths?: string[];
  limitFromEnd?: number;
  skipFromEnd?: number;
}) => {
  const { limitFromEnd = 0, skipFromEnd = 0 } = params;
  const resolvedFilePaths = resolveAiDatasetFilePaths(params);
  if (!resolvedFilePaths.length) {
    return {
      rows: [] as AiDatasetRow[],
      totalRows: 0,
    };
  }
  const rows: AiDatasetRow[] = [];
  const recentLines: string[] = [];
  let totalRows = 0;
  const recentWindowLimit =
    limitFromEnd > 0 ? limitFromEnd + Math.max(0, skipFromEnd) : 0;
  for (const currentFilePath of resolvedFilePaths) {
    const reader = readline.createInterface({
      input: createReadStream(currentFilePath, { encoding: 'utf8' }),
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

    reader.close();
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

const resolveAiDatasetFilePaths = (params: {
  filePath?: string;
  filePaths?: string[];
}) =>
  (Array.isArray(params.filePaths) && params.filePaths.length
    ? params.filePaths
    : params.filePath
      ? [params.filePath]
      : []
  ).map((item) => path.resolve(item));

const countNonEmptyAiDatasetRows = async (filePath: string) => {
  let totalRows = 0;
  const reader = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    if (line.trim()) {
      totalRows += 1;
    }
  }

  reader.close();
  return totalRows;
};

export const countAiDatasetRows = async (params: {
  filePath?: string;
  filePaths?: string[];
  limitFromEnd?: number;
  skipFromEnd?: number;
}) => {
  const { limitFromEnd = 0, skipFromEnd = 0 } = params;
  const resolvedFilePaths = resolveAiDatasetFilePaths(params);
  let totalRows = 0;

  for (const filePath of resolvedFilePaths) {
    totalRows += await countNonEmptyAiDatasetRows(filePath);
  }

  const effectiveSkip = Math.max(0, skipFromEnd);
  const selectedRows =
    limitFromEnd > 0
      ? Math.min(limitFromEnd, Math.max(0, totalRows - effectiveSkip))
      : Math.max(0, totalRows - effectiveSkip);

  return {
    totalRows,
    selectedRows,
  };
};

export const streamAiDatasetRows = async (params: {
  filePath?: string;
  filePaths?: string[];
  limitFromEnd?: number;
  skipFromEnd?: number;
  onRow: (row: AiDatasetRow, index: number) => Promise<void> | void;
}) => {
  const { limitFromEnd = 0, skipFromEnd = 0, onRow } = params;
  const resolvedFilePaths = resolveAiDatasetFilePaths(params);
  if (!resolvedFilePaths.length) {
    return {
      totalRows: 0,
      selectedRows: 0,
    };
  }

  const effectiveSkip = Math.max(0, skipFromEnd);
  let totalRows = 0;
  let selectedRows = 0;

  if (limitFromEnd > 0) {
    const recentLines: string[] = [];
    const recentWindowLimit = limitFromEnd + effectiveSkip;

    for (const currentFilePath of resolvedFilePaths) {
      const reader = readline.createInterface({
        input: createReadStream(currentFilePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });

      for await (const line of reader) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        totalRows += 1;
        if (recentLines.length === recentWindowLimit) {
          recentLines.shift();
        }
        recentLines.push(trimmed);
      }

      reader.close();
    }

    const selectedRecentLines =
      effectiveSkip > 0
        ? recentLines.slice(0, Math.max(0, recentLines.length - effectiveSkip))
        : recentLines;

    for (const line of selectedRecentLines) {
      await onRow(JSON.parse(line) as AiDatasetRow, selectedRows);
      selectedRows += 1;
    }

    return {
      totalRows,
      selectedRows,
    };
  }

  const trailingSkipBuffer: string[] = [];
  for (const currentFilePath of resolvedFilePaths) {
    const reader = readline.createInterface({
      input: createReadStream(currentFilePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    for await (const line of reader) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      totalRows += 1;
      if (effectiveSkip > 0) {
        trailingSkipBuffer.push(trimmed);
        if (trailingSkipBuffer.length <= effectiveSkip) {
          continue;
        }

        const selectedLine = trailingSkipBuffer.shift();
        if (!selectedLine) {
          continue;
        }
        await onRow(JSON.parse(selectedLine) as AiDatasetRow, selectedRows);
        selectedRows += 1;
        continue;
      }

      await onRow(JSON.parse(trimmed) as AiDatasetRow, selectedRows);
      selectedRows += 1;
    }

    reader.close();
  }

  return {
    totalRows,
    selectedRows,
  };
};
