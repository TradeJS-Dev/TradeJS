import chalk from 'chalk';
import { requireDevComposeFile, runDockerCompose } from './infraCommon';

const run = async () => {
  const composePath = requireDevComposeFile();

  console.log(chalk.cyan('Stopping dev infra (timescale, redis)...'));
  runDockerCompose(composePath, ['stop', 'timescale', 'redis']);
  console.log(chalk.green('Dev infra is stopped.'));
};

run().catch((error) => {
  console.error(chalk.red(`infra-down failed: ${String(error)}`));
  process.exit(1);
});
