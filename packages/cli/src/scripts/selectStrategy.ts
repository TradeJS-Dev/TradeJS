import readline from 'readline';
import chalk from 'chalk';
import { getAvailableStrategyNames } from '@tradejs/core/strategy';

const defaultStrategy = 'TrendLine';

const getStrategyChoices = async (): Promise<string[]> => {
  try {
    const loaded = await getAvailableStrategyNames();
    if (loaded.length) {
      return loaded;
    }
  } catch (error) {
    console.warn(`Failed to load strategy list: ${String(error)}`);
  }
  return ['Breakout', 'TrendLine', 'VolumeDivergence'];
};

export const selectStrategy = async (
  promptLabel = 'Select strategy',
): Promise<string> => {
  const strategies = await getStrategyChoices();
  const fallbackStrategy = strategies.includes(defaultStrategy)
    ? defaultStrategy
    : strategies[0];

  if (!process.stdin.isTTY) {
    return fallbackStrategy;
  }

  console.log(chalk.cyan('Available strategies:'));
  strategies.forEach((name, index) => {
    const isDefault = name === defaultStrategy;
    const label = isDefault ? chalk.green(name) : name;
    const suffix = isDefault ? chalk.gray(' (default)') : '';
    console.log(`  ${chalk.yellow(String(index + 1))}) ${label}${suffix}`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (text: string) =>
    new Promise<string>((resolve) => rl.question(text, resolve));

  const answer = await question(
    `${promptLabel} [${chalk.green(fallbackStrategy)}]: `,
  );
  rl.close();

  const trimmed = answer.trim();
  if (!trimmed) {
    return fallbackStrategy;
  }

  const asNumber = Number(trimmed);
  if (
    Number.isFinite(asNumber) &&
    asNumber >= 1 &&
    asNumber <= strategies.length
  ) {
    return strategies[asNumber - 1];
  }

  const byName = strategies.find(
    (name) => name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (byName) {
    return byName;
  }

  console.warn(`Unknown strategy "${trimmed}", using ${fallbackStrategy}.`);
  return fallbackStrategy;
};
