import chalk from 'chalk';
import { initDevComposeFile } from './infraCommon';

export const main = async () => {
  initDevComposeFile();
  console.log(chalk.green('Dev infra files are initialized.'));
};
