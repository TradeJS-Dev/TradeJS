import readline from 'readline';
import chalk from 'chalk';
import { StrategyNames } from '@src/strategy';

const strategies = Object.values(StrategyNames);
const defaultStrategy = StrategyNames.TrendLine;

export const selectStrategy = async (
  promptLabel = 'Select strategy',
): Promise<string> => {
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
    `${promptLabel} [${chalk.green(defaultStrategy)}]: `,
  );
  rl.close();

  const trimmed = answer.trim();
  if (!trimmed) {
    return defaultStrategy;
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

  console.warn(`Unknown strategy "${trimmed}", using ${defaultStrategy}.`);
  return defaultStrategy;
};
