import type {
  BaseStrategyContextSnapshot,
  DerivativesContext,
  Direction,
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

export const getSignalVolumeRel20 = (signal: SignalLike): number | null =>
  getSignalBaseContext(signal)?.participation?.volume?.volumeRel20 ?? null;

export const getAverageTurnover20 = (
  baseContext: BaseStrategyContextSnapshot | null | undefined,
): number | null => {
  const turnover = Number(baseContext?.candle?.turnover);
  const turnoverRel20 = Number(
    baseContext?.participation?.volume?.turnoverRel20,
  );
  if (
    !Number.isFinite(turnover) ||
    turnover < 0 ||
    !Number.isFinite(turnoverRel20) ||
    turnoverRel20 <= 0
  ) {
    return null;
  }

  return turnover / turnoverRel20;
};

export const getSignalBtcMaFast = (signal: SignalLike): number | null =>
  getSignalBaseContext(signal)?.relative.benchmark.maFast ?? null;

export const getSignalBtcMaSlow = (signal: SignalLike): number | null =>
  getSignalBaseContext(signal)?.relative.benchmark.maSlow ?? null;

export const getSignalSessionContext = (signal: SignalLike) =>
  getSignalBaseContext(signal)?.regime?.session ?? null;

export const getSignalSessionPrimary = (signal: SignalLike): string | null =>
  getSignalSessionContext(signal)?.sessionPhase ?? null;

export const getSignalSessionIsOverlap = (signal: SignalLike): boolean =>
  getSignalSessionContext(signal)?.isOverlap === true;

export const getSignalDerivativesContext = (
  signal: SignalLike,
): DerivativesContext | null =>
  getSignalBaseContext(signal)?.derivatives ?? null;

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

export const isDirectionAligned = ({
  direction,
  bullValue,
  bearValue,
  value,
}: {
  direction: Direction;
  bullValue: string;
  bearValue: string;
  value: string | null | undefined;
}) => (direction === 'LONG' ? value === bullValue : value === bearValue);

export const isPressureAligned = ({
  direction,
  buyPressurePct,
  bullishMin = 0.55,
  bearishMax = 0.45,
}: {
  direction: Direction;
  buyPressurePct: number | null | undefined;
  bullishMin?: number;
  bearishMax?: number;
}) =>
  buyPressurePct == null
    ? null
    : direction === 'LONG'
      ? buyPressurePct >= bullishMin
      : buyPressurePct <= bearishMax;
