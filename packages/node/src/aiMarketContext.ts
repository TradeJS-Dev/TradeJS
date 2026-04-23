import type { Signal } from '@tradejs/types';

type TradingSessionName = 'asia' | 'europe' | 'us';
type PrimaryTradingSession = TradingSessionName | 'off_hours';
type SpreadBias = 'coinbase_premium' | 'binance_premium' | 'flat';
type SpreadSeverity = 'normal' | 'elevated' | 'wide';

type TradingSessionContext = {
  timezone: 'UTC';
  utcHour: number;
  utcMinute: number;
  primarySession: PrimaryTradingSession;
  activeSessions: TradingSessionName[];
  isOverlap: boolean;
  overlap: string | null;
};

type BinanceCoinbaseSpreadContext = {
  source: 'binance_coinbase_btc';
  indicatorKey: 'payload.indicators.spread';
  available: boolean;
  value: number | null;
  bps: number | null;
  absBps: number | null;
  bias: SpreadBias | null;
  severity: SpreadSeverity | null;
};

export type AiMarketContext = {
  tradingSession: TradingSessionContext;
  binanceCoinbaseSpread: BinanceCoinbaseSpreadContext;
};

const SESSION_WINDOWS: Array<{
  name: TradingSessionName;
  startMinuteUtc: number;
  endMinuteUtc: number;
}> = [
  { name: 'asia', startMinuteUtc: 0, endMinuteUtc: 8 * 60 },
  { name: 'europe', startMinuteUtc: 7 * 60, endMinuteUtc: 16 * 60 },
  { name: 'us', startMinuteUtc: 13 * 60, endMinuteUtc: 22 * 60 },
];

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
};

const toFiniteNumber = (value: unknown): number | null => {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(numeric) ? numeric : null;
};

const getLastFiniteNumber = (value: unknown): number | null => {
  const numeric = toFiniteNumber(value);
  if (numeric != null) {
    return numeric;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  for (let i = value.length - 1; i >= 0; i -= 1) {
    const nested = getLastFiniteNumber(value[i]);
    if (nested != null) {
      return nested;
    }
  }

  return null;
};

const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const isInsideSession = (
  minuteUtc: number,
  startMinuteUtc: number,
  endMinuteUtc: number,
) =>
  startMinuteUtc <= endMinuteUtc
    ? minuteUtc >= startMinuteUtc && minuteUtc < endMinuteUtc
    : minuteUtc >= startMinuteUtc || minuteUtc < endMinuteUtc;

export const buildTradingSessionContext = (
  timestamp: number,
): TradingSessionContext => {
  const date = new Date(timestamp);
  const utcHour = date.getUTCHours();
  const utcMinute = date.getUTCMinutes();
  const minuteUtc = utcHour * 60 + utcMinute;
  const activeSessions = SESSION_WINDOWS.filter((session) =>
    isInsideSession(minuteUtc, session.startMinuteUtc, session.endMinuteUtc),
  ).map((session) => session.name);

  const primarySession: PrimaryTradingSession = activeSessions.includes('us')
    ? 'us'
    : activeSessions.includes('europe')
      ? 'europe'
      : activeSessions.includes('asia')
        ? 'asia'
        : 'off_hours';

  return {
    timezone: 'UTC',
    utcHour,
    utcMinute,
    primarySession,
    activeSessions,
    isOverlap: activeSessions.length > 1,
    overlap:
      activeSessions.length > 1 ? `${activeSessions.join('_')}_overlap` : null,
  };
};

const buildMissingSpreadContext = (): BinanceCoinbaseSpreadContext => ({
  source: 'binance_coinbase_btc',
  indicatorKey: 'payload.indicators.spread',
  available: false,
  value: null,
  bps: null,
  absBps: null,
  bias: null,
  severity: null,
});

const buildSpreadContextFromValue = (
  spread: number,
): BinanceCoinbaseSpreadContext => {
  const value = roundTo(spread, 8);
  const bps = roundTo(value * 10_000, 2);
  const absBps = Math.abs(bps);
  const bias: SpreadBias =
    Math.abs(bps) < 1
      ? 'flat'
      : bps > 0
        ? 'coinbase_premium'
        : 'binance_premium';
  const severity: SpreadSeverity =
    absBps >= 20 ? 'wide' : absBps >= 5 ? 'elevated' : 'normal';

  return {
    source: 'binance_coinbase_btc',
    indicatorKey: 'payload.indicators.spread',
    available: true,
    value,
    bps,
    absBps,
    bias,
    severity,
  };
};

const readSpreadFromSignal = (signal: Signal) => {
  const indicatorSpread = getLastFiniteNumber(signal.indicators?.spread);
  if (indicatorSpread != null) {
    return indicatorSpread;
  }

  return getLastFiniteNumber(signal.additionalIndicators?.spread);
};

export const buildAiMarketContext = (signal: Signal): AiMarketContext => {
  const existingMarketContext = toRecord(
    signal.additionalIndicators?.marketContext,
  );
  const existingSpread = toRecord(existingMarketContext?.binanceCoinbaseSpread);
  const spread = readSpreadFromSignal(signal);

  return {
    ...(existingMarketContext ?? {}),
    tradingSession: buildTradingSessionContext(signal.timestamp),
    binanceCoinbaseSpread:
      spread != null
        ? buildSpreadContextFromValue(spread)
        : (existingSpread as BinanceCoinbaseSpreadContext | null) ??
          buildMissingSpreadContext(),
  };
};
