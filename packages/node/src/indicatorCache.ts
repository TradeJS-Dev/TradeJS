import { createHash } from 'node:crypto';
import {
  buildIndicatorCacheSnapshots,
  IndicatorPeriods,
} from '@tradejs/core/indicators';
import { Candle } from '@tradejs/types';
import {
  getIndicatorCacheCoverage,
  upsertIndicatorCacheRows,
} from '@tradejs/infra/timescale';

const INDICATOR_CACHE_VERSION = 'v1';

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
  if (!data.length) {
    return {
      paramsHash: buildIndicatorCacheParamsHash({
        provider,
        interval,
        periods,
      }),
      version: INDICATOR_CACHE_VERSION,
      cached: false,
    };
  }

  const paramsHash = buildIndicatorCacheParamsHash({
    provider,
    interval,
    periods,
    btcProvider: provider,
    btcBinanceProvider: btcBinanceData?.length ? 'binance' : undefined,
    btcCoinbaseProvider: btcCoinbaseData?.length ? 'coinbase' : undefined,
  });
  const startMs = data[0].timestamp;
  const endMs = data[data.length - 1].timestamp;
  const coverage = await getIndicatorCacheCoverage({
    provider,
    symbol,
    interval,
    paramsHash,
    version: INDICATOR_CACHE_VERSION,
    startMs,
    endMs,
  });

  if (
    coverage.min != null &&
    coverage.max != null &&
    coverage.min <= startMs &&
    coverage.max >= endMs &&
    coverage.count === data.length
  ) {
    return {
      paramsHash,
      version: INDICATOR_CACHE_VERSION,
      cached: true,
    };
  }

  const snapshots = buildIndicatorCacheSnapshots(data, btcData, {
    includeMlPayload: false,
    periods,
    btcBinanceData,
    btcCoinbaseData,
  });

  await upsertIndicatorCacheRows(
    snapshots.map((snapshot) => ({
      provider,
      symbol,
      interval,
      paramsHash,
      version: INDICATOR_CACHE_VERSION,
      ts: new Date(snapshot.timestamp),
      snapshot,
    })),
  );

  return {
    paramsHash,
    version: INDICATOR_CACHE_VERSION,
    cached: false,
  };
};
