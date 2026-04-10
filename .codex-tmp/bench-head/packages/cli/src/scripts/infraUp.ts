import chalk from 'chalk';
import { requireDevComposeFile, runDockerCompose } from './infraCommon';

const run = async () => {
  const composePath = requireDevComposeFile();

  console.log(chalk.cyan('Starting dev infra (timescale, redis)...'));
  runDockerCompose(composePath, ['up', '-d', 'timescale', 'redis']);
  console.log(chalk.green('Dev infra is up.'));
};

run().catch((error) => {
  console.error(chalk.red(`infra-up failed: ${String(error)}`));
  process.exit(1);
});
