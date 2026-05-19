import 'dotenv/config';
import { runBot } from '../lib/runBot';

export const main = async () => {
  await runBot();

  process.exit();
};
