import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { logger } from '@utils/logger';
import { stringify } from '@utils/stringify';

const hash: { [key: string]: any } = {};

const getPath = (dir: string, file: string) =>
  path.join(process.cwd(), dir, `${file}.json`);

export const getData = (
  dir: string,
  file: string,
  useCache = true,
  fallback = [],
): any => {
  const fullPath = getPath(dir, file);

  if (useCache && hash[fullPath]) {
    return hash[fullPath];
  }

  if (!fs.existsSync(fullPath)) {
    logger.log('warn', chalk.gray(`${fullPath} not found`));
    return fallback;
  }

  try {
    const file = fs.readFileSync(fullPath, 'utf8');
    const parsedFile = JSON.parse(file);

    if (useCache) {
      hash[fullPath] = parsedFile;
    }

    return parsedFile;
  } catch (e) {
    logger.log('error', 'failed data file: %s', e);
    return fallback;
  }
};

export const setData = <T>(
  dir: string,
  file: string,
  data: T,
  useCache = true,
) => {
  const fullPath = getPath(dir, file);

  if (useCache) {
    hash[fullPath] = data;
  }

  fs.writeFileSync(fullPath, stringify(data));
};
