import args from 'args';
import { cleanFiles } from '@tradejs/core/cli';

args.option('dir', 'Directory clean up', 'cache');

const flags = args.parse(process.argv);

const getDir = () => {
  if (flags.dir) {
    return `data/${flags.dir}`;
  }

  return 'data/cache';
};

const run = async () => {
  await cleanFiles(getDir());

  process.exit();
};

run();
