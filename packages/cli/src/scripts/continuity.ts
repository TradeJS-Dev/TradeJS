import args from 'args';
import ProgressBar from 'progress';
import chalk from 'chalk';
import {
  getAvailableConnectorProviders,
  getConnectorCreatorByName,
  getConnectorNameByProvider,
} from '@utils/connectorsRegistry';
import { PRELOAD_DAYS } from '@constants';
import { getTimestamp, formatUnix } from '@utils/timestamp';
import { deleteCandles, waitForDbReady } from '@utils/timescale';
import { getTickers } from '@utils/cli';
import { ConnectorCreator, Interval, KlineChartData } from '@types';
import { logger } from '@utils/logger';

args.option(['t', 'tickers'], 'Selected tickers');
args.option(['f', 'timeframe'], 'Timeframe', 15);
args.option(
  ['p', 'provider'],
  'Data provider: all|bybit|binance|coinbase or comma list',
  'all',
);
args.option(['U', 'user'], 'Use user confg', 'root');

const flags = args.parse(process.argv);
const interval = Number(flags.timeframe);
const intervalKey = flags.timeframe.toString() as Interval;

const parseProviders = async (value: unknown): Promise<string[]> => {
  const allProviders = await getAvailableConnectorProviders();
  const raw = String(value || '')
    .trim()
    .toLowerCase();

  if (!raw || raw === 'all') {
    return allProviders;
  }

  const selected = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const uniqueSelected = [...new Set(selected)];
  const invalid = uniqueSelected.filter((item) => !allProviders.includes(item));
  if (invalid.length) {
    logger.error(
      'Unknown provider(s): %s. Supported: %s',
      invalid.join(', '),
      allProviders.join(', '),
    );
    process.exit(1);
  }

  return uniqueSelected;
};

const findGapInData = (data: KlineChartData, expectedMs: number) => {
  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1];
    const current = data[i];
    const diff = current.timestamp - prev.timestamp;

    if (diff !== expectedMs) {
      return {
        prevTs: prev.timestamp,
        ts: current.timestamp,
        diffSeconds: Math.floor(diff / 1000),
      };
    }
  }

  return null;
};

const continuity = async () => {
  if (!Number.isFinite(interval) || interval <= 0) {
    logger.error('Invalid timeframe: %s', flags.timeframe);
    process.exit(1);
  }

  await waitForDbReady();
  const reloadStart = getTimestamp(PRELOAD_DAYS);
  const reloadEnd = getTimestamp();
  const providerIds = await parseProviders(flags.provider);
  const providers = await Promise.all(
    providerIds.map(async (providerId) => {
      const connectorName = await getConnectorNameByProvider(providerId);
      if (!connectorName) {
        logger.warn(
          'Skip provider "%s": connector mapping is missing',
          providerId,
        );
        return null;
      }
      const creator = await getConnectorCreatorByName(connectorName);
      if (!creator) {
        logger.warn(
          'Skip provider "%s": connector "%s" is not registered',
          providerId,
          connectorName,
        );
        return null;
      }
      return {
        id: providerId,
        name: connectorName,
        create: creator as ConnectorCreator,
      };
    }),
  );
  const activeProviders = providers.filter(Boolean) as Array<{
    id: string;
    name: string;
    create: ConnectorCreator;
  }>;
  if (!activeProviders.length) {
    logger.error('No connector providers available');
    process.exit(1);
  }

  for await (const provider of activeProviders) {
    const connector = await provider.create({
      userName: flags.user,
    });
    const tickers = await getTickers(connector, flags.tickers);
    const bar = new ProgressBar(
      ':current/:total [:bar][:percent] broken::broken fixed::fixed :eta(s) :symbol',
      {
        total: tickers.length,
        width: 30,
      },
    );
    let broken = 0;
    let fixed = 0;
    const expectedMs = interval * 60 * 1000;

    logger.info(chalk.yellow(`continuity ${provider.name}: ${tickers.length}`));

    for await (const symbol of tickers) {
      const data = await connector.kline({
        symbol,
        interval: intervalKey,
        start: reloadStart,
        end: reloadEnd,
        silent: true,
      });

      let gap = findGapInData(data, expectedMs);
      if (gap) {
        broken++;
        logger.warn(
          '[%s] gap %s %s: %s -> %s (%ss)',
          provider.id,
          symbol,
          interval,
          formatUnix(gap.prevTs),
          formatUnix(gap.ts),
          gap.diffSeconds,
        );

        await deleteCandles(symbol, interval);

        const reloaded = await connector.kline({
          symbol,
          interval: intervalKey,
          start: reloadStart,
          end: reloadEnd,
          silent: true,
        });
        gap = findGapInData(reloaded, expectedMs);

        if (!gap) {
          fixed++;
        }
      }

      bar.tick(1, {
        broken: chalk.yellow(broken),
        fixed: chalk.cyan(fixed),
        symbol: chalk.gray(symbol),
      });
    }

    logger.info(
      chalk.yellow(
        `[${provider.id}] broken: ${broken}/${tickers.length}, fixed: ${fixed}`,
      ),
    );
  }

  process.exit();
};

continuity();
