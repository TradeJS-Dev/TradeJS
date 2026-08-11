import 'dotenv/config';
import args from 'args';
import chalk from 'chalk';
import { waitForDbReady } from '@tradejs/infra/timescale/client';
import { cleanupDeprecatedMarketContext } from '@tradejs/infra/timescale/marketContext';

args.example(
  'yarn cli maintenance:cleanup-market-context --apply',
  'Remove deprecated snapshot-only market context data from Timescale',
);
args.option(['a', 'apply'], 'Apply destructive cleanup; default is dry-run');

const flags = args.parse(process.argv);

export const main = async () => {
  const apply = Boolean(flags.apply);
  await waitForDbReady();
  const items = await cleanupDeprecatedMarketContext({ apply });

  if (!items.length) {
    console.log(chalk.green('No deprecated market context data found.'));
    return;
  }

  console.log(
    apply
      ? chalk.yellow('Deprecated market context cleanup applied:')
      : chalk.cyan('Deprecated market context cleanup dry-run:'),
  );
  for (const item of items) {
    console.log(
      `${item.action} ${item.name}: rows=${item.rows} applied=${item.applied}`,
    );
  }
  if (!apply) {
    console.log(chalk.gray('Pass --apply to execute this cleanup.'));
  }
};
