const WEAK_CLEAN_BREAK_ATR_RATIO_MAX = 0.45;
const COMPRESSED_CLEAN_BREAK_ATR_RATIO_MAX = 0.6;
const COMPRESSED_CLEAN_BREAK_DISTANCE_MAX = 120;
const COMPRESSED_CLEAN_BREAK_TOUCHES_MIN = 5;
const WEAK_LONG_FAR_BREAK_ATR_RATIO_MAX = 0.6;
const WEAK_LONG_FAR_BREAK_DISTANCE_MIN = 1000;
const WEAK_LONG_FAR_BREAK_BTC_SPREAD_MAX = 0.35;

export const toFiniteNumberOrNull = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const getLastFiniteNumber = (value: unknown) => {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  return toFiniteNumberOrNull(value[value.length - 1]);
};

export const getBias = (fast: number | null, slow: number | null) => {
  if (fast == null || slow == null) {
    return null;
  }
  if (fast > slow) {
    return 'bullish';
  }
  if (fast < slow) {
    return 'bearish';
  }
  return 'flat';
};

export const getSpreadPct = (fast: number | null, slow: number | null) => {
  if (fast == null || slow == null || slow === 0) {
    return null;
  }

  return ((fast - slow) / slow) * 100;
};

export const getTrendLineFromPayload = (signal: {
  figures?: Record<string, unknown>;
  additionalIndicators?: Record<string, unknown>;
}) =>
  (signal.figures?.trendLine as Record<string, unknown> | undefined) ??
  (signal.additionalIndicators?.trendLine as
    | Record<string, unknown>
    | undefined) ??
  null;

type StructuralTrendLineSignal = {
  direction?: unknown;
  prices?: { currentPrice?: unknown };
  indicators?: Record<string, unknown>;
  additionalIndicators?: Record<string, unknown>;
  figures?: Record<string, unknown>;
};

export const buildTrendlineStructuralContext = (
  signal: StructuralTrendLineSignal,
) => {
  const trendLine = getTrendLineFromPayload(signal);
  const currentPrice = toFiniteNumberOrNull(signal.prices?.currentPrice);
  const signalDirection =
    signal.direction === 'LONG' || signal.direction === 'SHORT'
      ? signal.direction
      : null;
  const points = Array.isArray(trendLine?.points) ? trendLine.points : [];
  const latestPoint = points.length ? points[points.length - 1] : null;
  const currentLinePrice = toFiniteNumberOrNull(
    latestPoint && typeof latestPoint === 'object'
      ? (latestPoint as { value?: unknown }).value
      : null,
  );
  const priceVsLinePct =
    currentPrice != null && currentLinePrice != null && currentLinePrice !== 0
      ? ((currentPrice - currentLinePrice) / currentLinePrice) * 100
      : null;
  const priceVsLineSide =
    priceVsLinePct == null
      ? null
      : priceVsLinePct > 0
        ? 'above'
        : priceVsLinePct < 0
          ? 'below'
          : 'at';
  const priceVsLinePctAbs =
    priceVsLinePct == null ? null : Math.abs(priceVsLinePct);
  const touchesTotal = toFiniteNumberOrNull(
    signal.additionalIndicators?.touches,
  );
  const distance = toFiniteNumberOrNull(signal.additionalIndicators?.distance);
  const touches =
    touchesTotal != null
      ? touchesTotal
      : Array.isArray(trendLine?.touches)
        ? trendLine.touches.length
        : null;
  const atrPct = getLastFiniteNumber(signal.indicators?.atrPct);
  const btcMaFast = getLastFiniteNumber(signal.indicators?.btcMaFast);
  const btcMaSlow = getLastFiniteNumber(signal.indicators?.btcMaSlow);
  const btcMaBias = getBias(btcMaFast, btcMaSlow);
  const btcMaSpreadPct = getSpreadPct(btcMaFast, btcMaSlow);
  const btcBiasAligned =
    signalDirection == null || btcMaBias == null
      ? null
      : signalDirection === 'SHORT'
        ? btcMaBias === 'bearish'
        : btcMaBias === 'bullish';
  const clearBreak =
    signalDirection === 'SHORT'
      ? priceVsLineSide === 'below' &&
        priceVsLinePctAbs != null &&
        priceVsLinePctAbs >= 0.35
      : signalDirection === 'LONG'
        ? priceVsLineSide === 'above' &&
          priceVsLinePctAbs != null &&
          priceVsLinePctAbs >= 0.35
        : null;
  const nearLineNoise =
    priceVsLinePctAbs == null ? null : priceVsLinePctAbs < 0.35;
  const breakVsAtrRatio =
    priceVsLinePctAbs != null && atrPct != null && atrPct > 0
      ? priceVsLinePctAbs / atrPct
      : null;
  const weakCleanBreak =
    clearBreak === true &&
    nearLineNoise === false &&
    breakVsAtrRatio != null &&
    breakVsAtrRatio < WEAK_CLEAN_BREAK_ATR_RATIO_MAX;
  const compressedCleanBreak =
    clearBreak === true &&
    nearLineNoise === false &&
    breakVsAtrRatio != null &&
    breakVsAtrRatio < COMPRESSED_CLEAN_BREAK_ATR_RATIO_MAX &&
    (touches ?? 0) >= COMPRESSED_CLEAN_BREAK_TOUCHES_MIN &&
    distance != null &&
    distance < COMPRESSED_CLEAN_BREAK_DISTANCE_MAX;
  const weakLongFarBreak =
    signalDirection === 'LONG' &&
    trendLine?.mode === 'highs' &&
    clearBreak === true &&
    nearLineNoise === false &&
    breakVsAtrRatio != null &&
    breakVsAtrRatio < WEAK_LONG_FAR_BREAK_ATR_RATIO_MAX &&
    distance != null &&
    distance > WEAK_LONG_FAR_BREAK_DISTANCE_MIN &&
    btcBiasAligned === true &&
    btcMaSpreadPct != null &&
    btcMaSpreadPct < WEAK_LONG_FAR_BREAK_BTC_SPREAD_MAX;

  const structuralHardBlockReasons: string[] = [];
  if (clearBreak === false) {
    structuralHardBlockReasons.push('no_clear_break');
  }
  if (nearLineNoise === true) {
    structuralHardBlockReasons.push('near_line_noise');
  }
  if (weakCleanBreak) {
    structuralHardBlockReasons.push('weak_clean_break');
  }
  if (compressedCleanBreak) {
    structuralHardBlockReasons.push('compressed_clean_break');
  }
  if (weakLongFarBreak) {
    structuralHardBlockReasons.push('weak_long_far_break');
  }

  return {
    signalDirection,
    mode: typeof trendLine?.mode === 'string' ? trendLine.mode : null,
    touches,
    distance,
    currentLinePrice,
    currentPrice,
    priceVsLinePct,
    priceVsLineSide,
    priceVsLinePctAbs,
    clearBreak,
    nearLineNoise,
    atrPct,
    breakVsAtrRatio,
    btcMaFast,
    btcMaSlow,
    btcMaBias,
    btcMaSpreadPct,
    btcBiasAligned,
    weakCleanBreak,
    compressedCleanBreak,
    weakLongFarBreak,
    structuralHardBlockReasons,
  };
};
