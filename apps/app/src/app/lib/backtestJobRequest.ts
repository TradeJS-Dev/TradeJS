import type {
  BacktestJobRequest,
  BacktestPeriodMode,
} from './backtestJobContracts';

const DEFAULT_INTERVAL = '15';
const DEFAULT_CONNECTOR = 'binance';
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const normalizeText = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';
const toPositiveNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};
const toPositiveInteger = (value: unknown) => {
  const parsed = toPositiveNumber(value);
  return parsed == null ? undefined : Math.trunc(parsed);
};

export const normalizeBacktestJobRequest = (
  payload: unknown,
): BacktestJobRequest => {
  if (!isPlainObject(payload)) throw new Error('Invalid backtest request');
  const configId = normalizeText(payload.configId);
  if (!configId) throw new Error('Backtest config is required');
  const strategyName =
    normalizeText(payload.strategyName) || configId.split(':')[0] || configId;
  const periodMode: BacktestPeriodMode =
    payload.periodMode === 'range' ? 'range' : 'days';
  const request: BacktestJobRequest = {
    strategyName,
    configId,
    periodMode,
    ai: payload.ai === true,
    fast: payload.fast === true,
    interval: normalizeText(payload.interval) || DEFAULT_INTERVAL,
    connector: normalizeText(payload.connector) || DEFAULT_CONNECTOR,
  };
  if (periodMode === 'range') {
    const startTime = toPositiveInteger(payload.startTime);
    const endTime = toPositiveInteger(payload.endTime);
    if (!startTime || !endTime || startTime >= endTime) {
      throw new Error('Valid start and end timestamps are required');
    }
    request.startTime = startTime;
    request.endTime = endTime;
  } else {
    request.days = toPositiveNumber(payload.days) ?? 30;
  }

  const tickers = normalizeText(payload.tickers);
  const tickersLimit = toPositiveInteger(payload.tickersLimit);
  const testsLimit = toPositiveInteger(payload.testsLimit);
  const parallel = toPositiveInteger(payload.parallel);
  if (tickers) request.tickers = tickers;
  if (tickersLimit) request.tickersLimit = tickersLimit;
  if (testsLimit) request.testsLimit = testsLimit;
  if (parallel) request.parallel = parallel;
  return request;
};

export const buildBacktestCommandArgs = ({
  request,
  userName,
  skip = 0,
}: {
  request: BacktestJobRequest;
  userName: string;
  skip?: number;
}) => {
  const args = [
    'backtest',
    '--config',
    request.configId,
    '--user',
    userName,
    '--timeframe',
    request.interval,
    '--connector',
    request.connector,
    '--progressStep',
    '1',
  ];
  if (request.periodMode === 'range') {
    args.push(
      '--startTime',
      String(request.startTime),
      '--endTime',
      String(request.endTime),
    );
  } else if (request.days) {
    args.push('--days', String(request.days));
  }
  if (request.ai) args.push('--ai');
  if (request.fast) args.push('--fast');
  if (request.tickers) args.push('--tickers', request.tickers);
  if (request.tickersLimit) {
    args.push('--tickersLimit', String(request.tickersLimit));
  }
  if (request.parallel) args.push('--parallel', String(request.parallel));
  if (skip > 0) args.push('--skip', String(skip));
  if (request.testsLimit) {
    args.push('--tests', String(Math.max(0, request.testsLimit - skip)));
  }
  return args;
};
