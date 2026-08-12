import fs from 'node:fs/promises';
import path from 'node:path';
import type { CoreResearchTraceEvent } from '@tradejs/types';
import { toFileToken } from './mlDatasetFile';

const DEFAULT_DIR = 'data/research/core/trace';
const queueByPath = new Map<string, Promise<void>>();

export const getCoreResearchTraceFilePath = (params: {
  strategyName: string;
  chunkId: string;
  outDir?: string;
}) =>
  path.join(
    params.outDir ?? DEFAULT_DIR,
    `core-research-trace-${toFileToken(params.strategyName)}-chunk-${toFileToken(params.chunkId)}.jsonl`,
  );

export const listCoreResearchTraceFiles = async (params: {
  strategyName: string;
  runId: string;
  outDir?: string;
}) => {
  const outDir = path.resolve(params.outDir ?? DEFAULT_DIR);
  let names: string[] = [];
  try {
    names = await fs.readdir(outDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const prefix = `core-research-trace-${toFileToken(params.strategyName)}-chunk-`;
  return names
    .filter(
      (name) =>
        name.startsWith(prefix) &&
        name.includes(toFileToken(params.runId)) &&
        name.endsWith('.jsonl'),
    )
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((name) => path.join(outDir, name));
};

export const appendCoreResearchTraceEvent = async (params: {
  strategyName: string;
  chunkId: string;
  event: CoreResearchTraceEvent;
  outDir?: string;
}) => {
  const filePath = getCoreResearchTraceFilePath(params);
  const previous = queueByPath.get(filePath) ?? Promise.resolve();
  const next = previous.then(async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(params.event)}\n`, 'utf8');
  });
  queueByPath.set(filePath, next);
  try {
    await next;
  } finally {
    if (queueByPath.get(filePath) === next) queueByPath.delete(filePath);
  }
  return filePath;
};
