import type { Signal } from '@tradejs/types';

type SpreadBias = 'coinbase_premium' | 'binance_premium' | 'flat';
type SpreadSeverity = 'normal' | 'elevated' | 'wide';

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
  execution: {
    binanceCoinbaseSpread: buildSpreadContextFromSignal(signal),
  },
});
