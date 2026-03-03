import args from 'args';
import { cleanRedis } from '@utils/cli';

args.option('area', 'Area clean up', 'cache');

const flags = args.parse(process.argv);

const getArea = () => {
  if (flags.area) {
    return flags.area;
  }

  return 'cache';
};

const run = async () => {
  await cleanRedis(getArea());

  process.exit();
};

run();
