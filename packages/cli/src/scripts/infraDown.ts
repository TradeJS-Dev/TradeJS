import chalk from 'chalk';
import { requireDevComposeFile, runDockerCompose } from './infraCommon';

export const main = async () => {
  const composePath = requireDevComposeFile();

  console.log(chalk.cyan('Stopping dev infra (timescale, redis)...'));
  runDockerCompose(composePath, ['stop', 'timescale', 'redis']);
  console.log(chalk.green('Dev infra is stopped.'));
};
