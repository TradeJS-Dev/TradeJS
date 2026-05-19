import type { Signal } from '@tradejs/types';

type SpreadBias = 'coinbase_premium' | 'binance_premium' | 'flat';
type SpreadSeverity = 'normal' | 'elevated' | 'wide';

type MarketSessionContext = {
  source: 'payload.additionalIndicators.baseContext.regime.session';
  timezone: 'UTC';
  utcHour: number | null;
  utcMinute: number | null;
  primarySession: 'asia' | 'europe' | 'us' | 'off_hours' | 'unknown';
  activeSessions: Array<'asia' | 'europe' | 'us'>;
  isOverlap: boolean;
  overlap: string | null;
  minutesFromSessionOpen: number | null;
  minutesToFundingWindow: number | null;
  fundingWindowNearby: boolean;
};

type BinanceCoinbaseSpreadContext = {
  source: 'payload.additionalIndicators.baseContext.relative.execution.venueSpread';
  indicatorKey: 'payload.additionalIndicators.baseContext.relative.execution.venueSpread';
  available: boolean;
  value: number | null;
  zScore: number | null;
  bps: number | null;
  absBps: number | null;
  bias: SpreadBias | null;
  severity: SpreadSeverity | null;
};

export type AiMarketContext = {
  session: MarketSessionContext;
  execution: {
    binanceCoinbaseSpread: BinanceCoinbaseSpreadContext;
  };
};

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

const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const buildMissingSessionContext = (): MarketSessionContext => ({
  source: 'payload.additionalIndicators.baseContext.regime.session',
  timezone: 'UTC',
  utcHour: null,
  utcMinute: null,
  primarySession: 'unknown',
  activeSessions: [],
  isOverlap: false,
  overlap: null,
  minutesFromSessionOpen: null,
  minutesToFundingWindow: null,
  fundingWindowNearby: false,
});

const buildSessionContextFromSignal = (
  signal: Signal,
): MarketSessionContext => {
  const baseContext = toRecord(signal.additionalIndicators?.baseContext);
  const regime = toRecord(baseContext?.regime);
  const session = toRecord(regime?.session);
  if (!session) {
    return buildMissingSessionContext();
  }

  const primarySession = session.primarySession;
  const activeSessions = Array.isArray(session.activeSessions)
    ? session.activeSessions.filter(
        (value): value is MarketSessionContext['activeSessions'][number] =>
          value === 'asia' || value === 'europe' || value === 'us',
      )
    : [];

  return {
    source: 'payload.additionalIndicators.baseContext.regime.session',
    timezone: 'UTC',
    utcHour: toFiniteNumber(session.utcHour),
    utcMinute: toFiniteNumber(session.utcMinute),
    primarySession:
      primarySession === 'asia' ||
      primarySession === 'europe' ||
      primarySession === 'us' ||
      primarySession === 'off_hours'
        ? primarySession
        : 'unknown',
    activeSessions,
    isOverlap: session.isOverlap === true,
    overlap: typeof session.overlap === 'string' ? session.overlap : null,
    minutesFromSessionOpen: toFiniteNumber(session.minutesFromSessionOpen),
    minutesToFundingWindow: toFiniteNumber(session.minutesToFundingWindow),
    fundingWindowNearby: session.fundingWindowNearby === true,
  };
};

const buildMissingSpreadContext = (): BinanceCoinbaseSpreadContext => ({
  source:
    'payload.additionalIndicators.baseContext.relative.execution.venueSpread',
  indicatorKey:
    'payload.additionalIndicators.baseContext.relative.execution.venueSpread',
  available: false,
  value: null,
  zScore: null,
  bps: null,
  absBps: null,
  bias: null,
  severity: null,
});

const buildSpreadContextFromSignal = (
  signal: Signal,
): BinanceCoinbaseSpreadContext => {
  const baseContext = toRecord(signal.additionalIndicators?.baseContext);
  const relative = toRecord(baseContext?.relative);
  const execution = toRecord(relative?.execution);
  const spread = toFiniteNumber(execution?.venueSpread);
  const zScore = toFiniteNumber(execution?.venueSpreadZScore);

  if (spread == null) {
    return buildMissingSpreadContext();
  }

  const value = roundTo(spread, 8);
  const bps = roundTo(value * 10_000, 2);
  const absBps = Math.abs(bps);
  const bias: SpreadBias =
    absBps < 1 ? 'flat' : bps > 0 ? 'coinbase_premium' : 'binance_premium';
  const severity: SpreadSeverity =
    absBps >= 20 ? 'wide' : absBps >= 5 ? 'elevated' : 'normal';

  return {
    source:
      'payload.additionalIndicators.baseContext.relative.execution.venueSpread',
    indicatorKey:
      'payload.additionalIndicators.baseContext.relative.execution.venueSpread',
    available: true,
    value,
    zScore,
    bps,
    absBps,
    bias,
    severity,
  };
};

export const buildAiMarketContext = (signal: Signal): AiMarketContext => ({
  session: buildSessionContextFromSignal(signal),
  execution: {
    binanceCoinbaseSpread: buildSpreadContextFromSignal(signal),
  },
});
