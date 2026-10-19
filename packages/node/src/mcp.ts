import { createHash } from 'node:crypto';
import { createIndicators } from '@tradejs/core/indicators';
import { intervalToMs } from '@tradejs/core/data';
import {
  getDataStrict,
  getHashData,
  getHashJsonField,
  mcpStorage,
  redisKeys,
  scanDataKeys,
  scanHashJson,
} from '@tradejs/infra/redis';
import { getRuntimeDeploymentHeartbeat } from '@tradejs/infra/runtimeHeartbeats';
import { getTradingAccount } from '@tradejs/infra/tradingAccounts';
import { getRuntimeStorageDayKey } from '@tradejs/core/time';
import type { Interval, MarketUniverse } from '@tradejs/types';
import { ensureIndicatorPluginsLoaded } from './registry';
import { getConnectorCreatorByProvider } from './connectors';
import {
  listRuntimeDeployments,
  loadResolvedRuntimeStrategies,
} from './runtimeStrategies';

export * from './mcpJobs';

export const mcpProjectRoot = () =>
  String(process.env.PROJECT_CWD || process.cwd());
export const isMcpRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const mcpId = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/** Defence in depth for user/config/report payloads. Credentials are never MCP data. */
export const redactMcpData = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactMcpData);
  if (!isMcpRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/secret|password|authorization|api.?key|private.?key|access.?token|refresh.?token|bot.?token|cookie|credential/i.test(
            key,
          ),
      )
      .map(([key, nested]) => [key, redactMcpData(nested)]),
  );
};

const connectorFor = async (
  userName: string,
  provider: string,
  universe: MarketUniverse,
) => {
  const creator = await getConnectorCreatorByProvider(
    provider,
    mcpProjectRoot(),
  );
  if (!creator) throw new Error('Unknown market provider');
  return creator({ userName, universe });
};

export const readMcpMarket = async (
  userName: string,
  provider: string,
  universe: MarketUniverse,
  offset: number,
  limit: number,
  symbol?: string,
) => {
  const connector = await connectorFor(userName, provider, universe);
  const tickers = await connector.getTickers();
  const rows = symbol
    ? tickers.filter((row) => row.symbol === symbol)
    : tickers;
  return {
    provider,
    universe,
    items: rows.slice(offset, offset + limit),
    total: rows.length,
    nextOffset: offset + limit < rows.length ? offset + limit : null,
    observedAt: Date.now(),
    source: 'connector',
  };
};

export const readMcpChart = async (
  userName: string,
  request: {
    provider: string;
    universe: MarketUniverse;
    symbol: string;
    interval: Interval;
    endTime: number;
    bars: number;
    cacheOnly: boolean;
    indicatorNames?: string[];
  },
) => {
  const connector = await connectorFor(
    userName,
    request.provider,
    request.universe,
  );
  const width = intervalToMs(request.interval);
  const end = Math.floor(Math.min(request.endTime, Date.now()) / width) * width;
  const visibleStart = end - request.bars * width;
  const start = Math.max(0, visibleStart - 200 * width);
  const fetched = await connector.kline({
    symbol: request.symbol,
    interval: request.interval,
    start,
    end,
    cacheOnly: request.cacheOnly,
  });
  const candles = fetched.filter(
    (candle) => candle.timestamp >= start && candle.timestamp < end,
  );
  const btc =
    request.universe === 'tradfi'
      ? []
      : request.symbol === 'BTCUSDT'
        ? candles
        : await connector.kline({
            symbol: 'BTCUSDT',
            interval: request.interval,
            start,
            end,
            cacheOnly: request.cacheOnly,
          });
  const visibleCandles = candles
    .filter((candle) => candle.timestamp >= visibleStart)
    .slice(-request.bars);
  await ensureIndicatorPluginsLoaded(mcpProjectRoot());
  const allIndicators = createIndicators(
    candles,
    btc.filter((candle) => candle.timestamp < end),
    {
      includeMlPayload: false,
      pluginRegistryScope: mcpProjectRoot(),
    },
  ).result();
  return {
    ...request,
    startTime: visibleStart,
    historyStartTime: start,
    warmupBars: 200,
    endTime: end,
    candles: visibleCandles,
    indicators: Object.fromEntries(
      (request.indicatorNames || ['maFast', 'maSlow', 'atr', 'macd']).map(
        (key) => [
          key,
          Array.isArray(allIndicators[key as keyof typeof allIndicators])
            ? allIndicators[key as keyof typeof allIndicators].slice(
                -request.bars,
              )
            : allIndicators[key as keyof typeof allIndicators] ?? null,
        ],
      ),
    ),
    availableIndicators: Object.keys(allIndicators),
    observedAt: Date.now(),
    source: request.cacheOnly ? 'cached_history' : 'connector',
    closedCandlesOnly: true,
    coverage: {
      requestedBars: request.bars,
      availableBars: candles.filter(
        (candle) => candle.timestamp >= visibleStart,
      ).length,
      complete:
        candles.filter((candle) => candle.timestamp >= visibleStart).length >=
        request.bars,
    },
  };
};

export const readMcpDeployments = async (userName: string) => {
  const deployments = await listRuntimeDeployments({
    userName,
    projectRoot: mcpProjectRoot(),
  });
  const allowed = [];
  for (const deployment of deployments) {
    // Project declarations are global; access requires the user's account binding.
    if (!(await getTradingAccount(userName, deployment.accountId))) continue;
    allowed.push({
      ...deployment,
      heartbeat: await getRuntimeDeploymentHeartbeat(userName, deployment.id),
    });
  }
  return {
    deployments: allowed,
    observedAt: Date.now(),
    source: 'project_declaration_and_runtime_storage',
  };
};

export const requireMcpDeployment = async (
  userName: string,
  deploymentId: string,
) => {
  const { deployments } = await readMcpDeployments(userName);
  const deployment = deployments.find((row) => row.id === deploymentId);
  if (!deployment) throw new Error('Deployment unavailable for this user');
  return deployment;
};

export const readMcpStrategies = async (
  userName: string,
  deploymentId: string,
) => {
  const deployment = await requireMcpDeployment(userName, deploymentId);
  const rows = await loadResolvedRuntimeStrategies({
    userName,
    projectRoot: mcpProjectRoot(),
    deploymentId,
  });
  return {
    deploymentId,
    accountId: deployment.accountId,
    strategies: rows.map(({ strategyCreator: _creator, ...row }) => row),
    observedAt: Date.now(),
  };
};

export class McpCursorError extends Error {
  constructor(readonly code: 'CURSOR_EXPIRED' | 'CURSOR_MISMATCH') {
    super(
      code === 'CURSOR_EXPIRED'
        ? 'Invalid storage cursor: expired or unavailable; restart the same window and deduplicate record identities'
        : 'Invalid storage cursor: user, account or filters changed',
    );
    this.name = 'McpCursorError';
  }
}
const RUNTIME_CURSOR_TTL = 86400;
type RuntimeCursor = {
  binding: string;
  scan: string;
  keys: string[];
  hash: string;
  values: unknown[];
  scanned: boolean;
};
export const readMcpRuntimePage = async (
  userName: string,
  kind: 'signals' | 'evaluations' | 'orders',
  request: {
    deploymentId: string;
    cursor: string;
    startTime: number;
    endTime: number;
    strategy?: string;
    symbol?: string;
    limit?: number;
  },
) => {
  const deployment = await requireMcpDeployment(userName, request.deploymentId);
  const prefix =
    kind === 'signals'
      ? redisKeys.runtimeSignalBuckets(userName)
      : kind === 'evaluations'
        ? redisKeys.runtimeSignalEvaluationBuckets(userName)
        : redisKeys.runtimeTrades(userName);
  const limit = request.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new Error('Select a page limit of 1–50');
  // Explicit fields make identity independent of JSON argument insertion order.
  const binding = mcpId(
    JSON.stringify({
      userName,
      kind,
      accountId: deployment.accountId,
      deploymentId: request.deploymentId,
      startTime: request.startTime,
      endTime: request.endTime,
      strategy: request.strategy ?? null,
      symbol: request.symbol ?? null,
    }),
  );
  let state: RuntimeCursor = {
    binding,
    scan: '0',
    keys: [],
    hash: '0',
    values: [],
    scanned: false,
  };
  if (request.cursor !== '0') {
    const saved = await mcpStorage.get<RuntimeCursor>(
      `cursor:${request.cursor}`,
    );
    if (!saved) throw new McpCursorError('CURSOR_EXPIRED');
    if (saved.binding !== binding) throw new McpCursorError('CURSOR_MISMATCH');
    state = structuredClone(saved);
  }
  const items: Record<string, unknown>[] = [];
  let storageReads = 0;
  let inspected = 0;
  let responseBytes = 0;
  // Bound work as well as output. Sparse scans may still require continuation.
  while (items.length < limit && storageReads < 40 && inspected < 1000) {
    if (!state.values.length) {
      if (!state.keys.length) {
        if (state.scanned && state.scan === '0') break;
        const page = await scanDataKeys(prefix, state.scan);
        storageReads++;
        state.scan = page.cursor;
        state.scanned = true;
        state.keys = page.keys.filter((key) => {
          if (kind === 'orders')
            return !key.slice(prefix.length).startsWith('days:');
          const suffix = key.slice(prefix.length);
          const day = suffix.slice(0, 10);
          // Runtime buckets use the shared storage-day convention. Ignore unrelated day/strategy buckets.
          return (
            day >= getRuntimeStorageDayKey(request.startTime) &&
            day <= getRuntimeStorageDayKey(request.endTime - 1) &&
            (!request.strategy || suffix.slice(11) === request.strategy)
          );
        });
        if (!state.keys.length) continue;
      }
      const key = state.keys[0];
      storageReads++;
      if (kind === 'orders') {
        state.keys.shift();
        state.values = [await getDataStrict(key)];
      } else {
        const page = await scanHashJson(key, state.hash);
        state.values = page.values;
        state.hash = page.cursor;
        if (page.cursor === '0') state.keys.shift();
      }
      if (!state.values.length) continue;
    }
    let row = state.values.shift();
    inspected++;
    if (
      kind === 'signals' &&
      isMcpRecord(row) &&
      typeof row.symbol === 'string' &&
      typeof row.signalId === 'string'
    )
      row = await getDataStrict(
        redisKeys.storeSignal(row.symbol, row.signalId),
      );
    if (
      !isMcpRecord(row) ||
      row.deploymentId !== request.deploymentId ||
      row.accountId !== deployment.accountId ||
      (row.userName !== undefined && row.userName !== userName) ||
      (request.strategy && row.strategy !== request.strategy) ||
      (request.symbol && row.symbol !== request.symbol)
    )
      continue;
    const timestamp = Number(
      row.timestamp ?? row.entryTimestamp ?? row.createdAt,
    );
    if (
      timestamp < request.startTime ||
      timestamp >= request.endTime ||
      !Number.isFinite(timestamp)
    )
      continue;
    const {
      figures: _figures,
      indicators: _indicators,
      additionalIndicators: _additional,
      ...summary
    } = row;
    const bytes = Buffer.byteLength(JSON.stringify(summary));
    if (bytes > 80000)
      throw new Error(
        'Response too large. Use runtime_get_signal for record details.',
      );
    if (responseBytes + bytes > 80000) {
      state.values.unshift(row);
      break;
    }
    responseBytes += bytes;
    items.push(summary);
  }
  let next = '0';
  if (state.values.length || state.keys.length || state.scan !== '0') {
    // Content-addressed continuations make retries return the same next token.
    next = mcpId(JSON.stringify(state));
    if (!(await mcpStorage.put(`cursor:${next}`, state, RUNTIME_CURSOR_TTL)))
      throw new Error('MCP cursor persistence failed');
  }
  return {
    items,
    cursor: next,
    deploymentId: request.deploymentId,
    observedAt: Date.now(),
    source: 'runtime_storage',
    window: { startTime: request.startTime, endTime: request.endTime },
    coverage: 'stored_records_only',
    pagination: {
      scanComplete: next === '0',
      storageReads,
      inspected,
      cursorTtlSeconds: RUNTIME_CURSOR_TTL,
      consistency: 'mutable_storage_scan',
      order: 'storage_scan',
      retentionStartTime: null,
      persistenceCompleteness: 'unknown',
    },
    note: 'Continue until cursor=0, including empty pages. Cursors are shared across server processes and retained for 24 hours. Retry identical requests after transport failures. If CURSOR_EXPIRED, restart the same window and deduplicate record identities. Storage scans may repeat rows and are not immutable snapshots; missing records do not prove no activity.',
  };
};

export const readMcpSignal = async (
  userName: string,
  signalId: string,
  deploymentId: string,
  timestamp: number,
  strategy: string,
) => {
  const deployment = await requireMcpDeployment(userName, deploymentId);
  const ref = await getHashJsonField<unknown>(
    redisKeys.runtimeSignalBucket(
      userName,
      getRuntimeStorageDayKey(timestamp),
      strategy,
    ),
    signalId,
    null,
  );
  if (!isMcpRecord(ref) || typeof ref.symbol !== 'string')
    throw new Error('Signal not found');
  const signal = await getDataStrict(
    redisKeys.storeSignal(ref.symbol, signalId),
  );
  if (
    !isMcpRecord(signal) ||
    signal.deploymentId !== deploymentId ||
    signal.accountId !== deployment.accountId ||
    (signal.userName !== undefined && signal.userName !== userName)
  )
    throw new Error('Signal not found');
  return { signal, observedAt: Date.now(), source: 'runtime_storage' };
};

export const readMcpEvaluationStats = async (
  userName: string,
  deploymentId: string,
  cursor: string,
) => {
  await requireMcpDeployment(userName, deploymentId);
  const page = await scanDataKeys(
    redisKeys.runtimeSignalEvaluationStatsBuckets(userName),
    cursor,
  );
  const buckets = [];
  for (const key of page.keys) {
    const parts = key
      .slice(redisKeys.runtimeSignalEvaluationStatsBuckets(userName).length)
      .split(':');
    if (parts.slice(1, -1).join(':') !== deploymentId) continue;
    buckets.push({
      bucket: key.slice(
        redisKeys.runtimeSignalEvaluationStatsBuckets(userName).length,
      ),
      counters: await getHashData(key),
    });
  }
  return {
    buckets,
    cursor: page.cursor,
    observedAt: Date.now(),
    source: 'debug_telemetry',
    immutableEvidence: false,
    note: 'Aggregate counters are not composition-bound evidence. Detailed skip records may not have been captured.',
  };
};

export const readMcpBacktestPage = async (
  userName: string,
  kind: 'configs' | 'results',
  cursor: string,
) => {
  const prefix =
    kind === 'configs'
      ? `users:${userName}:backtests:configs:`
      : `users:${userName}:backtests:results:`;
  const page = await scanDataKeys(prefix, cursor);
  const items = [];
  for (const key of page.keys) {
    const value = await getDataStrict(key);
    items.push({
      id: key.slice(prefix.length),
      value:
        kind === 'results' && isMcpRecord(value)
          ? {
              config: value.config,
              mode: value.mode,
              startedAt: value.startedAt,
              finishedAt: value.finishedAt,
              successTests: value.successTests,
              errorTests: value.errorTests,
              resultCount: Array.isArray(value.results)
                ? value.results.length
                : 0,
            }
          : value,
    });
  }
  return {
    items,
    cursor: page.cursor,
    observedAt: Date.now(),
    source: 'backtest_storage',
  };
};

export const readMcpBacktestResult = async (
  userName: string,
  id: string,
  offset = 0,
  limit = 20,
) => {
  if (id.includes('*') || id.includes('?') || id.includes('['))
    throw new Error('Invalid result identifier');
  const result = await getDataStrict(
    `users:${userName}:backtests:results:${id}`,
  );
  if (!result) throw new Error('Result not found');
  const record = isMcpRecord(result) ? result : { results: result };
  const groups = ['results', 'resultsByTickers', 'resultsByStrategies'];
  const pageGroup = (group: string) =>
    Array.isArray(record[group])
      ? record[group].slice(offset, offset + limit)
      : record[group];
  const paged = {
    results: pageGroup('results'),
    resultsByTickers: pageGroup('resultsByTickers'),
    resultsByStrategies: pageGroup('resultsByStrategies'),
  };
  const total = Math.max(
    0,
    ...groups.map((group) =>
      Array.isArray(record[group]) ? record[group].length : 0,
    ),
  );
  return {
    id,
    result: {
      config: record.config,
      mode: record.mode,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      successTests: record.successTests,
      errorTests: record.errorTests,
      bestConfig: record.bestConfig,
      mergedConfig: record.mergedConfig,
      runtimeComparison: record.runtimeComparison,
      ...paged,
    },
    offset,
    total,
    nextOffset: offset + limit < total ? offset + limit : null,
    observedAt: Date.now(),
    source: 'backtest_storage',
  };
};
