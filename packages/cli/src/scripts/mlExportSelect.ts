import { selectStrategy } from './selectStrategy';
import { spawnSiblingScript } from './spawnSiblingScript';

export const main = async () => {
  const selected = await selectStrategy();
  const status = spawnSiblingScript(__dirname, 'mlExport', [
    '--strategy',
    selected,
  ]);
  process.exit(status);
};
