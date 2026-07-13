import args from 'args';
import ProgressBar from 'progress';
import chalk from 'chalk';
import {
  getAvailableConnectorProviders,
  getConnectorCreatorByName,
  getConnectorNameByProvider,
} from '@tradejs/node/connectors';
import { getTickers } from '@tradejs/node/cli';
import { PRELOAD_DAYS } from '@tradejs/core/constants';
import { formatUnix, getTimestamp } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';
import { deleteCandles, waitForDbReady } from '@tradejs/infra/timescale';
import { Connector, ConnectorCreator, Interval } from '@tradejs/types';
import {
  findRepairableContinuityGap,
  parseContinuityUniverse,
  resolveContinuityUniverses,
} from '../lib/continuity';

args.option(['t', 'tickers'], 'Selected tickers');
args.option(['f', 'timeframe'], 'Timeframe', 15);
args.option(
  ['p', 'provider'],
  'Data provider: all|bybit|binance|coinbase or comma list',
  'all',
);
args.option(['U', 'user'], 'Use user confg', 'root');
args.option(['V', 'universe'], 'Market universe: all|crypto|tradfi', 'all');

const flags = args.parse(process.argv);
const interval = Number(flags.timeframe);
const intervalKey = flags.timeframe.toString() as Interval;
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

const parseProviders = async (value: unknown): Promise<string[]> => {
  const allProviders = await getAvailableConnectorProviders(projectRoot);
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

const runContinuity = async ({
  connector,
  provider,
  connectorName,
  reloadStart,
  reloadEnd,
}: {
  connector: Connector;
  provider: string;
  connectorName: string;
  reloadStart: number;
  reloadEnd: number;
}) => {
  const { universe } = connector;
  const tickers = await getTickers(
    connector,
    flags.tickers,
    '',
    undefined,
    undefined,
    { universe },
  );
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

  logger.info(
    chalk.yellow(`continuity ${connectorName}:${universe}: ${tickers.length}`),
  );

  for await (const symbol of tickers) {
    const data = await connector.kline({
      symbol,
      interval: intervalKey,
      start: reloadStart,
      end: reloadEnd,
      silent: true,
    });

    let gap = findRepairableContinuityGap(data, expectedMs, universe);
    if (gap) {
      broken++;
      logger.warn(
        '[%s:%s] gap %s %s: %s -> %s (%ss)',
        provider,
        universe,
        symbol,
        interval,
        formatUnix(gap.prevTs),
        formatUnix(gap.ts),
        gap.diffSeconds,
      );

      await deleteCandles(provider, symbol, interval);

      const reloaded = await connector.kline({
        symbol,
        interval: intervalKey,
        start: reloadStart,
        end: reloadEnd,
        silent: true,
      });
      gap = findRepairableContinuityGap(reloaded, expectedMs, universe);

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
      `[${provider}:${universe}] broken: ${broken}/${tickers.length}, fixed: ${fixed}`,
    ),
  );
};

export const main = async () => {
  if (!Number.isFinite(interval) || interval <= 0) {
    logger.error('Invalid timeframe: %s', flags.timeframe);
    process.exit(1);
  }

  await waitForDbReady();
  const reloadStart = getTimestamp(PRELOAD_DAYS);
  const reloadEnd = getTimestamp();
  let requestedUniverse;
  try {
    requestedUniverse = parseContinuityUniverse(flags.universe);
  } catch (error) {
    logger.error((error as Error).message);
    process.exit(1);
  }
  const providerIds = await parseProviders(flags.provider);
  const providers = await Promise.all(
    providerIds.map(async (providerId) => {
      const connectorName = await getConnectorNameByProvider(
        providerId,
        projectRoot,
      );
      if (!connectorName) {
        logger.warn(
          'Skip provider "%s": connector mapping is missing',
          providerId,
        );
        return null;
      }
      const creator = await getConnectorCreatorByName(
        connectorName,
        projectRoot,
      );
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
    const defaultConnector = await provider.create({
      userName: flags.user,
    });
    const universes = resolveContinuityUniverses(
      requestedUniverse,
      defaultConnector.capabilities.supportedUniverses,
    );
    if (!universes.length) {
      logger.warn(
        'Skip provider "%s": universe "%s" is not supported',
        provider.id,
        requestedUniverse,
      );
      continue;
    }

    for (const universe of universes) {
      const connector =
        defaultConnector.universe === universe
          ? defaultConnector
          : await provider.create({
              userName: flags.user,
              universe,
            });
      await runContinuity({
        connector,
        provider: provider.id,
        connectorName: provider.name,
        reloadStart,
        reloadEnd,
      });
    }
  }

  process.exit();
};
