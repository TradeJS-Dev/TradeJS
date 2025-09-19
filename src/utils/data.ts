import fs from 'fs/promises';
import path from 'path';
import { logger } from '@utils/logger';
import { toJson } from '@utils/toJson';

interface Options {
  useCache?: boolean;
  stringify?: boolean;
}

const DEFAULT_OPTIONS: Options = {
  useCache: true,
  stringify: false,
};

const hash: { [key: string]: any } = {};

const getPath = (dir: string, file: string) =>
  path.join(process.cwd(), dir, `${file}.json`);

const getDir = (dir: string) => path.join(process.cwd(), dir);

export const getFiles = async (dir: string) => {
  return await fs.readdir(getDir(dir));
};

export const getData = async (
  dir: string,
  file: string,
  options: Options = {},
  fallback = [],
): Promise<any> => {
  const { useCache } = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  const fullPath = getPath(dir, file);

  if (useCache && hash[fullPath]) {
    return hash[fullPath];
  }

  try {
    await fs.access(fullPath);
  } catch {
    return fallback;
  }

  try {
    const fileContents = await fs.readFile(fullPath, 'utf8');
    const parsedFile = JSON.parse(fileContents);

    if (useCache) {
      hash[fullPath] = parsedFile;
    }

    return parsedFile;
  } catch (e) {
    logger.log('error', 'failed data file: %s', e);
    return fallback;
  }
};

export const setData = async <T>(
  dir: string,
  file: string,
  data: T,
  options: Options = {},
): Promise<void> => {
  const { useCache, stringify } = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  const fullPath = getPath(dir, file);

  if (useCache) {
    hash[fullPath] = data;
  }

  try {
    await fs.writeFile(fullPath, toJson(data, stringify));
  } catch (e) {
    logger.log('error', 'failed to write file %s: %s', fullPath, e);
  }
};
