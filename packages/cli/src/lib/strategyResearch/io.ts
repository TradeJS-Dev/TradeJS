import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { sha256File, sha256Json, writeJsonAtomic } from '../coreResearch/io';
import type { ResearchState, StrategyResearchSpec } from './types';

export const researchDirectory = (
  projectRoot: string,
  spec: StrategyResearchSpec,
) => path.join(projectRoot, 'data/research/strategy', spec.core.researchId);

export const readJson = async <T>(file: string): Promise<T> =>
  JSON.parse(await fs.readFile(file, 'utf8'));

export const boundResearchPath = async (
  root: string,
  relative: string,
): Promise<string> => {
  const target = path.resolve(root, relative);
  const realRoot = await fs.realpath(root);
  let ancestor = target;
  while (true) {
    try {
      const real = await fs.realpath(ancestor);
      if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`))
        throw new Error(`Research path escapes Project: ${relative}`);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  return target;
};

export const withResearchLock = async <T>(
  projectRoot: string,
  work: () => Promise<T>,
): Promise<T> => {
  const file = await boundResearchPath(
    projectRoot,
    'data/research/strategy/.lock',
  );
  await fs.mkdir(path.dirname(file), { recursive: true });
  const token = randomUUID();
  const acquire = () =>
    fs.writeFile(
      file,
      JSON.stringify({ pid: process.pid, host: os.hostname(), token }),
      { flag: 'wx', mode: 0o600 },
    );
  try {
    await acquire();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const lock = await readJson<{ pid: number; host: string }>(file);
    if (
      lock.host !== os.hostname() ||
      !Number.isSafeInteger(lock.pid) ||
      lock.pid <= 0
    )
      throw new Error(
        'Research is locked by another host or an unreadable owner',
      );
    let alive = true;
    try {
      process.kill(lock.pid, 0);
    } catch (probe) {
      if ((probe as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
    }
    if (alive) throw new Error(`Research is already running (pid=${lock.pid})`);
    await fs.unlink(file);
    await acquire();
  }
  try {
    return await work();
  } finally {
    const owner = await readJson<{ token: string }>(file);
    if (owner.token === token) await fs.unlink(file);
  }
};

export const verifyResearchState = async (
  directory: string,
  state: ResearchState,
) => {
  const frozenSpec = await readJson<unknown>(path.join(directory, 'spec.json'));
  if (sha256Json(frozenSpec) !== state.specSha256)
    throw new Error('Frozen research spec changed');
  for (const [name, stage] of Object.entries(state.stages)) {
    if (stage.status !== 'completed') continue;
    for (const [relative, expected] of Object.entries(stage.artifacts)) {
      const file = await boundResearchPath(directory, relative);
      try {
        if ((await sha256File(file)) !== expected)
          throw new Error(`Research artifact changed: ${name}/${relative}`);
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
          !(await isRetainedDeletion(directory, file, expected))
        )
          throw error;
      }
    }
  }
};

export const verifyCompletedResearch = async (
  directory: string,
  state: ResearchState,
) => {
  await verifyResearchState(directory, state);
  const manifest = await readJson<{
    specSha256: string;
    artifacts: Record<string, string>;
  }>(path.join(directory, 'manifest.json'));
  if (manifest.specSha256 !== state.specSha256)
    throw new Error('Final manifest spec mismatch');
  for (const [relative, expected] of Object.entries(manifest.artifacts))
    if (
      (await sha256File(await boundResearchPath(directory, relative))) !==
      expected
    )
      throw new Error(`Changed final research artifact: ${relative}`);
  const inventory = await readJson<{
    research: { permanentArtifacts: Array<{ path: string; sha256: string }> };
  }>(path.join(directory, 'retention.json'));
  const projectRoot = path.resolve(directory, '../../../..');
  for (const artifact of inventory.research.permanentArtifacts) {
    const file = await boundResearchPath(projectRoot, artifact.path);
    if ((await sha256File(file)) !== artifact.sha256)
      throw new Error(`Changed permanent research record: ${artifact.path}`);
  }
};

export const initializeResearchState = async (
  directory: string,
  spec: StrategyResearchSpec,
  lineage: Record<string, string>,
) => {
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'state.json');
  let previous: ResearchState | undefined;
  try {
    previous = await readJson<ResearchState>(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (previous) {
    if (
      previous.schema !== 'tradejs-strategy-research-state/v1' ||
      previous.specSha256 !== sha256Json(spec) ||
      sha256Json(previous.lineage) !== sha256Json(lineage)
    )
      throw new Error(
        'Research spec or executable/source lineage changed; create a new researchId',
      );
    await verifyResearchState(directory, previous);
    if (previous.status === 'completed')
      await verifyCompletedResearch(directory, previous);
    return previous;
  }
  const state: ResearchState = {
    schema: 'tradejs-strategy-research-state/v1',
    specSha256: sha256Json(spec),
    lineage,
    status: 'running',
    stages: {},
  };
  await writeJsonAtomic(path.join(directory, 'spec.json'), spec);
  await writeJsonAtomic(file, state);
  return state;
};

/** Deleted payloads are verified through their frozen inventory and receipt. */
export const isRetainedDeletion = async (
  directory: string,
  file: string,
  hash: string,
) => {
  try {
    const inventory = await readJson<{
      entries: Array<{ path: string; sha256?: string }>;
    }>(path.join(directory, 'retention.json'));
    const index = inventory.entries.findIndex(
      (entry) => entry.path === file && entry.sha256 === hash,
    );
    if (index < 0) return false;
    const receipt = await readJson<{
      status: string;
      files: Array<{ path: string; sha256: string }>;
    }>(path.join(directory, 'retention', `${index}.json`));
    return (
      ['applying', 'completed'].includes(receipt.status) &&
      receipt.files[0]?.path === file &&
      receipt.files[0]?.sha256 === hash
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};
