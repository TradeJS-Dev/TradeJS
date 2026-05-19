import {
  BaseStrategyContextSnapshot,
  IndicatorsHistorySnapshot,
} from '@tradejs/types';

type SignalLike = {
  indicators?: Record<string, unknown>;
  additionalIndicators?: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const getLastFiniteNumber = (value: unknown): number | null => {
  if (isFiniteNumber(value)) return value;
  if (!Array.isArray(value)) return null;

  for (let i = value.length - 1; i >= 0; i -= 1) {
    if (isFiniteNumber(value[i])) return value[i];
  }

  return null;
};

export const getSignalBaseContext = (
  signal: Pick<SignalLike, 'additionalIndicators'>,
): BaseStrategyContextSnapshot | null => {
  const baseContext = isRecord(signal.additionalIndicators)
    ? signal.additionalIndicators.baseContext
    : null;
  return isRecord(baseContext)
    ? (baseContext as unknown as BaseStrategyContextSnapshot)
    : null;
};

export const getIndicatorsBaseContext = (
  indicators: IndicatorsHistorySnapshot | Record<string, unknown> | undefined,
): BaseStrategyContextSnapshot | null => {
  if (!isRecord(indicators)) return null;
  const baseContext = indicators.baseContext;
  return isRecord(baseContext)
    ? (baseContext as unknown as BaseStrategyContextSnapshot)
    : null;
};

export const getSignalCoinMaFast = (signal: SignalLike): number | null =>
  getSignalBaseContext(signal)?.raw.trend.maFast ??
  getLastFiniteNumber(signal.indicators?.maFast);

export const getSignalCoinMaSlow = (signal: SignalLike): number | null =>
  getSignalBaseContext(signal)?.raw.trend.maSlow ??
  getLastFiniteNumber(signal.indicators?.maSlow);

export const getSignalAtrPct = (signal: SignalLike): number | null =>
  getSignalBaseContext(signal)?.raw.volatility.atrPct ??
  getLastFiniteNumber(signal.indicators?.atrPct);

export const getSignalBtcMaFast = (signal: SignalLike): number | null =>
  getSignalBaseContext(signal)?.relative.benchmark.maFast ??
  getLastFiniteNumber(signal.indicators?.btcMaFast);

export const getSignalBtcMaSlow = (signal: SignalLike): number | null =>
  getSignalBaseContext(signal)?.relative.benchmark.maSlow ??
  getLastFiniteNumber(signal.indicators?.btcMaSlow);

export const getIndicatorsCoinMaFast = (
  indicators: IndicatorsHistorySnapshot | Record<string, unknown> | undefined,
): number | null =>
  getIndicatorsBaseContext(indicators)?.raw.trend.maFast ??
  getLastFiniteNumber(isRecord(indicators) ? indicators.maFast : null);

export const getIndicatorsCoinMaSlow = (
  indicators: IndicatorsHistorySnapshot | Record<string, unknown> | undefined,
): number | null =>
  getIndicatorsBaseContext(indicators)?.raw.trend.maSlow ??
  getLastFiniteNumber(isRecord(indicators) ? indicators.maSlow : null);

export const getIndicatorsCorrelation = (
  indicators: IndicatorsHistorySnapshot | Record<string, unknown> | undefined,
): number | null =>
  getIndicatorsBaseContext(indicators)?.raw.crossAsset.btcCorrelation ??
  getLastFiniteNumber(isRecord(indicators) ? indicators.correlation : null);
