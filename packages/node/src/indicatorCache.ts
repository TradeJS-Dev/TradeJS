import { createHash } from 'node:crypto';
import {
  buildIndicatorCacheSnapshots,
  IndicatorCacheSnapshotEntry,
  IndicatorsControllerCheckpointState,
  IndicatorPeriods,
} from '@tradejs/core/indicators';
import { Candle } from '@tradejs/types';
import {
  deleteIndicatorCacheObsoleteVersions,
  getIndicatorCacheRange,
  getLatestIndicatorCacheCheckpointAtOrBefore,
  upsertIndicatorCacheCheckpointRows,
  upsertIndicatorCacheCoverageRows,
} from '@tradejs/infra/timescale';

const INDICATOR_CACHE_VERSION = 'v5';
const INDICATOR_CACHE_CHECKPOINT_INTERVAL = 256;

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

type IndicatorCacheCoverageSnapshot = Pick<
  IndicatorCacheSnapshotEntry,
  'timestamp' | 'candleSignature' | 'btcCandleSignature' | 'ready'
>;

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

const toCoverageSnapshot = (
  snapshot: IndicatorCacheSnapshotEntry,
): IndicatorCacheCoverageSnapshot => ({
  timestamp: snapshot.timestamp,
  candleSignature: snapshot.candleSignature,
  btcCandleSignature: snapshot.btcCandleSignature,
  ready: snapshot.ready,
});

const toCheckpointSnapshot = (
  snapshot: IndicatorCacheSnapshotEntry,
): IndicatorCacheCheckpointSnapshot | null =>
  snapshot.runtimeState == null
    ? null
    : {
        timestamp: snapshot.timestamp,
        runtimeState: snapshot.runtimeState,
      };

const selectCheckpointSnapshots = (
  snapshots: IndicatorCacheSnapshotEntry[],
): IndicatorCacheCheckpointSnapshot[] => {
  const selected: IndicatorCacheCheckpointSnapshot[] = [];

  snapshots.forEach((snapshot, index) => {
    const isLast = index === snapshots.length - 1;
    const isCheckpoint = index % INDICATOR_CACHE_CHECKPOINT_INTERVAL === 0;
    if (!isCheckpoint && !isLast) {
      return;
    }

    const checkpointSnapshot = toCheckpointSnapshot(snapshot);
    if (checkpointSnapshot) {
      selected.push(checkpointSnapshot);
    }
  });

  return selected;
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
  await deleteIndicatorCacheObsoleteVersions({
    provider,
    symbol,
    interval,
    keepVersion: INDICATOR_CACHE_VERSION,
  });

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

  const replayData = params.data.slice(params.replayStartIndex);
  const replayBtcData = params.btcData.slice(params.replayStartIndex);
  const snapshots = buildIndicatorCacheSnapshots(replayData, replayBtcData, {
    includeMlPayload: false,
    periods: params.periods,
    checkpointInterval: INDICATOR_CACHE_CHECKPOINT_INTERVAL,
    btcBinanceData: params.btcBinanceData,
    btcCoinbaseData: params.btcCoinbaseData,
    initialRuntimeState: params.restoreState ?? undefined,
  });

  await upsertIndicatorCacheCoverageRows(
    snapshots.map((snapshot) => ({
      provider: params.provider,
      symbol: params.symbol,
      interval: params.interval,
      paramsHash: params.paramsHash,
      version: INDICATOR_CACHE_VERSION,
      ts: new Date(snapshot.timestamp),
      snapshot: toCoverageSnapshot(snapshot),
    })),
  );

  await upsertIndicatorCacheCheckpointRows(
    selectCheckpointSnapshots(snapshots).map((snapshot) => ({
      provider: params.provider,
      symbol: params.symbol,
      interval: params.interval,
      paramsHash: params.paramsHash,
      version: INDICATOR_CACHE_VERSION,
      ts: new Date(snapshot.timestamp),
      snapshot,
    })),
  );
};
