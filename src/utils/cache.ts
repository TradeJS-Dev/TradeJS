import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

const getCachePath = (dir: string, file: string) =>
  path.join(process.cwd(), 'src', dir, `${file}.json`);

export const getCache = (dir: string, file: string): [] => {
  const fullPath = getCachePath(dir, file);

  if (!fs.existsSync(fullPath)) {
    console.warn(chalk.gray(`${fullPath} not found`));
    return [];
  }

  try {
    const file = fs.readFileSync(fullPath, 'utf8');

    return JSON.parse(file);
  } catch (e) {
    console.error('failed file cache', e);
    return [];
  }
};

export const setCache = <T>(dir: string, file: string, data: T) => {
  const fullPath = getCachePath(dir, file);

  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
};
