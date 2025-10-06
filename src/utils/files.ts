import fs from 'fs/promises';
import path from 'path';
import { logger } from '@utils/logger';
import { toJson } from '@utils/toJson';
import { uuid } from '@utils/uuid';

interface Options {
  stringify?: boolean;
  lock?: boolean;
}

const DEFAULT_OPTIONS: Options = {
  stringify: false,
  lock: false,
};

const getPath = (dir: string, file: string, lock = false) => {
  if (!lock) {
    return path.join(process.cwd(), dir, `${file}.json`);
  }

  const lockId = uuid();

  return path.join(
    process.cwd(),
    'data',
    'cache',
    `${file}.lock.${lockId}.json`,
  );
};

const getDir = (dir: string) => path.join(process.cwd(), dir);

export const getFiles = async (dir: string) => {
  return await fs.readdir(getDir(dir));
};

export const getFile = async (
  dir: string,
  file: string,
  fallback = [],
): Promise<any> => {
  const fullPath = getPath(dir, file);

  try {
    await fs.access(fullPath);
  } catch {
    return fallback;
  }

  try {
    const fileContents = await fs.readFile(fullPath, 'utf8');
    const parsedFile = JSON.parse(fileContents);

    return parsedFile;
  } catch (e) {
    logger.log('error', 'failed data file: %s', e);
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
  const { stringify, lock } = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  const fullPath = getPath(dir, file);
  const lockFullPath = getPath(dir, file, true);

  try {
    if (!lock) {
      await fs.writeFile(fullPath, toJson(data, stringify));

      return;
    }

    await fs.writeFile(lockFullPath, toJson(data, stringify));
    await fs.rename(lockFullPath, fullPath);
  } catch (e) {
    logger.log('error', 'failed to write file %s: %s', fullPath, e);
  }
};
