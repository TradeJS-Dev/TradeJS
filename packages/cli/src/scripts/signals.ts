import 'dotenv/config';
import args from 'args';
import type { Interval, MarketUniverse } from '@tradejs/types';
import {
  createSignalsRunner,
  type SignalsRunnerConfig,
} from '../lib/signals/runner';

args.option(['t', 'tickers'], 'Selected tickers');
args.option(['e', 'exclude'], 'Exclude tickers from tests');
args.option(['l', 'tickersLimit'], 'Tickers limit');
args.option(['f', 'timeframe'], 'Timeframe', 15);
args.option(['m', 'makeOrders'], 'Make orders');
args.option(['N', 'notify'], 'Send message in Telegram', false);
args.option(['S', 'skipScreenshots'], 'Skip screenshot generation', false);
args.option(['u', 'updateOnly'], 'Only update tickers history', false);
args.option(['C', 'cacheOnly'], 'Do not update tickers history', false);
args.option(['L', 'showTickersList'], 'Just show only ticker list', false);
args.option(
  ['p', 'parallel'],
  'Signal evaluation worker count',
  Number(process.env.SIGNALS_PARALLEL || 4),
);
args.option(
  ['R', 'showSkipStats'],
  'Show aggregated skip stats by strategy',
  false,
);
args.option(['c', 'chunk'], 'Split by chunks, ex. 1/3');
args.option(['U', 'user'], 'Use user confg', 'root');
args.option(['w', 'watch'], 'Keep signals running on candle boundaries', false);
args.option(
  ['d', 'settleDelayMs'],
  'Delay after candle close before a daemon cycle',
  Number(process.env.SIGNALS_DAEMON_SETTLE_DELAY_MS || 5_000),
);
args.option(
  ['o', 'connector'],
  'Connector provider or name for signals (e.g. bybit, binance, coinbase, custom)',
  'bybit',
);
args.option(['V', 'universe'], 'Market universe (crypto or tradfi)', 'crypto');
args.option(['A', 'account'], 'Trading account id');
args.option(['D', 'deployment'], 'Runtime deployment id');

const flags = args.parse(process.argv);

const hasExplicitScope = process.argv.some((argument) =>
  ['-f', '--timeframe', '-V', '--universe', '-A', '--account'].some(
    (option) => argument === option || argument.startsWith(`${option}=`),
  ),
);

const config: SignalsRunnerConfig = {
  projectRoot:
    String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd(),
  userName: String(flags.user || 'root'),
  interval: String(flags.timeframe ?? 15) as Interval,
  connectorName: String(flags.connector || 'bybit'),
  universe: flags.universe as MarketUniverse | undefined,
  accountId: flags.account ? String(flags.account) : undefined,
  deploymentId: flags.deployment ? String(flags.deployment) : undefined,
  tickers: flags.tickers,
  exclude: flags.exclude,
  tickersLimit: flags.tickersLimit,
  chunk: flags.chunk,
  makeOrders: Boolean(flags.makeOrders),
  notify: Boolean(flags.notify),
  skipScreenshots: Boolean(flags.skipScreenshots),
  updateOnly: Boolean(flags.updateOnly),
  cacheOnly: Boolean(flags.cacheOnly),
  showTickersList: Boolean(flags.showTickersList),
  showSkipStats: Boolean(flags.showSkipStats),
  parallel: flags.parallel,
  watch: Boolean(flags.watch),
  settleDelayMs: flags.settleDelayMs,
  hasExplicitScope,
};

const runner = createSignalsRunner(config);

export const createSignalsSession = runner.createSession;
export const signals = runner.runCycle;
export const signalsConfiguredScopesOnce = runner.runConfiguredScopesOnce;
export const signalsDaemon = runner.runDaemon;

export const main = () =>
  config.watch ? signalsDaemon() : signalsConfiguredScopesOnce();
