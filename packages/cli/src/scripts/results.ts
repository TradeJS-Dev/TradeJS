import args from 'args';
import chalk from 'chalk';
const ListIt = require('list-it');
import { connectors } from '@tradejs/connectors';
import { getTickers } from '@utils/cli';
import { getData, getKeys, setData, delKey, redisKeys } from '@utils/redis';
import { Test, TestStat, StrategyResults } from '@types';

args.example(
  'yarn results --strategy TrendLine --coverage',
  'Show best results per symbol and coverage',
);

args.option(['s', 'strategy'], 'Strategy name');
args.option(['C', 'coverage'], 'Show coverage table', false);
args.option(['u', 'update'], 'Update results config in redis', false);
args.option(['m', 'merge'], 'Merge results config in redis', false);
args.option(['c', 'clear'], 'Clear results config in redis', false);
args.option(['V', 'verbose'], 'Verbose output', false);
args.option(['U', 'user'], 'Use user config', 'root');

const flags = args.parse(process.argv);

const MIN_PROFIT = 2;
const MIN_WIN_RATE = 40;
const MIN_ORDERS_PER_MONTH = 1;

type BestResult = {
  symbol: string;
  profit: number;
  winRate: number;
  orders: number;
  config: Test['strategyConfig'];
  stats: TestStat;
};

type StrategyResultEntry = StrategyResults[string];

const createListIt = () =>
  new ListIt({
    autoAlign: true,
    headerUnderline: true,
  });

const formatPercent = (value: number) => `${value.toFixed(2)}%`;

const getMonthlyReturn = (totalReturn: number, periodMonths: number) => {
  if (periodMonths <= 0) {
    return 0;
  }

  const base = 1 + totalReturn / 100;
  if (base <= 0) {
    return -100;
  }

  return (Math.pow(base, 1 / periodMonths) - 1) * 100;
};

const toStrategyResultEntry = (
  row: Pick<BestResult, 'config' | 'stats'>,
): StrategyResultEntry => ({
  config: row.config,
  stats: row.stats,
});

const toStrategyResults = (rows: Iterable<BestResult>): StrategyResults =>
  Object.fromEntries(
    [...rows].map((row) => [row.symbol, toStrategyResultEntry(row)]),
  );

const getTestConfigs = async (userName: string) => {
  const testsPrefix = redisKeys.tests(userName);
  const keys = await getKeys(testsPrefix);
  const configKeys = keys.filter((key) => key.endsWith(':config'));

  return configKeys
    .map((key) => {
      const parts = key.split(':');
      if (parts.length < 5) {
        return null;
      }
      const strategyName = parts[3];
      const testName = parts[4];
      return { strategyName, testName };
    })
    .filter(Boolean) as Array<{ strategyName: string; testName: string }>;
};

const buildBestResults = async (
  userName: string,
  strategyName: string,
): Promise<Map<string, BestResult>> => {
  const testConfigs = await getTestConfigs(userName);
  const bestBySymbol = new Map<string, BestResult>();

  for await (const {
    testName,
    strategyName: strategyFromIndex,
  } of testConfigs) {
    const config = (await getData(
      redisKeys.testConfig(userName, strategyFromIndex, testName),
      null,
    )) as Test | null;

    if (!config || config.strategyName !== strategyName) {
      continue;
    }

    const stat = (await getData(
      redisKeys.testStat(userName, strategyFromIndex, testName),
      null,
    )) as TestStat | null;

    if (!stat) {
      continue;
    }

    const profit = getMonthlyReturn(
      stat.totalReturn ?? 0,
      stat.periodMonths ?? 0,
    );
    const winRate = stat.winRate ?? 0;
    const ordersPerMonth = stat.ordersPerMonth ?? 0;

    if (
      profit <= MIN_PROFIT ||
      winRate <= MIN_WIN_RATE ||
      ordersPerMonth <= MIN_ORDERS_PER_MONTH
    ) {
      continue;
    }

    const prev = bestBySymbol.get(config.symbol);
    if (!prev || profit > prev.profit) {
      bestBySymbol.set(config.symbol, {
        symbol: config.symbol,
        profit,
        winRate,
        orders: stat.orders ?? 0,
        config: config.strategyConfig,
        stats: stat,
      });
    }
  }

  return bestBySymbol;
};

const getSavedProfitsBySymbol = async (
  currentResults: StrategyResults,
): Promise<Map<string, number>> => {
  const savedProfitBySymbol = new Map<string, number>();

  for (const [symbol, result] of Object.entries(currentResults)) {
    const stat = result.stats;
    const profit = getMonthlyReturn(
      stat.totalReturn ?? 0,
      stat.periodMonths ?? 0,
    );
    const prevProfit = savedProfitBySymbol.get(symbol);
    if (prevProfit === undefined || profit > prevProfit) {
      savedProfitBySymbol.set(symbol, profit);
    }
  }

  return savedProfitBySymbol;
};

const getCoverageRow = async (
  strategyName: string,
  userName: string,
  goodSymbols: Set<string>,
) => {
  const currentResults = (await getData(
    redisKeys.strategyResults(userName, strategyName),
    {},
  )) as StrategyResults;

  const existingSymbols = new Set(Object.keys(currentResults));
  let goodMissing = 0;
  let goodExisting = 0;

  for (const symbol of goodSymbols) {
    if (existingSymbols.has(symbol)) {
      goodExisting += 1;
    } else {
      goodMissing += 1;
    }
  }

  const byBitConnector = await connectors.ByBit({
    userName,
  });

  const tickers = await getTickers(byBitConnector);

  const total = tickers.length;
  const coverage = total ? ((goodMissing + goodExisting) / total) * 100 : 0;

  return {
    goodMissing,
    goodExisting,
    total,
    coverage,
  };
};

export const results = async () => {
  if (!flags.strategy) {
    console.error(chalk.red('Missing --strategy'));
    process.exit(1);
  }

  const strategyName = flags.strategy;
  const userName = flags.user;

  if (flags.clear) {
    const cleared = await delKey(
      redisKeys.strategyResults(userName, strategyName),
    );
    console.log(
      cleared
        ? chalk.green(`Cleared results:${strategyName}`)
        : chalk.yellow(`No results to clear for ${strategyName}`),
    );

    if (!flags.coverage && !flags.update && !flags.merge) {
      process.exit();
    }
  }

  const bestBySymbol = await buildBestResults(userName, strategyName);

  if (flags.coverage) {
    const rows = [...bestBySymbol.values()]
      .sort((a, b) => b.profit - a.profit)
      .map((row) => [
        chalk.yellow(row.symbol),
        chalk.green(formatPercent(row.profit)),
        chalk.magenta(formatPercent(row.winRate)),
        chalk.blue(row.orders.toString()),
      ]);

    console.log('');
    console.log(chalk.gray('RESULTS:'));
    console.log(
      createListIt()
        .setHeaderRow([
          chalk.yellow('SYMBOL'),
          chalk.green('PROFIT'),
          chalk.magenta('WINRATE'),
          chalk.blue('ORDERS'),
        ])
        .d(rows)
        .toString(),
    );
    console.log('');

    const goodSymbols = new Set(bestBySymbol.keys());
    const { goodMissing, goodExisting, total, coverage } = await getCoverageRow(
      strategyName,
      userName,
      goodSymbols,
    );

    console.log(
      chalk.gray(
        `COVERAGE: ${goodMissing} / ${goodExisting} / ${total} (${coverage.toFixed(2)} %)`,
      ),
    );
    console.log('');
  }

  if (flags.update || flags.merge) {
    const resultsConfig = toStrategyResults(bestBySymbol.values());

    if (flags.merge) {
      if (Object.keys(resultsConfig).length === 0) {
        console.log(chalk.yellow('No good results to merge.'));
        process.exit(0);
      }

      const current = (await getData(
        redisKeys.strategyResults(userName, strategyName),
        {},
      )) as StrategyResults;

      const savedProfitBySymbol = await getSavedProfitsBySymbol(current);

      const updates = [...bestBySymbol.values()].filter(
        ({ symbol, profit }) => {
          const savedProfit = savedProfitBySymbol.get(symbol);
          return savedProfit === undefined || profit > savedProfit;
        },
      );

      if (updates.length === 0) {
        console.log(
          chalk.yellow(
            `No symbols with higher profit than saved results:${strategyName}`,
          ),
        );
        process.exit(0);
      }

      const merged = {
        ...current,
        ...toStrategyResults(updates),
      };

      await setData(redisKeys.strategyResults(userName, strategyName), merged, {
        expire: 0,
      });

      if (flags.verbose) {
        const updateRows = updates
          .sort((a, b) => {
            const prevA = savedProfitBySymbol.get(a.symbol) ?? -Infinity;
            const prevB = savedProfitBySymbol.get(b.symbol) ?? -Infinity;
            return b.profit - prevB - (a.profit - prevA);
          })
          .map((row) => {
            const prevProfit = savedProfitBySymbol.get(row.symbol);
            const delta = row.profit - (prevProfit ?? 0);

            return [
              chalk.yellow(row.symbol),
              chalk.gray(
                prevProfit === undefined ? 'N/A' : formatPercent(prevProfit),
              ),
              chalk.green(formatPercent(row.profit)),
              chalk.blue(
                `${delta >= 0 ? '+' : ''}${formatPercent(delta).replace('+', '')}`,
              ),
            ];
          });

        console.log('');
        console.log(chalk.gray('MERGE UPDATES:'));
        console.log(
          createListIt()
            .setHeaderRow([
              chalk.yellow('SYMBOL'),
              chalk.gray('PREV_PROFIT'),
              chalk.green('NEW_PROFIT'),
              chalk.blue('DELTA'),
            ])
            .d(updateRows)
            .toString(),
        );
        console.log('');
      }

      console.log(
        chalk.green(
          `Merged ${updates.length} symbols into results:${strategyName} (only higher profit)`,
        ),
      );

      process.exit(0);
    }

    await setData(
      redisKeys.strategyResults(userName, strategyName),
      resultsConfig,
      {
        expire: 0,
      },
    );

    console.log(
      chalk.green(
        `Updated results:${strategyName} with ${Object.keys(resultsConfig).length} symbols`,
      ),
    );
  }

  process.exit();
};

if (process.env.NODE_ENV !== 'test') {
  void results();
}
