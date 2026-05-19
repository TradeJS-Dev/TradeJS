import args from 'args';
import { cleanFiles } from '@tradejs/node/cli';

args.option('dir', 'Directory clean up', 'cache');

const flags = args.parse(process.argv);

const getDir = () => {
  if (flags.dir) {
    return `data/${flags.dir}`;
  }

  return 'data/cache';
};

export const main = async () => {
  await cleanFiles(getDir());

  process.exit();
};
