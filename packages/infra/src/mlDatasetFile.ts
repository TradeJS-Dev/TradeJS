import { once } from 'events';
import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import readline from 'node:readline';

const DEFAULT_DIR = 'data/ml/export';
const ML_DATASET_WRITE_BATCH_SIZE = 200;
const ML_CHUNK_FILE_RE = /^ml-dataset-(.+)-chunk-[^.]+\.jsonl$/;
const BACKTEST_RUN_CHUNK_ID_RE = /^(\d{12}-[a-f0-9]{8})-/;

type WriterState = {
  filePath: string;
  stream: ReturnType<typeof createWriteStream>;
  buffer: string[];
  writeQueue: Promise<void>;
  closed: boolean;
};

const writerByPath = new Map<string, WriterState>();

export const toFileToken = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'any';

export const getMlChunkFilePath = (
  strategyName: string,
  chunkId: string,
  outDir = DEFAULT_DIR,
) =>
  path.join(
    outDir,
    `ml-dataset-${toFileToken(strategyName)}-chunk-${toFileToken(chunkId)}.jsonl`,
  );

const getMlChunkFilePrefix = (strategyName: string, runId?: string) =>
  `ml-dataset-${toFileToken(strategyName)}-chunk-${
    runId ? `${toFileToken(runId)}-` : ''
  }`;

const getRunIdFromMlChunkFileName = (
  strategyName: string,
  fileName: string,
) => {
  const prefix = getMlChunkFilePrefix(strategyName);
  if (!fileName.startsWith(prefix) || !fileName.endsWith('.jsonl')) {
    return '';
  }

  const chunkToken = fileName.slice(prefix.length, -'.jsonl'.length);
  return chunkToken.match(BACKTEST_RUN_CHUNK_ID_RE)?.[1] ?? '';
};

export const appendMlDatasetRow = async (params: {
  strategyName: string;
  chunkId: string;
  row: Record<string, number | string | null>;
  outDir?: string;
}) => {
  const { strategyName, chunkId, row, outDir = DEFAULT_DIR } = params;
  const filePath = getMlChunkFilePath(strategyName, chunkId, outDir);
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
    throw new Error(`ML dataset writer is closed: ${filePath}`);
  }

  state.buffer.push(`${JSON.stringify(row)}\n`);
  if (state.buffer.length >= ML_DATASET_WRITE_BATCH_SIZE) {
    await flushMlDatasetWriter(filePath);
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

export const flushMlDatasetWriter = async (filePath: string) => {
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

export const closeMlDatasetWriter = async (filePath: string) => {
  const state = writerByPath.get(filePath);
  if (!state) return;
  state.writeQueue = state.writeQueue.then(() => closeState(state));
  await state.writeQueue;
  writerByPath.delete(filePath);
};

export const closeAllMlDatasetWriters = async () => {
  const filePaths = [...writerByPath.keys()];
  for (const filePath of filePaths) {
    await closeMlDatasetWriter(filePath);
  }
};

export const listMlChunkFiles = async (params: {
  strategyName: string;
  outDir?: string;
  runId?: string;
}) => {
  const { strategyName, outDir = DEFAULT_DIR, runId } = params;
  const prefix = getMlChunkFilePrefix(strategyName, runId);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(outDir);
  } catch (error) {
    return [];
  }
  return entries
    .filter((name) => name.startsWith(prefix) && name.endsWith('.jsonl'))
    .map((name) => path.join(outDir, name))
    .sort();
};

export const listMlChunkRunIds = async (params: {
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
        .map((name) => getRunIdFromMlChunkFileName(strategyName, name))
        .filter(Boolean),
    ),
  ].sort();
};

export const listMlChunkStrategies = async (params?: { outDir?: string }) => {
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
        .map((name) => name.match(ML_CHUNK_FILE_RE)?.[1] || '')
        .filter(Boolean),
    ),
  ].sort();
};

export const mergeJsonlFiles = async (params: {
  filePaths: string[];
  outPath: string;
  shouldIncludeRow?: (row: Record<string, unknown>) => boolean;
}) => {
  const { filePaths, outPath, shouldIncludeRow } = params;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const stream = createWriteStream(outPath, { encoding: 'utf8' });
  const done = Promise.all([once(stream, 'finish'), once(stream, 'close')]);
  try {
    for (const filePath of filePaths) {
      if (shouldIncludeRow) {
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
            const row = JSON.parse(trimmed) as Record<string, unknown>;
            if (!shouldIncludeRow(row)) {
              continue;
            }
            if (!stream.write(`${trimmed}\n`)) {
              await once(stream, 'drain');
            }
          }
        } finally {
          reader.close();
        }
        continue;
      }

      const reader = createReadStream(filePath, { encoding: 'utf8' });
      for await (const chunk of reader) {
        if (!stream.write(chunk)) {
          await once(stream, 'drain');
        }
      }
    }
  } finally {
    stream.end();
    await done;
  }
};
