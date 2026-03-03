import readline from 'readline';
import chalk from 'chalk';

// Keep this script dependency-free from runtime strategy modules.
// Importing @tradejs/core/strategy can trigger unrelated side-effects (e.g. Redis clients).
const strategies = ['Breakout', 'TrendLine', 'VolumeDivergence'] as const;
const defaultStrategy = 'TrendLine';

export const selectStrategy = async (
  promptLabel = 'Select strategy',
): Promise<string> => {
  if (!process.stdin.isTTY) {
    return defaultStrategy;
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
