import type { BaseStrategyContextSnapshot, Candle } from '@tradejs/types';
import { calculatePearsonCorrelation } from './correlation';
import { percentChange } from './indicatorMath';

const SESSION_WINDOWS: Array<{
  name: 'asia' | 'europe' | 'us';
  startMinuteUtc: number;
  endMinuteUtc: number;
}> = [
  { name: 'asia', startMinuteUtc: 0, endMinuteUtc: 8 * 60 },
  { name: 'europe', startMinuteUtc: 7 * 60, endMinuteUtc: 16 * 60 },
  { name: 'us', startMinuteUtc: 13 * 60, endMinuteUtc: 22 * 60 },
];

const FUNDING_WINDOW_STEP_MINUTES = 8 * 60;
const FUNDING_WINDOW_NEARBY_MINUTES = 60;
const SESSION_WINDOW_EDGE_MINUTES = 60;
const PSYCHOLOGICAL_LEVEL_WINDOWS = {
  m15: 15 * 60_000,
  h1: 60 * 60_000,
  h4: 4 * 60 * 60_000,
} as const;

export const buildSessionContext = (timestamp: number) => {
  const date = new Date(timestamp);
  const minuteUtc = date.getUTCHours() * 60 + date.getUTCMinutes();
  const dayOfWeekUtc = (date.getUTCDay() || 7) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
  const activeSessions = SESSION_WINDOWS.filter(
    ({ startMinuteUtc, endMinuteUtc }) =>
      startMinuteUtc <= endMinuteUtc
        ? minuteUtc >= startMinuteUtc && minuteUtc < endMinuteUtc
        : minuteUtc >= startMinuteUtc || minuteUtc < endMinuteUtc,
  ).map(({ name }) => name);
  const sessionPhase = activeSessions.includes('us')
    ? 'us'
    : activeSessions.includes('europe')
      ? 'europe'
      : activeSessions.includes('asia')
        ? 'asia'
        : 'off_hours';
  const primaryWindow = SESSION_WINDOWS.find(
    ({ name }) => name === sessionPhase,
  );
  const minutesFromSessionOpen = primaryWindow
    ? minuteUtc - primaryWindow.startMinuteUtc
    : null;
  const minutesToSessionClose = primaryWindow
    ? primaryWindow.endMinuteUtc - minuteUtc
    : null;
  const sessionWindowPhase =
    primaryWindow == null || minutesFromSessionOpen == null
      ? 'off_hours'
      : minutesFromSessionOpen < SESSION_WINDOW_EDGE_MINUTES
        ? 'opening'
        : minutesToSessionClose != null &&
            minutesToSessionClose <= SESSION_WINDOW_EDGE_MINUTES
          ? 'closing'
          : 'active';
  const minutesToFundingWindow =
    (FUNDING_WINDOW_STEP_MINUTES - (minuteUtc % FUNDING_WINDOW_STEP_MINUTES)) %
    FUNDING_WINDOW_STEP_MINUTES;

  return {
    sessionPhase,
    sessionWindowPhase,
    isOverlap: activeSessions.length > 1,
    minutesFromSessionOpen,
    minutesToSessionClose,
    minutesToFundingWindow,
    fundingWindowNearby:
      minutesToFundingWindow <= FUNDING_WINDOW_NEARBY_MINUTES,
    dayOfWeekUtc,
    isWeekdayUtc: dayOfWeekUtc <= 5,
    isWeekendUtc: dayOfWeekUtc >= 6,
  };
};

type PsychologicalLevelWindowContext = NonNullable<
  NonNullable<
    BaseStrategyContextSnapshot['relative']['referencePsychologicalLevels']
  >['BTCUSDT']
>['windows']['m15'];
type PsychologicalLevelAssetContext = NonNullable<
  NonNullable<
    BaseStrategyContextSnapshot['relative']['referencePsychologicalLevels']
  >['BTCUSDT']
>;

const unavailablePsychologicalLevelWindow =
  (): PsychologicalLevelWindowContext => ({
    crossed: null,
    direction: 'unknown',
    level: null,
    levelsCrossed: null,
    distanceBeyondLevelBps: null,
  });

const buildPsychologicalLevelWindow = (
  startPrice: number,
  endPrice: number,
  stepUsd: number,
): PsychologicalLevelWindowContext => {
  if (
    !Number.isFinite(startPrice) ||
    !Number.isFinite(endPrice) ||
    !Number.isFinite(stepUsd) ||
    startPrice <= 0 ||
    endPrice <= 0 ||
    stepUsd <= 0
  ) {
    return unavailablePsychologicalLevelWindow();
  }
  if (endPrice === startPrice) {
    return {
      crossed: false,
      direction: 'none',
      level: null,
      levelsCrossed: 0,
      distanceBeyondLevelBps: null,
    };
  }

  const movingUp = endPrice > startPrice;
  const firstCrossedLevel = movingUp
    ? (Math.floor(startPrice / stepUsd) + 1) * stepUsd
    : (Math.ceil(startPrice / stepUsd) - 1) * stepUsd;
  const lastCrossedLevel = movingUp
    ? Math.floor(endPrice / stepUsd) * stepUsd
    : Math.ceil(endPrice / stepUsd) * stepUsd;
  const crossed = movingUp
    ? firstCrossedLevel <= lastCrossedLevel
    : firstCrossedLevel >= lastCrossedLevel;
  if (!crossed) {
    return {
      crossed: false,
      direction: 'none',
      level: null,
      levelsCrossed: 0,
      distanceBeyondLevelBps: null,
    };
  }

  return {
    crossed: true,
    direction: movingUp ? 'up' : 'down',
    level: lastCrossedLevel,
    levelsCrossed:
      Math.round(Math.abs(lastCrossedLevel - firstCrossedLevel) / stepUsd) + 1,
    distanceBeyondLevelBps:
      (Math.abs(endPrice - lastCrossedLevel) / lastCrossedLevel) * 10_000,
  };
};

export const buildPsychologicalLevelAssetContext = (
  candles: Candle[],
  stepUsd: number,
): PsychologicalLevelAssetContext | null => {
  const endCandle = candles[candles.length - 1];
  if (!endCandle) return null;
  const candlesByTimestamp = new Map(
    candles.map((item) => [item.timestamp, item] as const),
  );
  const windows = Object.fromEntries(
    Object.entries(PSYCHOLOGICAL_LEVEL_WINDOWS).map(([window, durationMs]) => {
      const startCandle = candlesByTimestamp.get(
        endCandle.timestamp - durationMs,
      );
      return [
        window,
        startCandle
          ? buildPsychologicalLevelWindow(
              startCandle.close,
              endCandle.close,
              stepUsd,
            )
          : unavailablePsychologicalLevelWindow(),
      ];
    }),
  ) as PsychologicalLevelAssetContext['windows'];
  return { source: 'aligned_15m_ohlcv', stepUsd, windows };
};

type TargetVsBtcContext = NonNullable<
  BaseStrategyContextSnapshot['relative']['targetVsBtc']
>;
type TargetVsEthContext = NonNullable<
  BaseStrategyContextSnapshot['relative']['targetVsEth']
>;

const returnPct = (candles: Candle[]) => {
  if (candles.length < 2) return null;
  return percentChange(
    candles[candles.length - 1].close,
    candles[candles.length - 2].close,
  );
};

const ratioReturnPct = (target: Candle[], reference: Candle[]) => {
  if (target.length < 2 || reference.length < 2) return null;
  const targetCurrent = target[target.length - 1];
  const targetPrevious = target[target.length - 2];
  const referenceCurrent = reference[reference.length - 1];
  const referencePrevious = reference[reference.length - 2];
  if (referenceCurrent.close <= 0 || referencePrevious.close <= 0) return null;
  return percentChange(
    targetCurrent.close / referenceCurrent.close,
    targetPrevious.close / referencePrevious.close,
  );
};

const alignRecentCandles = (target: Candle[], reference: Candle[]) => {
  const alignedTarget: Candle[] = [];
  const alignedReference: Candle[] = [];
  let targetIndex = Math.max(0, target.length - 80);
  let referenceIndex = Math.max(0, reference.length - 80);
  while (targetIndex < target.length && referenceIndex < reference.length) {
    const targetTimestamp = target[targetIndex].timestamp;
    const referenceTimestamp = reference[referenceIndex].timestamp;
    if (targetTimestamp === referenceTimestamp) {
      alignedTarget.push(target[targetIndex]);
      alignedReference.push(reference[referenceIndex]);
      targetIndex += 1;
      referenceIndex += 1;
    } else if (targetTimestamp < referenceTimestamp) {
      targetIndex += 1;
    } else {
      referenceIndex += 1;
    }
  }
  return { alignedTarget, alignedReference };
};

const returnSeries = (candles: Candle[], limit: number) => {
  const returns: number[] = [];
  for (
    let index = Math.max(1, candles.length - limit);
    index < candles.length;
    index += 1
  ) {
    const previous = candles[index - 1];
    const current = candles[index];
    if (previous.close <= 0) continue;
    const value = percentChange(current.close, previous.close);
    if (value != null && Number.isFinite(value)) returns.push(value);
  }
  return returns;
};

const beta = (targetReturns: number[], referenceReturns: number[]) => {
  const length = Math.min(targetReturns.length, referenceReturns.length);
  if (length < 2) return null;
  const target = targetReturns.slice(-length);
  const reference = referenceReturns.slice(-length);
  const referenceMean =
    reference.reduce((sum, value) => sum + value, 0) / length;
  const targetMean = target.reduce((sum, value) => sum + value, 0) / length;
  let covariance = 0;
  let referenceVariance = 0;
  for (let index = 0; index < length; index += 1) {
    const referenceDelta = reference[index] - referenceMean;
    covariance += (target[index] - targetMean) * referenceDelta;
    referenceVariance += referenceDelta * referenceDelta;
  }
  return referenceVariance > 0 ? covariance / referenceVariance : null;
};

const classifyRatioTrend = (
  ratioReturn24h: number | null,
  ratioReturn4h: number | null,
): TargetVsBtcContext['ratioTrend'] => {
  const value = ratioReturn24h ?? ratioReturn4h;
  if (value == null) return 'unknown';
  if (value > 0.15) return 'up';
  if (value < -0.15) return 'down';
  return 'flat';
};

export const buildTargetVsBtcContext = ({
  coin1h,
  btc1h,
  coin4h,
  btc4h,
  coin1d,
  btc1d,
  coinCandles,
  btcCandles,
}: {
  coin1h: Candle[];
  btc1h: Candle[];
  coin4h: Candle[];
  btc4h: Candle[];
  coin1d: Candle[];
  btc1d: Candle[];
  coinCandles: Candle[];
  btcCandles: Candle[];
}): TargetVsBtcContext => {
  const ratioReturn1h = ratioReturnPct(coin1h, btc1h);
  const ratioReturn4h = ratioReturnPct(coin4h, btc4h);
  const ratioReturn24h = ratioReturnPct(coin1d, btc1d);
  const coinReturn1h = returnPct(coin1h);
  const coinReturn4h = returnPct(coin4h);
  const coinReturn24h = returnPct(coin1d);
  const btcReturn1h = returnPct(btc1h);
  const btcReturn4h = returnPct(btc4h);
  const btcReturn24h = returnPct(btc1d);
  const { alignedTarget, alignedReference } = alignRecentCandles(
    coinCandles,
    btcCandles,
  );
  const coinReturns20 = returnSeries(alignedTarget, 21).slice(-20);
  const btcReturns20 = returnSeries(alignedReference, 21).slice(-20);
  return {
    source: 'aligned_ohlcv',
    ratioReturn1h,
    ratioReturn4h,
    ratioReturn24h,
    alphaVsBtc1h:
      coinReturn1h == null || btcReturn1h == null
        ? null
        : coinReturn1h - btcReturn1h,
    alphaVsBtc4h:
      coinReturn4h == null || btcReturn4h == null
        ? null
        : coinReturn4h - btcReturn4h,
    alphaVsBtc24h:
      coinReturn24h == null || btcReturn24h == null
        ? null
        : coinReturn24h - btcReturn24h,
    betaToBtc20: beta(coinReturns20, btcReturns20),
    correlationToBtc20:
      coinReturns20.length === btcReturns20.length && coinReturns20.length >= 2
        ? calculatePearsonCorrelation(coinReturns20, btcReturns20)
        : null,
    ratioTrend: classifyRatioTrend(ratioReturn24h, ratioReturn4h),
  };
};

const hasDistinctReferenceCandles = (target: Candle[], reference: Candle[]) => {
  const targetLast = target[target.length - 1];
  const referenceLast = reference[reference.length - 1];
  const targetPrevious = target[target.length - 2];
  const referencePrevious = reference[reference.length - 2];
  if (!targetLast || !referenceLast || !targetPrevious || !referencePrevious) {
    return false;
  }
  return (
    targetLast.timestamp !== referenceLast.timestamp ||
    targetLast.close !== referenceLast.close ||
    targetPrevious.timestamp !== referencePrevious.timestamp ||
    targetPrevious.close !== referencePrevious.close
  );
};

export const buildTargetVsEthContext = ({
  coin1h,
  eth1h,
  coin4h,
  eth4h,
  coin1d,
  eth1d,
  coinCandles,
  ethCandles,
}: {
  coin1h: Candle[];
  eth1h: Candle[];
  coin4h: Candle[];
  eth4h: Candle[];
  coin1d: Candle[];
  eth1d: Candle[];
  coinCandles: Candle[];
  ethCandles: Candle[];
}): TargetVsEthContext | null => {
  if (!hasDistinctReferenceCandles(coinCandles, ethCandles)) return null;
  const context = buildTargetVsBtcContext({
    coin1h,
    btc1h: eth1h,
    coin4h,
    btc4h: eth4h,
    coin1d,
    btc1d: eth1d,
    coinCandles,
    btcCandles: ethCandles,
  });
  return {
    source: context.source,
    ratioReturn1h: context.ratioReturn1h,
    ratioReturn4h: context.ratioReturn4h,
    ratioReturn24h: context.ratioReturn24h,
    alphaVsEth1h: context.alphaVsBtc1h,
    alphaVsEth4h: context.alphaVsBtc4h,
    alphaVsEth24h: context.alphaVsBtc24h,
    betaToEth20: context.betaToBtc20,
    correlationToEth20: context.correlationToBtc20,
    ratioTrend: context.ratioTrend,
  };
};
