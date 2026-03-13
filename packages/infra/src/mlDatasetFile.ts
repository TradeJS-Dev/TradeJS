import { once } from 'events';
import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';

const DEFAULT_DIR = 'data/ml/export';
const ML_DATASET_WRITE_BATCH_SIZE = 200;

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
}) => {
  const { strategyName, outDir = DEFAULT_DIR } = params;
  const prefix = `ml-dataset-${toFileToken(strategyName)}-chunk-`;
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

export const mergeJsonlFiles = async (params: {
  filePaths: string[];
  outPath: string;
}) => {
  const { filePaths, outPath } = params;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const stream = createWriteStream(outPath, { encoding: 'utf8' });
  const done = Promise.all([once(stream, 'finish'), once(stream, 'close')]);
  try {
    for (const filePath of filePaths) {
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
