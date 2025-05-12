import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

const hash: { [key: string]: Array<any> } = {};

const getCachePath = (dir: string, file: string) =>
  path.join(process.cwd(), dir, `${file}.json`);

export const getCache = (dir: string, file: string): Array<any> => {
  const fullPath = getCachePath(dir, file);

  if (hash[fullPath]) {
    return hash[fullPath];
  }

  if (!fs.existsSync(fullPath)) {
    console.warn(chalk.gray(`${fullPath} not found`));
    return [];
  }

  try {
    const file = fs.readFileSync(fullPath, 'utf8');
    const parsedFile = JSON.parse(file);

    hash[fullPath] = parsedFile;

    return parsedFile;
  } catch (e) {
    console.error('failed file cache', e);
    return [];
  }
};

export const setCache = <T>(dir: string, file: string, data: T) => {
  const fullPath = getCachePath(dir, file);

  hash[fullPath] = data as Array<any>;

  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
};
