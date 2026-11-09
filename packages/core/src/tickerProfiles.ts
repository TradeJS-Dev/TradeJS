import type {
  Candle,
  TickerProfile,
  TickerProfileSnapshot,
} from '@tradejs/types';

const HOUR = 3_600_000;
const WINDOW = 720 * HOUR;
const MIN_HOURS = 576;
export const TICKER_PROFILE_DEFINITION =
  'hourly-30d-monthly-terciles/v1' as const;
export const tickerProfileMonth = (timestamp: number): number => {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0)
    throw new Error('Invalid profile timestamp');
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
};
export const tickerProfileNextMonth = (timestamp: number): number => {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
};

const prepare = (candles: readonly Candle[], asOf: number) => {
  const eligible = candles.filter(
    (c) => c.timestamp >= asOf - WINDOW - HOUR && c.timestamp + HOUR <= asOf,
  );
  let previous = -1;
  for (const candle of eligible) {
    if (
      !Number.isSafeInteger(candle.timestamp) ||
      candle.timestamp % HOUR !== 0 ||
      candle.timestamp <= previous ||
      ![candle.high, candle.low, candle.close].every(
        (v) => Number.isFinite(v) && v > 0,
      ) ||
      !Number.isFinite(candle.volume) ||
      candle.volume < 0
    )
      throw new Error('Invalid or unordered hourly profile candles');
    previous = candle.timestamp;
  }
  const returns = new Map<number, number>();
  for (let i = 1; i < eligible.length; i++) {
    const a = eligible[i - 1],
      b = eligible[i];
    if (b.timestamp - a.timestamp === HOUR && b.timestamp >= asOf - WINDOW)
      returns.set(b.timestamp, Math.log(b.close / a.close));
  }
  return {
    candles: eligible.filter((c) => c.timestamp >= asOf - WINDOW),
    returns,
  };
};
const correlate = (
  target: Map<number, number>,
  reference: Map<number, number>,
) => {
  const pairs = [...target]
    .filter(([t]) => reference.has(t))
    .map(([t, r]) => [r, reference.get(t) ?? 0]);
  if (pairs.length < MIN_HOURS) return { value: null, count: pairs.length };
  const mx = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
  const my = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let xx = 0,
    yy = 0,
    xy = 0;
  for (const [x, y] of pairs) {
    xx += (x - mx) ** 2;
    yy += (y - my) ** 2;
    xy += (x - mx) * (y - my);
  }
  return {
    value:
      xx > 0 && yy > 0
        ? Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy)))
        : null,
    count: pairs.length,
  };
};
const correlationGroup = (
  v: number | null,
): TickerProfile['btcCorrelationGroup'] =>
  v === null ? 'unknown' : v < 0.3 ? 'weak' : v < 0.7 ? 'medium' : 'strong';
const cuts = (values: (number | null)[]): [number | null, number | null] => {
  const sorted = values
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  return [
    sorted[Math.floor((sorted.length - 1) / 3)] ?? null,
    sorted[Math.floor(((sorted.length - 1) * 2) / 3)] ?? null,
  ];
};
const group = (
  v: number | null,
  thresholds: [number | null, number | null],
): TickerProfile['moneyGroup'] =>
  v === null || thresholds[0] === null || thresholds[1] === null
    ? 'unknown'
    : v <= thresholds[0]
      ? 'low'
      : v <= thresholds[1]
        ? 'middle'
        : 'high';

/** Input membership is explicit. Thresholds never depend on trades or outcomes. */
export const buildTickerProfileSnapshot = ({
  asOf,
  provider,
  universeId,
  membership,
  candlesBySymbol,
}: {
  asOf: number;
  provider: string;
  universeId: string;
  membership: TickerProfileSnapshot['membership'];
  candlesBySymbol: Readonly<Record<string, readonly Candle[]>>;
}): TickerProfileSnapshot => {
  if (tickerProfileMonth(asOf) !== asOf)
    throw new Error('Profiles must start at a UTC month boundary');
  const symbols = Object.keys(candlesBySymbol).sort();
  if (!symbols.length || symbols.some((s) => !/^[A-Z0-9]+USDT$/.test(s)))
    throw new Error('Profile universe requires explicit USDT symbols');
  const btc = prepare(candlesBySymbol.BTCUSDT ?? [], asOf).returns;
  const eth = prepare(candlesBySymbol.ETHUSDT ?? [], asOf).returns;
  const validUntil = tickerProfileNextMonth(asOf);
  const profiles: TickerProfile[] = symbols.map((symbol) => {
    const { candles, returns } = prepare(candlesBySymbol[symbol], asOf);
    const quoteCount = candles.filter(
      (c) => Number.isFinite(c.turnover) && Number(c.turnover) >= 0,
    ).length;
    const ready = candles.length >= MIN_HOURS;
    const dailyTurnoverUSDT = ready
      ? candles.reduce(
          (s, c) =>
            s +
            (Number.isFinite(c.turnover) && Number(c.turnover) >= 0
              ? Number(c.turnover)
              : (c.volume * (c.high + c.low + c.close)) / 3),
          0,
        ) / 30
      : null;
    const rr = [...returns.values()],
      mean = rr.reduce((a, b) => a + b, 0) / (rr.length || 1);
    const dailyVolatilityPct =
      rr.length >= MIN_HOURS
        ? Math.sqrt(
            rr.reduce((s, v) => s + (v - mean) ** 2, 0) / (rr.length - 1),
          ) *
          Math.sqrt(24) *
          100
        : null;
    const cb = correlate(returns, btc),
      ce = correlate(returns, eth);
    return {
      symbol,
      asOf,
      validUntil,
      windowStart: asOf - WINDOW,
      hours: candles.length,
      returnHours: rr.length,
      btcAlignedHours: cb.count,
      ethAlignedHours: ce.count,
      turnoverSource: !ready
        ? 'unknown'
        : quoteCount === candles.length
          ? 'quote'
          : quoteCount === 0
            ? 'estimated'
            : 'mixed',
      dailyTurnoverUSDT,
      dailyVolatilityPct,
      correlationBTC: cb.value,
      correlationETH: ce.value,
      moneyGroup: 'unknown',
      volatilityGroup: 'unknown',
      btcCorrelationGroup: correlationGroup(cb.value),
      ethCorrelationGroup: correlationGroup(ce.value),
    };
  });
  const thresholds = {
    money: cuts(profiles.map((p) => p.dailyTurnoverUSDT)),
    volatility: cuts(profiles.map((p) => p.dailyVolatilityPct)),
  };
  for (const p of profiles) {
    p.moneyGroup = group(p.dailyTurnoverUSDT, thresholds.money);
    p.volatilityGroup = group(p.dailyVolatilityPct, thresholds.volatility);
  }
  return {
    schema: 'tradejs-ticker-profiles/v1',
    definition: TICKER_PROFILE_DEFINITION,
    provider,
    universeId,
    membership,
    asOf,
    validUntil,
    thresholds,
    profiles,
  };
};

const record = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const nullableNumber = (v: unknown) =>
  v === null || (typeof v === 'number' && Number.isFinite(v));
/** Validate persisted input before exposing it to strategy or gate code. */
export const isTickerProfileSnapshot = (
  value: unknown,
): value is TickerProfileSnapshot => {
  if (
    !record(value) ||
    value.schema !== 'tradejs-ticker-profiles/v1' ||
    value.definition !== TICKER_PROFILE_DEFINITION ||
    typeof value.provider !== 'string' ||
    typeof value.universeId !== 'string' ||
    !['frozen-list', 'point-in-time'].includes(String(value.membership)) ||
    typeof value.asOf !== 'number' ||
    !Number.isSafeInteger(value.asOf) ||
    value.asOf < 0 ||
    tickerProfileMonth(value.asOf) !== value.asOf ||
    value.validUntil !== tickerProfileNextMonth(value.asOf) ||
    !record(value.thresholds) ||
    !Array.isArray(value.profiles)
  )
    return false;
  for (const key of ['money', 'volatility']) {
    const cut = value.thresholds[key];
    if (!Array.isArray(cut) || cut.length !== 2 || !cut.every(nullableNumber))
      return false;
  }
  const symbols = new Set<string>();
  for (const p of value.profiles) {
    if (
      !record(p) ||
      typeof p.symbol !== 'string' ||
      !/^[A-Z0-9]+USDT$/.test(p.symbol) ||
      symbols.has(p.symbol) ||
      p.asOf !== value.asOf ||
      p.validUntil !== value.validUntil ||
      p.windowStart !== value.asOf - WINDOW
    )
      return false;
    symbols.add(p.symbol);
    for (const k of [
      'hours',
      'returnHours',
      'btcAlignedHours',
      'ethAlignedHours',
    ])
      if (
        typeof p[k] !== 'number' ||
        !Number.isInteger(p[k]) ||
        p[k] < 0 ||
        p[k] > 720
      )
        return false;
    for (const k of ['dailyTurnoverUSDT', 'dailyVolatilityPct'])
      if (!nullableNumber(p[k]) || (typeof p[k] === 'number' && p[k] < 0))
        return false;
    for (const k of ['correlationBTC', 'correlationETH'])
      if (
        !nullableNumber(p[k]) ||
        (typeof p[k] === 'number' && Math.abs(p[k]) > 1)
      )
        return false;
    if (
      !['quote', 'estimated', 'mixed', 'unknown'].includes(
        String(p.turnoverSource),
      )
    )
      return false;
    for (const k of ['moneyGroup', 'volatilityGroup'])
      if (!['low', 'middle', 'high', 'unknown'].includes(String(p[k])))
        return false;
    for (const k of ['btcCorrelationGroup', 'ethCorrelationGroup'])
      if (!['weak', 'medium', 'strong', 'unknown'].includes(String(p[k])))
        return false;
  }
  return symbols.size > 0;
};
