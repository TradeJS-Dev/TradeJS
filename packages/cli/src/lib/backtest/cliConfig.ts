import args from 'args';
import os from 'os';
import { Interval } from '@tradejs/types';
import { TESTS_LIMIT, TESTS_TOP_LIMIT } from '@tradejs/core/constants';
import { normalizeCliArgv } from '../cliArgs';

const BYTES_IN_MB = 1024 * 1024;
const MAX_PARALLEL = Math.min(os.cpus().length, 6);

export const resolveDefaultWorkerHeapMb = (
  totalMemoryBytes = os.totalmem(),
) => {
  const totalMemoryMb = Math.max(0, Math.floor(totalMemoryBytes / BYTES_IN_MB));
  if (totalMemoryMb >= 64_000) {
    return 3072;
  }
  if (totalMemoryMb >= 24_000) {
    return 2048;
  }
  return 1536;
};

export const resolveDefaultParallel = (
  totalMemoryBytes = os.totalmem(),
  cpuCount = os.cpus().length,
  workerHeapMb = resolveDefaultWorkerHeapMb(totalMemoryBytes),
) => {
  const totalMemoryMb = Math.max(0, Math.floor(totalMemoryBytes / BYTES_IN_MB));
  const memoryBudgetMb = Math.max(workerHeapMb, totalMemoryMb - 2048);
  const parallelByMemory = Math.max(
    1,
    Math.floor(memoryBudgetMb / workerHeapMb),
  );
  return Math.max(1, Math.min(cpuCount, MAX_PARALLEL, parallelByMemory, 4));
};

const DEFAULT_WORKER_HEAP_MB = resolveDefaultWorkerHeapMb();
const DEFAULT_PARALLEL = resolveDefaultParallel(
  os.totalmem(),
  os.cpus().length,
  DEFAULT_WORKER_HEAP_MB,
);

export const resolveWorkerHeapMb = (
  value: unknown = process.env.BACKTEST_WORKER_HEAP_MB,
  fallback = DEFAULT_WORKER_HEAP_MB,
) => Math.max(256, parseInt(String(value ?? fallback), 10) || fallback);

export const resolveEffectiveParallel = (
  flagValue: unknown,
  envValue: unknown = process.env.BACKTEST_MAX_PARALLEL,
  fallback = MAX_PARALLEL,
) =>
  Math.max(
    1,
    Math.min(
      parseInt(String(flagValue), 10) || fallback,
      parseInt(String(envValue ?? fallback), 10) || fallback,
    ),
  );

export const resolveRequestedTestsLimit = ({
  isLiveMode,
  requestedLimit,
  hasExplicitLimit,
}: {
  isLiveMode: boolean;
  requestedLimit: number;
  hasExplicitLimit: boolean;
}) =>
  isLiveMode && !hasExplicitLimit ? Number.POSITIVE_INFINITY : requestedLimit;

args.example(
  ' yarn backtest -t 400 --cacheOnly',
  'Run tests on uploaded data for 400 tickers',
);

args.option(['t', 'tickers'], 'Selected tickers');
args.option(['e', 'exclude'], 'Exclude tickers from tests');
args.option(['l', 'tickersLimit'], 'Tickers limit');
args.option(['n', 'tests'], 'Tests limit', TESTS_LIMIT);
args.option(['s', 'skip'], 'Skip first N tests', 0);
args.option(['p', 'parallel'], 'Parallel tasks', DEFAULT_PARALLEL);
args.option(['f', 'timeframe'], 'Timeframe', 15);
args.option(['d', 'days'], 'Run backtest only for the last N days');
args.option('startTime', 'Explicit backtest start timestamp (ms or seconds)');
args.option('endTime', 'Explicit backtest end timestamp (ms or seconds)');
args.option(
  ['T', 'top'],
  'Return N best tests for single-ticker grid runs (defaults to 50)',
  TESTS_TOP_LIMIT,
);
args.option(['u', 'updateOnly'], 'Only update tickers history', false);
args.option(['C', 'cacheOnly'], 'Do not update tickers history', false);
args.option(['c', 'config'], 'Backtest config', 'breakout');
args.option(['L', 'showTickersList'], 'Just show only ticker list', false);
args.option(['g', 'progressStep'], 'Progress step', 100);
args.option(['U', 'user'], 'Use user config', 'root');
args.option(
  ['o', 'connector'],
  'Connector provider or name for backtest (e.g. bybit, binance, coinbase, custom)',
  'bybit',
);
args.option(
  ['m', 'ml'],
  'Write ML dataset rows to per-worker JSONL chunks',
  false,
);
args.option(
  ['A', 'ai'],
  'Write AI prompt rows to per-worker JSONL chunks',
  false,
);
args.option(
  'fast',
  'Skip per-test artifact persistence and keep only in-memory summary/AI-ML dataset output',
  false,
);

const hasCliFlag = (argv: string[], names: string[]) =>
  argv.some(
    (arg) =>
      names.includes(arg) || names.some((name) => arg.startsWith(`${name}=`)),
  );

const stripIgnoredFlags = (argv: string[]) =>
  argv.filter((arg) => arg !== '--live' && !arg.startsWith('--live='));

export const normalizedArgv = normalizeCliArgv(
  stripIgnoredFlags(process.argv),
  {
    '--AI': '--ai',
    '--ML': '--ml',
    '-C': '--cacheOnly',
    '-E': '--endTime',
    '-P': '--progressStep',
    '-S': '--startTime',
    '-T': '--top',
    '-U': '--user',
  },
);

export const flags = args.parse(normalizedArgv);
export const interval = String(flags.timeframe ?? 15) as Interval;
export const progressStep = Math.max(
  1,
  parseInt(String(flags.progressStep ?? 100), 10),
);
export const testsLimit = Math.max(0, parseInt(String(flags.tests ?? 0), 10));
export const testsSkip = Math.max(0, parseInt(String(flags.skip ?? 0), 10));
export const hasExplicitTestsLimit = hasCliFlag(normalizedArgv, [
  '--tests',
  '-n',
]);
export const isUpdateOnlyRun = Boolean(flags.updateOnly);
export const isFastMode = Boolean(flags.fast);
export const testItemTimeoutMs = 240_000;
export const workerHeapMb = resolveWorkerHeapMb();
export const effectiveParallel = resolveEffectiveParallel(flags.parallel);
export const resultArtifactsIoConcurrency = Math.max(
  8,
  Math.min(32, effectiveParallel * 4),
);
export const userName = String(flags.user ?? 'root');
export const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
