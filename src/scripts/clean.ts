import fs from 'fs/promises';
import ProgressBar from 'progress';
import args from 'args';
import chalk from 'chalk';
import { getFiles } from '@utils/data';

args.option('dir', 'Directory clean up', 'cache');

const flags = args.parse(process.argv);

const cleanFiles = async (dir: string) => {
  let completed = 0;

  const files = await getFiles(dir);

  const bar = new ProgressBar(':current/:total [:bar][:percent] :eta(s)', {
    total: files.length,
    width: 100,
  });

  console.log(chalk.yellow(`clean ${dir}`));

  for await (const file of files) {
    completed++;

    await fs.unlink(`${dir}/${file}`);

    if (completed % 100 === 0 || completed === files.length) {
      bar.tick(completed === files.length ? completed % 100 : 100);
    }
  }
};

const getDir = () => {
  if (flags.dir) {
    return `data/${flags.dir}`;
  }

  return 'data/cache';
};

cleanFiles(getDir());
