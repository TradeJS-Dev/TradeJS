import args from 'args';
import { cleanRedis } from '@tradejs/node/cli';

args.option('area', 'Area clean up', 'cache');

const flags = args.parse(process.argv);

const getArea = () => {
  if (flags.area) {
    return flags.area;
  }

  return 'cache';
};

export const main = async () => {
  await cleanRedis(getArea());

  process.exit();
};
