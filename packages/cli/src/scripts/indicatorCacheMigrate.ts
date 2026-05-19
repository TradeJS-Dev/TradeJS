import chalk from 'chalk';
import { ensureIndicatorCacheTables } from '@tradejs/infra/timescale';

export const main = async () => {
  console.log(chalk.gray('indicator cache migration: starting'));
  await ensureIndicatorCacheTables();
  console.log(chalk.green('indicator cache tables are ready'));
};
