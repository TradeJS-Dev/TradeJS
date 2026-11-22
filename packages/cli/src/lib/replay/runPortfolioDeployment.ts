import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PortfolioStrategyEntry, StrategyConfig } from '@tradejs/types';
import {
  replayPortfolioStrategy,
  type PortfolioReplayWindow,
} from './portfolioStrategyReplay';

export async function runPortfolioDeployment({
  entry,
  config,
  userName,
  connectorName,
  snapshotDirectory,
  projectRoot,
  output,
}: {
  entry: PortfolioStrategyEntry;
  config: StrategyConfig;
  userName: string;
  connectorName: string;
  snapshotDirectory: string;
  projectRoot: string;
  output: string;
}) {
  const directory = path.resolve(projectRoot, snapshotDirectory);
  const window = JSON.parse(
    await readFile(path.join(directory, 'window.json'), 'utf8'),
  ) as PortfolioReplayWindow;
  if (connectorName.toLowerCase() !== 'bybit') {
    throw new Error('Portfolio snapshot replay currently requires Bybit');
  }
  if (
    !Number.isSafeInteger(window.warmupBars) ||
    window.warmupBars < 1 ||
    !Array.isArray(window.symbols) ||
    window.symbols.some((symbol) => !/^[A-Z0-9]+USDT$/.test(symbol))
  ) {
    throw new Error('Invalid portfolio snapshot window');
  }
  const result = await replayPortfolioStrategy({
    entry,
    config: entry.parseConfig(config),
    userName,
    connectorName,
    snapshotDirectory: directory,
    window,
    progress: ({ time, offered, filled }) =>
      console.log('portfolio', new Date(time).toISOString(), offered, filled),
  });
  const destination = path.resolve(projectRoot, output);
  await writeFile(destination, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(`Portfolio replay: ${destination}`);
}
