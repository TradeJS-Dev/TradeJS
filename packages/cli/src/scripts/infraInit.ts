import chalk from 'chalk';
import { initDevComposeFile } from './infraCommon';

const run = async () => {
  initDevComposeFile();
  console.log(chalk.green('Dev infra files are initialized.'));
};

run().catch((error) => {
  console.error(chalk.red(`infra-init failed: ${String(error)}`));
  process.exit(1);
});

