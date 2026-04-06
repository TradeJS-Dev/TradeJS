import { selectStrategy } from './selectStrategy';
import { spawnSiblingScript } from './spawnSiblingScript';

const run = async () => {
  const selected = await selectStrategy();
  const status = spawnSiblingScript(__dirname, 'mlExport', [
    '--strategy',
    selected,
  ]);
  process.exit(status);
};

run().catch((err) => {
  console.error('Failed to select strategy:', err);
  process.exit(1);
});
