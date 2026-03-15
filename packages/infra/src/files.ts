import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

interface Options {
  stringify?: boolean;
  lock?: boolean;
  projectRoot?: string;
}

const DEFAULT_OPTIONS: Options = {
  stringify: false,
  lock: false,
};

const toJson = (value: unknown, pretty = false) =>
  JSON.stringify(value, null, pretty ? 2 : 0);

const logError = (message: string, ...args: unknown[]) => {
  console.error(`[infra:files] ${message}`, ...args);
};

const resolveProjectRoot = (projectRoot?: string): string => {
  const explicit = String(projectRoot || '').trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  const fromEnv = String(process.env.PROJECT_CWD || '').trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }

  return process.cwd();
};

const getPath = (
  dir: string,
  file: string,
  lock = false,
  projectRoot?: string,
) => {
  const root = resolveProjectRoot(projectRoot);
  if (!lock) {
    return path.join(root, dir, `${file}.json`);
  }

  return path.join(root, 'data', 'cache', `${file}.lock.${randomUUID()}.json`);
};

const getDir = (dir: string, projectRoot?: string) =>
  path.join(resolveProjectRoot(projectRoot), dir);

export const getFiles = async (dir: string, projectRoot?: string) => {
  return await fs.readdir(getDir(dir, projectRoot));
};

export const getFile = async (
  dir: string,
  file: string,
  fallback = [],
  projectRoot?: string,
): Promise<any> => {
  const fullPath = getPath(dir, file, false, projectRoot);

  try {
    await fs.access(fullPath);
  } catch {
    return fallback;
  }

  try {
    const fileContents = await fs.readFile(fullPath, 'utf8');
    return JSON.parse(fileContents);
  } catch (error) {
    logError('failed data file: %s', error);
    await fs.unlink(fullPath);
    return fallback;
  }
};

export const setFile = async <T>(
  dir: string,
  file: string,
  data: T,
  options: Options = {},
): Promise<void> => {
  const { stringify, lock, projectRoot } = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  const fullPath = getPath(dir, file, false, projectRoot);
  const lockFullPath = getPath(dir, file, true, projectRoot);

  try {
    if (!lock) {
      await fs.writeFile(fullPath, toJson(data, stringify));
      return;
    }

    await fs.writeFile(lockFullPath, toJson(data, stringify));
    await fs.rename(lockFullPath, fullPath);
  } catch (error) {
    logError('failed to write file %s: %s', fullPath, error);
  }
};
