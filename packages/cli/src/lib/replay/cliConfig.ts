import args from 'args';
import { Interval } from '@tradejs/types';
import { normalizeCliArgv } from '../cliArgs';

const REPLAY_UNSUPPORTED_FLAGS = [
  ['--live', '`yarn replay` is already the replacement for legacy `--live`.'],
  ['--config', '`yarn replay` does not use backtest configs.'],
  ['-c', '`yarn replay` does not use backtest configs.'],
  ['--tests', '`yarn replay` does not split work into backtest test cases.'],
  ['-n', '`yarn replay` does not split work into backtest test cases.'],
  ['--skip', '`yarn replay` does not support skipping backtest test cases.'],
  ['-s', '`yarn replay` does not support skipping backtest test cases.'],
  ['--parallel', '`yarn replay` does not use backtest worker parallelism.'],
  ['-p', '`yarn replay` does not use backtest worker parallelism.'],
  ['--top', '`yarn replay` does not rank top backtest variants.'],
  ['-T', '`yarn replay` does not rank top backtest variants.'],
  ['--ml', '`yarn replay` does not write ML dataset rows.'],
  ['-m', '`yarn replay` does not write ML dataset rows.'],
  ['--ai', '`yarn replay` does not write AI dataset rows.'],
  ['-A', '`yarn replay` does not write AI dataset rows.'],
  [
    '--progressStep',
    '`yarn replay` does not use backtest worker progress steps.',
  ],
  ['-g', '`yarn replay` does not use backtest worker progress steps.'],
] as const;

const hasCliFlag = (argv: string[], names: readonly string[]) =>
  argv.some(
    (arg) =>
      names.includes(arg) || names.some((name) => arg.startsWith(`${name}=`)),
  );

const assertNoUnsupportedReplayFlags = (argv: string[]) => {
  for (const [flag, message] of REPLAY_UNSUPPORTED_FLAGS) {
    if (hasCliFlag(argv, [flag])) {
      throw new Error(message);
    }
  }
};

args.example(
  'yarn replay --days 7 --cacheOnly',
  'Replay active runtime strategies on historical data',
);

args.option(['t', 'tickers'], 'Selected tickers');
args.option(['e', 'exclude'], 'Exclude tickers from replay');
args.option(['l', 'tickersLimit'], 'Tickers limit');
args.option(['f', 'timeframe'], 'Timeframe', 15);
args.option(['d', 'days'], 'Run replay only for the last N days');
args.option('startTime', 'Explicit replay start timestamp (ms or seconds)');
args.option('endTime', 'Explicit replay end timestamp (ms or seconds)');
args.option(['u', 'updateOnly'], 'Only update tickers history', false);
args.option(['C', 'cacheOnly'], 'Do not update tickers history', false);
args.option(['L', 'showTickersList'], 'Just show only ticker list', false);
args.option(['U', 'user'], 'Use user config', 'root');
args.option(
  ['o', 'connector'],
  'Connector provider or name for replay (e.g. bybit, binance, coinbase, custom)',
  'bybit',
);

export const replayNormalizedArgv = normalizeCliArgv(process.argv, {
  '-C': '--cacheOnly',
  '-E': '--endTime',
  '-S': '--startTime',
  '-U': '--user',
});

assertNoUnsupportedReplayFlags(replayNormalizedArgv);

export const replayFlags = args.parse(replayNormalizedArgv);
export const replayInterval = String(replayFlags.timeframe ?? 15) as Interval;
export const replayUserName = String(replayFlags.user ?? 'root');
export const replayProjectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
export const isReplayUpdateOnlyRun = Boolean(replayFlags.updateOnly);
