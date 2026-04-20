import type {
  Direction,
  Position,
  PositionPnlSnapshot,
  StrategyConfig,
} from '@tradejs/types';

export const DEFAULT_BREAK_EVEN_TRIGGER_RISK_MULTIPLIER = 0.5;
export const DEFAULT_GLOBAL_UNREALIZED_PNL_TRIGGER_RISK_MULTIPLIER = 4;
export const GLOBAL_UNREALIZED_PNL_CLOSE_ALL_CODE =
  'GLOBAL_UNREALIZED_PNL_TARGET_REACHED_CLOSE_ALL';

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const isOpenPosition = (
  position: Position | null | undefined,
): position is Position =>
  Boolean(
    position &&
      isFiniteNumber(position.price) &&
      isFiniteNumber(position.qty) &&
      position.qty > 0 &&
      (position.direction === 'LONG' || position.direction === 'SHORT'),
  );

export const isOpenPositionPnlSnapshot = (
  position: PositionPnlSnapshot | null | undefined,
): position is PositionPnlSnapshot =>
  Boolean(
    isOpenPosition(position) &&
      isFiniteNumber(position?.currentPrice) &&
      isFiniteNumber(position?.unrealizedPnl),
  );

export const getStrategyMaxLossValue = (
  strategyConfig: StrategyConfig | null | undefined,
) => {
  const maxLossValue = Number(strategyConfig?.MAX_LOSS_VALUE ?? Number.NaN);
  return Number.isFinite(maxLossValue) && maxLossValue > 0
    ? maxLossValue
    : null;
};

export const getPositionStopLossPrice = (
  position: Position | null | undefined,
) => {
  if (!position || typeof position !== 'object') {
    return null;
  }

  const slPrice = Number(
    (position as Position & { slPrice?: unknown }).slPrice ?? Number.NaN,
  );

  if (Number.isFinite(slPrice)) {
    return slPrice;
  }

  const signalStopLossPrice = Number(
    (
      position as Position & {
        signal?: { prices?: { stopLossPrice?: unknown } };
      }
    ).signal?.prices?.stopLossPrice ?? Number.NaN,
  );

  return Number.isFinite(signalStopLossPrice) ? signalStopLossPrice : null;
};

export const getFavorableMovePct = ({
  direction,
  entryPrice,
  currentPrice,
}: {
  direction: Direction;
  entryPrice: number;
  currentPrice: number;
}) => {
  if (
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(currentPrice) ||
    entryPrice <= 0
  ) {
    return null;
  }

  return direction === 'LONG'
    ? ((currentPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - currentPrice) / entryPrice) * 100;
};

export const getPositionRiskPct = ({
  direction,
  entryPrice,
  stopLossPrice,
}: {
  direction: Direction;
  entryPrice: number;
  stopLossPrice: number | null;
}) => {
  if (
    stopLossPrice == null ||
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(stopLossPrice) ||
    entryPrice <= 0
  ) {
    return null;
  }

  return direction === 'LONG'
    ? ((entryPrice - stopLossPrice) / entryPrice) * 100
    : ((stopLossPrice - entryPrice) / entryPrice) * 100;
};

export const isBreakEvenStopAlreadyApplied = ({
  direction,
  entryPrice,
  stopLossPrice,
}: {
  direction: Direction;
  entryPrice: number;
  stopLossPrice: number | null;
}) => {
  if (
    stopLossPrice == null ||
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(stopLossPrice)
  ) {
    return false;
  }

  return direction === 'LONG'
    ? stopLossPrice >= entryPrice
    : stopLossPrice <= entryPrice;
};

export const getConfiguredDirectionRiskPct = ({
  strategyConfig,
  direction,
}: {
  strategyConfig: StrategyConfig;
  direction: Direction;
}) => {
  if (!strategyConfig || typeof strategyConfig !== 'object') {
    return null;
  }

  const directSideConfig = (
    strategyConfig as Record<string, { SL?: unknown } | undefined>
  )[direction];
  const directSideRiskPct = Number(directSideConfig?.SL ?? Number.NaN);
  if (Number.isFinite(directSideRiskPct)) {
    return directSideRiskPct;
  }

  for (const candidate of Object.values(strategyConfig)) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const candidateDirection = (candidate as { direction?: unknown }).direction;
    const candidateRiskPct = Number(
      (candidate as { SL?: unknown }).SL ?? Number.NaN,
    );

    if (candidateDirection === direction && Number.isFinite(candidateRiskPct)) {
      return candidateRiskPct;
    }
  }

  return null;
};

export const toStrategyCodePrefix = (strategyName: string) =>
  strategyName === 'TrendLine'
    ? 'TRENDLINE'
    : strategyName
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .toUpperCase();
