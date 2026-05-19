import {
  BaseStrategyContextSnapshot,
  IndicatorsHistorySnapshot,
} from '@tradejs/types';

type SignalLike = {
  additionalIndicators?: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
  getSignalBaseContext(signal)?.raw.trend.maFast ?? null;

export const getSignalCoinMaSlow = (signal: SignalLike): number | null =>
  getSignalBaseContext(signal)?.raw.trend.maSlow ?? null;

export const getSignalAtrPct = (signal: SignalLike): number | null =>
  getSignalBaseContext(signal)?.raw.volatility.atrPct ?? null;

export const getSignalBtcMaFast = (signal: SignalLike): number | null =>
  getSignalBaseContext(signal)?.relative.benchmark.maFast ?? null;

export const getSignalBtcMaSlow = (signal: SignalLike): number | null =>
  getSignalBaseContext(signal)?.relative.benchmark.maSlow ?? null;

export const getSignalSessionContext = (signal: SignalLike) =>
  getSignalBaseContext(signal)?.regime?.session ?? null;

export const getSignalSessionPrimary = (signal: SignalLike): string | null =>
  getSignalSessionContext(signal)?.primarySession ?? null;

export const getSignalSessionIsOverlap = (signal: SignalLike): boolean =>
  getSignalSessionContext(signal)?.isOverlap === true;

export const getIndicatorsCoinMaFast = (
  indicators: IndicatorsHistorySnapshot | Record<string, unknown> | undefined,
): number | null =>
  getIndicatorsBaseContext(indicators)?.raw.trend.maFast ?? null;

export const getIndicatorsCoinMaSlow = (
  indicators: IndicatorsHistorySnapshot | Record<string, unknown> | undefined,
): number | null =>
  getIndicatorsBaseContext(indicators)?.raw.trend.maSlow ?? null;

export const getIndicatorsCorrelation = (
  indicators: IndicatorsHistorySnapshot | Record<string, unknown> | undefined,
): number | null =>
  getIndicatorsBaseContext(indicators)?.raw.crossAsset.btcCorrelation ?? null;
