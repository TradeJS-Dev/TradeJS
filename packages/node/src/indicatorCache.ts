import { createHash } from 'node:crypto';
import {
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

const INDICATOR_CACHE_VERSION = 'v11';
const INDICATOR_CACHE_CHECKPOINT_INTERVAL = 256;

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

export const resetIndicatorCache = () => resetIndicatorCacheTables();

type EnsureIndicatorCacheCoverageParams = {
  provider: string;
  symbol: string;
  interval: number;
  periods?: Partial<IndicatorPeriods>;
  data: Candle[];
  btcData: Candle[];
  btcBinanceData?: Candle[];
  btcCoinbaseData?: Candle[];
};

type IndicatorCacheRestorePlan = {
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
  return [
    candle.timestamp,
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
    candle.turnover,
  ].join(':');
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

  const cachedRows = await toCacheRows({
    provider,
    symbol,
    interval,
    paramsHash,
    startMs: data[0].timestamp,
    endMs: data[data.length - 1].timestamp,
  });

  let validPrefixLength = 0;
  const comparableLength = Math.min(cachedRows.length, data.length);
  for (let index = 0; index < comparableLength; index += 1) {
    const row = cachedRows[index];
    if (
      row.timestamp !== data[index].timestamp ||
      row.candleSignature !== buildCandleSignature(data[index]) ||
      row.btcCandleSignature !== buildCandleSignature(btcData[index])
    ) {
      break;
    }

    validPrefixLength += 1;
  }

  const lastValidRow =
    validPrefixLength > 0 ? cachedRows[validPrefixLength - 1] : null;
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
  const checkpointSnapshot =
    (checkpoint?.snapshot as IndicatorCacheCheckpointSnapshot | null) ?? null;
  const checkpointIndex =
    checkpointSnapshot == null
      ? -1
      : data.findIndex(
          (item) => item.timestamp === checkpointSnapshot.timestamp,
        );
  const canRestoreFromCheckpoint =
    checkpointSnapshot?.runtimeState != null &&
    checkpointIndex >= 0 &&
    checkpointIndex < validPrefixLength;
  const replayStartIndex = canRestoreFromCheckpoint ? checkpointIndex + 1 : 0;

  return {
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
};

export const materializeIndicatorCachePlan = async (
  params: EnsureIndicatorCacheCoverageParams &
    Pick<
      IndicatorCacheRestorePlan,
      'paramsHash' | 'restoreState' | 'replayStartIndex' | 'cached'
    >,
) => {
  if (!params.data.length) {
    return;
  }

  if (params.cached && params.replayStartIndex >= params.data.length) {
    return;
  }

  const controller = createIndicators([], [], {
    includeMlPayload: false,
    runtimeOnly: true,
    periods: params.periods,
    btcBinanceData: params.btcBinanceData,
    btcCoinbaseData: params.btcCoinbaseData,
    initialRuntimeState: params.restoreState ?? undefined,
  });
  if (typeof controller.checkpointRuntimeState !== 'function') {
    return;
  }

  const coverageRows: Parameters<typeof upsertIndicatorCacheCoverageRows>[0] =
    [];
  const checkpointRows: Parameters<
    typeof upsertIndicatorCacheCheckpointRows
  >[0] = [];

  for (
    let absoluteIndex = params.replayStartIndex;
    absoluteIndex < params.data.length;
    absoluteIndex += 1
  ) {
    const index = absoluteIndex - params.replayStartIndex;
    const candle = params.data[absoluteIndex];
    const btcCandle = params.btcData[absoluteIndex];
    const snapshot = controller.next(candle, btcCandle);
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

    const isLast = absoluteIndex === params.data.length - 1;
    const isCheckpoint = index % INDICATOR_CACHE_CHECKPOINT_INTERVAL === 0;
    if (!isCheckpoint && !isLast) {
      continue;
    }

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
  }

  await upsertIndicatorCacheCoverageRows(coverageRows);
  await upsertIndicatorCacheCheckpointRows(checkpointRows);
};
