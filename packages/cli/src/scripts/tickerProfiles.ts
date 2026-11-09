import fs from 'node:fs/promises';
import { prepareTickerProfiles } from '../lib/tickerProfiles';

export const main = async () => {
  const argv = process.argv.slice(2);
  const option = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0 || !argv[i + 1] || argv[i + 1].startsWith('--'))
      throw new Error(`--${name} is required`);
    return argv[i + 1];
  };
  const symbols: unknown = JSON.parse(
    await fs.readFile(option('symbolsFile'), 'utf8'),
  );
  if (
    !Array.isArray(symbols) ||
    !symbols.every((s): s is string => typeof s === 'string')
  )
    throw new Error('symbolsFile must be a JSON string array');
  const receipts = await prepareTickerProfiles({
    projectRoot: process.env.PROJECT_CWD || process.cwd(),
    provider: option('provider'),
    universeId: option('universeId'),
    symbols,
    start: Number(option('startTime')),
    end: Number(option('endTime')),
  });
  console.log(JSON.stringify({ command: 'ticker-profiles', receipts }));
};
