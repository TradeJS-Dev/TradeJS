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

type WriterState = {
  filePath: string;
  stream: ReturnType<typeof createWriteStream>;
  buffer: string[];
  writeQueue: Promise<void>;
  closed: boolean;
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

export const mergeAiJsonlFiles = async (params: {
  filePaths: string[];
  outPath: string;
}) => {
  await mergeJsonlFiles(params);
};

export const readAiDatasetRows = async (params: {
  filePath: string;
  limitFromEnd?: number;
}) => {
  const { filePath, limitFromEnd = 0 } = params;
  const rows: AiDatasetRow[] = [];
  let totalRows = 0;
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
    const row = JSON.parse(trimmed) as AiDatasetRow;
    if (limitFromEnd > 0) {
      if (rows.length === limitFromEnd) {
        rows.shift();
      }
      rows.push(row);
    } else {
      rows.push(row);
    }
  }

  return { rows, totalRows };
};
