import chalk from 'chalk';
import { requireDevComposeFile, runDockerCompose } from './infraCommon';

export const main = async () => {
  const composePath = requireDevComposeFile();

  console.log(chalk.cyan('Starting dev infra (timescale, redis)...'));
  runDockerCompose(composePath, [
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    '120',
    'timescale',
    'redis',
  ]);
  console.log(chalk.green('Dev infra is ready.'));
};
