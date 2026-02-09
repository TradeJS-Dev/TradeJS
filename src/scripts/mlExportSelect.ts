import { spawnSync } from 'child_process';
import { selectStrategy } from './selectStrategy';

const run = async () => {
  const selected = await selectStrategy();
  const shouldClearRedis =
    process.argv.includes('--clearRedis') ||
    process.argv.includes('--clear-redis');
  const args = ['ts-node', './src/scripts/mlExport', '--strategy', selected];
  if (shouldClearRedis) {
    args.push('--clearRedis');
  }
  const result = spawnSync('yarn', args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
};

run().catch((err) => {
  console.error('Failed to select strategy:', err);
  process.exit(1);
});
