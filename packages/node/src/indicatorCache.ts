import { createHash } from 'node:crypto';
import {
  BaseContextBackend,
  createIndicators,
  IndicatorsControllerCheckpointState,
  IndicatorPeriods,
} from '@tradejs/core/indicators';
import { Candle } from '@tradejs/types';
import {
  deleteAllIndicatorCacheObsoleteVersions,
  getIndicatorCacheRange,
  getLatestIndicatorCacheCheckpointAtOrBefore,
  resetIndicatorCacheTables,
  upsertIndicatorCacheCheckpointRows,
  upsertIndicatorCacheCoverageRows,
} from '@tradejs/infra/timescale';

const INDICATOR_CACHE_VERSION = 'v12';
const INDICATOR_CACHE_CHECKPOINT_INTERVAL = 256;
const INDICATOR_CACHE_PROFILE =
  process.env.TRADEJS_INDICATOR_CACHE_PROFILE === '1';
const indicatorRestorePlanCache = new Map<string, IndicatorCacheRestorePlan>();
const indicatorRuntimeStatePlanCache = new Map<
  string,
  IndicatorCacheRestorePlan
>();
const referenceCandleSignatureCache = new WeakMap<
  Candle[],
  Array<string | null | undefined>
>();
const candleRangeDigestCache = new WeakMap<Candle[], string>();

type IndicatorCacheProfileStats = {
  planCalls: number;
  planCacheHits: number;
  planMs: number;
  cacheReadMs: number;
  compareMs: number;
  checkpointReadMs: number;
  materializeCalls: number;
  materializeMs: number;
  controllerInitMs: number;
  replayLoopMs: number;
  nextMs: number;
  coverageBuildMs: number;
  checkpointBuildMs: number;
  coverageUpsertMs: number;
  checkpointUpsertMs: number;
  replayCandles: number;
  coverageRows: number;
  checkpointRows: number;
  runtimeResolveCalls: number;
  runtimeResolveCacheHits: number;
  runtimeResolveMs: number;
  runtimeResolveReplayMs: number;
  runtimeResolveNextMs: number;
  runtimeResolveCandles: number;
};

const indicatorCacheProfile: IndicatorCacheProfileStats = {
  planCalls: 0,
  planCacheHits: 0,
  planMs: 0,
  cacheReadMs: 0,
  compareMs: 0,
  checkpointReadMs: 0,
  materializeCalls: 0,
  materializeMs: 0,
  controllerInitMs: 0,
  replayLoopMs: 0,
  nextMs: 0,
  coverageBuildMs: 0,
  checkpointBuildMs: 0,
  coverageUpsertMs: 0,
  checkpointUpsertMs: 0,
  replayCandles: 0,
  coverageRows: 0,
  checkpointRows: 0,
  runtimeResolveCalls: 0,
  runtimeResolveCacheHits: 0,
  runtimeResolveMs: 0,
  runtimeResolveReplayMs: 0,
  runtimeResolveNextMs: 0,
  runtimeResolveCandles: 0,
};

const profileNow = () => process.hrtime.bigint();
const PROFILE_ZERO = BigInt(0);

const profileElapsedMs = (startedAt: bigint) =>
  Number(process.hrtime.bigint() - startedAt) / 1_000_000;

if (INDICATOR_CACHE_PROFILE) {
  process.once('exit', () => {
    const round = (value: number) => Number(value.toFixed(2));
    const stats = indicatorCacheProfile;
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          indicatorCacheProfile: {
            plan: {
              calls: stats.planCalls,
              cacheHits: stats.planCacheHits,
              totalMs: round(stats.planMs),
              cacheReadMs: round(stats.cacheReadMs),
              compareMs: round(stats.compareMs),
              checkpointReadMs: round(stats.checkpointReadMs),
            },
            materialize: {
              calls: stats.materializeCalls,
              totalMs: round(stats.materializeMs),
              controllerInitMs: round(stats.controllerInitMs),
              replayLoopMs: round(stats.replayLoopMs),
              nextMs: round(stats.nextMs),
              coverageBuildMs: round(stats.coverageBuildMs),
              checkpointBuildMs: round(stats.checkpointBuildMs),
              coverageUpsertMs: round(stats.coverageUpsertMs),
              checkpointUpsertMs: round(stats.checkpointUpsertMs),
              replayCandles: stats.replayCandles,
              coverageRows: stats.coverageRows,
              checkpointRows: stats.checkpointRows,
              avgNextUs:
                stats.replayCandles > 0
                  ? round((stats.nextMs * 1_000) / stats.replayCandles)
                  : null,
            },
            runtimeResolve: {
              calls: stats.runtimeResolveCalls,
              cacheHits: stats.runtimeResolveCacheHits,
              totalMs: round(stats.runtimeResolveMs),
              replayMs: round(stats.runtimeResolveReplayMs),
              nextMs: round(stats.runtimeResolveNextMs),
              candles: stats.runtimeResolveCandles,
              avgNextUs:
                stats.runtimeResolveCandles > 0
                  ? round(
                      (stats.runtimeResolveNextMs * 1_000) /
                        stats.runtimeResolveCandles,
                    )
                  : null,
            },
          },
        },
        null,
        2,
      ),
    );
  });
}

type IndicatorCacheObsoleteCleanupOptions = Omit<
  Parameters<typeof deleteAllIndicatorCacheObsoleteVersions>[0],
  'keepVersion'
>;

export const cleanIndicatorCacheObsoleteVersions = (
  options: IndicatorCacheObsoleteCleanupOptions = {},
) =>
  deleteAllIndicatorCacheObsoleteVersions({
    ...options,
    keepVersion: INDICATOR_CACHE_VERSION,
  });

export const resetIndicatorCacheInMemoryState = () => {
  indicatorRestorePlanCache.clear();
  indicatorRuntimeStatePlanCache.clear();
};

export const resetIndicatorCache = async () => {
  resetIndicatorCacheInMemoryState();
  return resetIndicatorCacheTables();
};

type EnsureIndicatorCacheCoverageParams = {
  provider: string;
  symbol: string;
  interval: number;
  periods?: Partial<IndicatorPeriods>;
  data: Candle[];
  btcData: Candle[];
  btcBinanceData?: Candle[];
  btcCoinbaseData?: Candle[];
  baseContextBackend?: BaseContextBackend;
};

export type IndicatorCacheRestorePlan = {
  paramsHash: string;
  version: string;
  restoreState: IndicatorsControllerCheckpointState | null;
  replayStartIndex: number;
  cached: boolean;
};

type IndicatorCacheCoverageSnapshot = {
  timestamp: number;
  candleSignature: string | null;
  btcCandleSignature: string | null;
  ready: boolean;
};

type IndicatorCacheCheckpointSnapshot = {
  timestamp: number;
  runtimeState: IndicatorsControllerCheckpointState;
};

const cloneRestoreState = (
  value: IndicatorsControllerCheckpointState | null,
) => (value == null ? null : structuredClone(value));

const cloneIndicatorCacheRestorePlan = (
  plan: IndicatorCacheRestorePlan,
): IndicatorCacheRestorePlan => ({
  ...plan,
  restoreState: cloneRestoreState(plan.restoreState),
});

const buildRestorePlanCacheKey = (params: {
  provider: string;
  symbol: string;
  interval: number;
  paramsHash: string;
  data: Candle[];
  btcData: Candle[];
  btcBinanceData?: Candle[];
  btcCoinbaseData?: Candle[];
}) =>
  [
    params.provider,
    params.symbol,
    params.interval,
    params.paramsHash,
    buildCandleRangeDigest(params.data),
    buildCandleRangeDigest(params.btcData),
    buildCandleRangeDigest(params.btcBinanceData),
    buildCandleRangeDigest(params.btcCoinbaseData),
  ].join(':');

const toStablePeriods = (periods?: Partial<IndicatorPeriods>) => ({
  atr: periods?.atr ?? null,
  atrPctLong: periods?.atrPctLong ?? null,
  atrPctShort: periods?.atrPctShort ?? null,
  bb: periods?.bb ?? null,
  bbStd: periods?.bbStd ?? null,
  levelDelay: periods?.levelDelay ?? null,
  levelLookback: periods?.levelLookback ?? null,
  maFast: periods?.maFast ?? null,
  maMedium: periods?.maMedium ?? null,
  maSlow: periods?.maSlow ?? null,
  macdFast: periods?.macdFast ?? null,
  macdSignal: periods?.macdSignal ?? null,
  macdSlow: periods?.macdSlow ?? null,
  obvSma: periods?.obvSma ?? null,
});

export const buildIndicatorCacheParamsHash = (
  params: Pick<
    EnsureIndicatorCacheCoverageParams,
    'provider' | 'interval' | 'periods'
  > & {
    btcProvider?: string;
    btcBinanceProvider?: string;
    btcCoinbaseProvider?: string;
  },
) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        version: INDICATOR_CACHE_VERSION,
        provider: params.provider,
        interval: params.interval,
        periods: toStablePeriods(params.periods),
        references: {
          btcProvider: params.btcProvider ?? null,
          btcBinanceProvider: params.btcBinanceProvider ?? null,
          btcCoinbaseProvider: params.btcCoinbaseProvider ?? null,
        },
      }),
    )
    .digest('hex');

export const ensureIndicatorCacheCoverage = async ({
  provider,
  symbol,
  interval,
  periods,
  data,
  btcData,
  btcBinanceData,
  btcCoinbaseData,
}: EnsureIndicatorCacheCoverageParams) => {
  const restorePlan = await planIndicatorCacheRestore({
    provider,
    symbol,
    interval,
    periods,
    data,
    btcData,
    btcBinanceData,
    btcCoinbaseData,
  });
  await materializeIndicatorCachePlan({
    provider,
    symbol,
    interval,
    periods,
    data,
    btcData,
    btcBinanceData,
    btcCoinbaseData,
    paramsHash: restorePlan.paramsHash,
    restoreState: restorePlan.restoreState,
    replayStartIndex: restorePlan.replayStartIndex,
    cached: restorePlan.cached,
  });
  return {
    paramsHash: restorePlan.paramsHash,
    version: restorePlan.version,
    cached: restorePlan.cached,
  };
};

const buildCandleSignature = (candle: Candle | undefined): string | null => {
  if (!candle) return null;
  return `${candle.timestamp}:${candle.open}:${candle.high}:${candle.low}:${candle.close}:${candle.volume}:${candle.turnover}`;
};

const buildCandleRangeDigest = (candles: Candle[] | undefined): string => {
  if (!candles?.length) return 'empty';
  const cached = candleRangeDigestCache.get(candles);
  if (cached) return cached;

  const hash = createHash('sha1');
  hash.update(String(candles.length));
  for (const candle of candles) {
    hash.update('|');
    hash.update(buildCandleSignature(candle) ?? 'null');
  }

  const digest = hash.digest('hex');
  candleRangeDigestCache.set(candles, digest);
  return digest;
};

const getReferenceCandleSignatureAt = (
  candles: Candle[],
  index: number,
): string | null => {
  const candle = candles[index];
  if (!candle) return null;
  let signatures = referenceCandleSignatureCache.get(candles);
  if (!signatures) {
    signatures = [];
    referenceCandleSignatureCache.set(candles, signatures);
  }
  const cached = signatures[index];
  if (cached !== undefined) return cached;
  const signature = buildCandleSignature(candle);
  signatures[index] = signature;
  return signature;
};

const findCandleIndexByTimestamp = (candles: Candle[], timestamp: number) => {
  let left = 0;
  let right = candles.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const value = candles[mid].timestamp;
    if (value === timestamp) return mid;
    if (value < timestamp) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return -1;
};

const toCacheRows = async (params: {
  provider: string;
  symbol: string;
  interval: number;
  paramsHash: string;
  startMs: number;
  endMs: number;
}) => {
  const rows = await getIndicatorCacheRange({
    provider: params.provider,
    symbol: params.symbol,
    interval: params.interval,
    paramsHash: params.paramsHash,
    version: INDICATOR_CACHE_VERSION,
    startMs: params.startMs,
    endMs: params.endMs,
  });

  return rows.map((row) => row.snapshot as IndicatorCacheCoverageSnapshot);
};

export const planIndicatorCacheRestore = async ({
  provider,
  symbol,
  interval,
  periods,
  data,
  btcData,
  btcBinanceData,
  btcCoinbaseData,
}: EnsureIndicatorCacheCoverageParams): Promise<IndicatorCacheRestorePlan> => {
  const profileStartedAt = INDICATOR_CACHE_PROFILE
    ? profileNow()
    : PROFILE_ZERO;
  if (INDICATOR_CACHE_PROFILE) {
    indicatorCacheProfile.planCalls += 1;
  }
  const paramsHash = buildIndicatorCacheParamsHash({
    provider,
    interval,
    periods,
    btcProvider: provider,
    btcBinanceProvider: btcBinanceData?.length ? 'binance' : undefined,
    btcCoinbaseProvider: btcCoinbaseData?.length ? 'coinbase' : undefined,
  });

  if (!data.length) {
    return {
      paramsHash,
      version: INDICATOR_CACHE_VERSION,
      restoreState: null,
      replayStartIndex: 0,
      cached: false,
    };
  }

  const planCacheKey = buildRestorePlanCacheKey({
    provider,
    symbol,
    interval,
    paramsHash,
    data,
    btcData,
    btcBinanceData,
    btcCoinbaseData,
  });
  const cachedPlan = indicatorRestorePlanCache.get(planCacheKey);
  if (cachedPlan) {
    if (INDICATOR_CACHE_PROFILE) {
      indicatorCacheProfile.planCacheHits += 1;
      indicatorCacheProfile.planMs += profileElapsedMs(profileStartedAt);
    }
    return cloneIndicatorCacheRestorePlan(cachedPlan);
  }

  const cacheReadStartedAt = INDICATOR_CACHE_PROFILE
    ? profileNow()
    : PROFILE_ZERO;
  const cachedRows = await toCacheRows({
    provider,
    symbol,
    interval,
    paramsHash,
    startMs: data[0].timestamp,
    endMs: data[data.length - 1].timestamp,
  });
  if (INDICATOR_CACHE_PROFILE) {
    indicatorCacheProfile.cacheReadMs += profileElapsedMs(cacheReadStartedAt);
  }

  const compareStartedAt = INDICATOR_CACHE_PROFILE
    ? profileNow()
    : PROFILE_ZERO;
  let validPrefixLength = 0;
  const comparableLength = Math.min(cachedRows.length, data.length);
  for (let index = 0; index < comparableLength; index += 1) {
    const row = cachedRows[index];
    if (
      row.timestamp !== data[index].timestamp ||
      row.candleSignature !== buildCandleSignature(data[index]) ||
      row.btcCandleSignature !== getReferenceCandleSignatureAt(btcData, index)
    ) {
      break;
    }

    validPrefixLength += 1;
  }
  if (INDICATOR_CACHE_PROFILE) {
    indicatorCacheProfile.compareMs += profileElapsedMs(compareStartedAt);
  }

  const lastValidRow =
    validPrefixLength > 0 ? cachedRows[validPrefixLength - 1] : null;
  const checkpointReadStartedAt = INDICATOR_CACHE_PROFILE
    ? profileNow()
    : PROFILE_ZERO;
  const checkpoint =
    lastValidRow == null
      ? null
      : await getLatestIndicatorCacheCheckpointAtOrBefore({
          provider,
          symbol,
          interval,
          paramsHash,
          version: INDICATOR_CACHE_VERSION,
          tsMs: lastValidRow.timestamp,
        });
  if (INDICATOR_CACHE_PROFILE) {
    indicatorCacheProfile.checkpointReadMs += profileElapsedMs(
      checkpointReadStartedAt,
    );
  }
  const checkpointSnapshot =
    (checkpoint?.snapshot as IndicatorCacheCheckpointSnapshot | null) ?? null;
  const checkpointIndex =
    checkpointSnapshot == null
      ? -1
      : findCandleIndexByTimestamp(data, checkpointSnapshot.timestamp);
  const canRestoreFromCheckpoint =
    checkpointSnapshot?.runtimeState != null &&
    checkpointIndex >= 0 &&
    checkpointIndex < validPrefixLength;
  const replayStartIndex = canRestoreFromCheckpoint ? checkpointIndex + 1 : 0;

  const plan: IndicatorCacheRestorePlan = {
    paramsHash,
    version: INDICATOR_CACHE_VERSION,
    restoreState: canRestoreFromCheckpoint
      ? checkpointSnapshot.runtimeState
      : null,
    replayStartIndex,
    cached:
      validPrefixLength === data.length &&
      data.length > 0 &&
      replayStartIndex === data.length,
  };

  indicatorRestorePlanCache.set(
    planCacheKey,
    cloneIndicatorCacheRestorePlan(plan),
  );

  const result = cloneIndicatorCacheRestorePlan(plan);
  if (INDICATOR_CACHE_PROFILE) {
    indicatorCacheProfile.planMs += profileElapsedMs(profileStartedAt);
  }
  return result;
};

export const materializeIndicatorCachePlan = async (
  params: EnsureIndicatorCacheCoverageParams &
    Pick<
      IndicatorCacheRestorePlan,
      'paramsHash' | 'restoreState' | 'replayStartIndex' | 'cached'
    >,
) => {
  const profileStartedAt = INDICATOR_CACHE_PROFILE
    ? profileNow()
    : PROFILE_ZERO;
  if (INDICATOR_CACHE_PROFILE) {
    indicatorCacheProfile.materializeCalls += 1;
  }
  if (!params.data.length) {
    return;
  }

  if (params.cached && params.replayStartIndex >= params.data.length) {
    return;
  }

  const controllerInitStartedAt = INDICATOR_CACHE_PROFILE
    ? profileNow()
    : PROFILE_ZERO;
  const controller = createIndicators([], [], {
    includeMlPayload: false,
    runtimeOnly: true,
    periods: params.periods,
    btcBinanceData: params.btcBinanceData,
    btcCoinbaseData: params.btcCoinbaseData,
    baseContextBackend: params.baseContextBackend,
    initialRuntimeState: params.restoreState ?? undefined,
  });
  if (INDICATOR_CACHE_PROFILE) {
    indicatorCacheProfile.controllerInitMs += profileElapsedMs(
      controllerInitStartedAt,
    );
  }
  if (typeof controller.checkpointRuntimeState !== 'function') {
    return;
  }

  const coverageRows: Parameters<typeof upsertIndicatorCacheCoverageRows>[0] =
    [];
  const checkpointRows: Parameters<
    typeof upsertIndicatorCacheCheckpointRows
  >[0] = [];

  const replayLoopStartedAt = INDICATOR_CACHE_PROFILE
    ? profileNow()
    : PROFILE_ZERO;
  for (
    let absoluteIndex = params.replayStartIndex;
    absoluteIndex < params.data.length;
    absoluteIndex += 1
  ) {
    const index = absoluteIndex - params.replayStartIndex;
    const candle = params.data[absoluteIndex];
    const btcCandle = params.btcData[absoluteIndex];
    const nextStartedAt = INDICATOR_CACHE_PROFILE ? profileNow() : PROFILE_ZERO;
    const snapshot = controller.next(candle, btcCandle);
    if (INDICATOR_CACHE_PROFILE) {
      indicatorCacheProfile.nextMs += profileElapsedMs(nextStartedAt);
      indicatorCacheProfile.replayCandles += 1;
    }
    const coverageBuildStartedAt = INDICATOR_CACHE_PROFILE
      ? profileNow()
      : PROFILE_ZERO;
    const coverageSnapshot: IndicatorCacheCoverageSnapshot = {
      timestamp: candle.timestamp,
      candleSignature: buildCandleSignature(candle),
      btcCandleSignature: buildCandleSignature(btcCandle),
      ready: snapshot != null,
    };

    coverageRows.push({
      provider: params.provider,
      symbol: params.symbol,
      interval: params.interval,
      paramsHash: params.paramsHash,
      version: INDICATOR_CACHE_VERSION,
      ts: new Date(candle.timestamp),
      snapshot: coverageSnapshot,
    });
    if (INDICATOR_CACHE_PROFILE) {
      indicatorCacheProfile.coverageBuildMs += profileElapsedMs(
        coverageBuildStartedAt,
      );
      indicatorCacheProfile.coverageRows += 1;
    }

    const isLast = absoluteIndex === params.data.length - 1;
    const isCheckpoint = index % INDICATOR_CACHE_CHECKPOINT_INTERVAL === 0;
    if (!isCheckpoint && !isLast) {
      continue;
    }

    const checkpointBuildStartedAt = INDICATOR_CACHE_PROFILE
      ? profileNow()
      : PROFILE_ZERO;
    const checkpointSnapshot: IndicatorCacheCheckpointSnapshot = {
      timestamp: candle.timestamp,
      runtimeState: controller.checkpointRuntimeState(),
    };
    checkpointRows.push({
      provider: params.provider,
      symbol: params.symbol,
      interval: params.interval,
      paramsHash: params.paramsHash,
      version: INDICATOR_CACHE_VERSION,
      ts: new Date(candle.timestamp),
      snapshot: checkpointSnapshot,
    });
    if (INDICATOR_CACHE_PROFILE) {
      indicatorCacheProfile.checkpointBuildMs += profileElapsedMs(
        checkpointBuildStartedAt,
      );
      indicatorCacheProfile.checkpointRows += 1;
    }
  }
  if (INDICATOR_CACHE_PROFILE) {
    indicatorCacheProfile.replayLoopMs += profileElapsedMs(replayLoopStartedAt);
  }

  const coverageUpsertStartedAt = INDICATOR_CACHE_PROFILE
    ? profileNow()
    : PROFILE_ZERO;
  await upsertIndicatorCacheCoverageRows(coverageRows);
  if (INDICATOR_CACHE_PROFILE) {
    indicatorCacheProfile.coverageUpsertMs += profileElapsedMs(
      coverageUpsertStartedAt,
    );
  }
  const checkpointUpsertStartedAt = INDICATOR_CACHE_PROFILE
    ? profileNow()
    : PROFILE_ZERO;
  await upsertIndicatorCacheCheckpointRows(checkpointRows);
  if (INDICATOR_CACHE_PROFILE) {
    indicatorCacheProfile.checkpointUpsertMs += profileElapsedMs(
      checkpointUpsertStartedAt,
    );
    indicatorCacheProfile.materializeMs += profileElapsedMs(profileStartedAt);
  }
};

export const resolveIndicatorCacheRuntimeState = (
  params: EnsureIndicatorCacheCoverageParams & IndicatorCacheRestorePlan,
): IndicatorCacheRestorePlan => {
  const profileStartedAt = INDICATOR_CACHE_PROFILE
    ? profileNow()
    : PROFILE_ZERO;
  if (INDICATOR_CACHE_PROFILE) {
    indicatorCacheProfile.runtimeResolveCalls += 1;
  }
  if (!params.data.length || params.replayStartIndex >= params.data.length) {
    return cloneIndicatorCacheRestorePlan(params);
  }

  const cacheKey = [
    buildRestorePlanCacheKey({
      provider: params.provider,
      symbol: params.symbol,
      interval: params.interval,
      paramsHash: params.paramsHash,
      data: params.data,
      btcData: params.btcData,
      btcBinanceData: params.btcBinanceData,
      btcCoinbaseData: params.btcCoinbaseData,
    }),
    params.baseContextBackend ? 'rust' : 'ts',
    params.replayStartIndex,
  ].join(':');
  const cachedPlan = indicatorRuntimeStatePlanCache.get(cacheKey);
  if (cachedPlan) {
    if (INDICATOR_CACHE_PROFILE) {
      indicatorCacheProfile.runtimeResolveCacheHits += 1;
      indicatorCacheProfile.runtimeResolveMs +=
        profileElapsedMs(profileStartedAt);
    }
    return cloneIndicatorCacheRestorePlan(cachedPlan);
  }

  const controller = createIndicators([], [], {
    includeMlPayload: false,
    runtimeOnly: true,
    periods: params.periods,
    btcBinanceData: params.btcBinanceData,
    btcCoinbaseData: params.btcCoinbaseData,
    baseContextBackend: params.baseContextBackend,
    initialRuntimeState: params.restoreState ?? undefined,
  });

  const replayStartedAt = INDICATOR_CACHE_PROFILE ? profileNow() : PROFILE_ZERO;
  for (
    let absoluteIndex = params.replayStartIndex;
    absoluteIndex < params.data.length;
    absoluteIndex += 1
  ) {
    const nextStartedAt = INDICATOR_CACHE_PROFILE ? profileNow() : PROFILE_ZERO;
    controller.next(params.data[absoluteIndex], params.btcData[absoluteIndex]);
    if (INDICATOR_CACHE_PROFILE) {
      indicatorCacheProfile.runtimeResolveNextMs +=
        profileElapsedMs(nextStartedAt);
      indicatorCacheProfile.runtimeResolveCandles += 1;
    }
  }
  if (INDICATOR_CACHE_PROFILE) {
    indicatorCacheProfile.runtimeResolveReplayMs +=
      profileElapsedMs(replayStartedAt);
  }

  const plan: IndicatorCacheRestorePlan = {
    paramsHash: params.paramsHash,
    version: params.version,
    restoreState: controller.checkpointRuntimeState?.() ?? null,
    replayStartIndex: params.data.length,
    cached: true,
  };
  indicatorRuntimeStatePlanCache.set(
    cacheKey,
    cloneIndicatorCacheRestorePlan(plan),
  );
  if (INDICATOR_CACHE_PROFILE) {
    indicatorCacheProfile.runtimeResolveMs +=
      profileElapsedMs(profileStartedAt);
  }
  return cloneIndicatorCacheRestorePlan(plan);
};
