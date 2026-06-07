import {
  buildOnchainContext,
  normalizeOnchainIntervals,
} from '@tradejs/core/indicators';
import { refreshSignalBaseContextGateFeatures } from '@tradejs/core/strategies';
import { getOnchainContextWindow } from '@tradejs/infra/timescale';
import { logger } from '@tradejs/infra/logger';
import type {
  MarketFeatureInterval,
  OnchainContext,
  OnchainSymbolContext,
  Signal,
} from '@tradejs/types';

const DEFAULT_INTERVALS: MarketFeatureInterval[] = ['15m', '1h'];
const DEFAULT_LOOKBACK_HOURS = 48;
const DEFAULT_REFERENCE_SYMBOLS = ['BTCUSDT', 'ETHUSDT'];

let onchainContextUnavailable = false;

const parseEnabledFlag = (value: unknown, env: string) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (normalized === 'backtest') return env === 'BACKTEST';
  if (normalized === 'live') return env !== 'BACKTEST';
  return false;
};

const parseLookbackMs = () => {
  const hours = Number(process.env.ONCHAIN_CONTEXT_LOOKBACK_HOURS);
  const normalizedHours =
    Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_LOOKBACK_HOURS;
  return normalizedHours * 60 * 60 * 1000;
};

const parseIntervals = (): MarketFeatureInterval[] => {
  const fromEnv = normalizeOnchainIntervals(
    process.env.ONCHAIN_CONTEXT_INTERVALS,
  );
  return fromEnv.length ? fromEnv : DEFAULT_INTERVALS;
};

const normalizeSymbol = (symbol: string) =>
  String(symbol || '')
    .trim()
    .toUpperCase();

const parseReferenceSymbols = () => {
  const raw = String(process.env.ONCHAIN_CONTEXT_REFERENCE_SYMBOLS ?? '')
    .split(',')
    .map(normalizeSymbol)
    .filter(Boolean);
  return raw.length ? [...new Set(raw)] : DEFAULT_REFERENCE_SYMBOLS;
};

const resolvePrimaryReferenceSymbol = (
  signalSymbol: string,
  availableSymbols: string[],
) => {
  const symbol = normalizeSymbol(signalSymbol);
  return availableSymbols.includes(symbol)
    ? symbol
    : availableSymbols[0] || DEFAULT_REFERENCE_SYMBOLS[0];
};

const buildReferenceOnchainContext = (params: {
  targetSymbol: string;
  primaryReferenceSymbol: string;
  referenceSymbols: string[];
  referenceContexts: Record<string, OnchainSymbolContext>;
}): OnchainContext => {
  const {
    targetSymbol,
    primaryReferenceSymbol,
    referenceSymbols,
    referenceContexts,
  } = params;
  const primaryContext =
    referenceContexts[primaryReferenceSymbol] ??
    referenceContexts[referenceSymbols[0]];
  if (!primaryContext) {
    throw new Error('No onchain reference contexts built');
  }

  return {
    ...primaryContext,
    targetSymbol,
    primaryReferenceSymbol: primaryContext.symbol,
    referenceSymbols,
    referenceContexts,
  };
};

export const isOnchainContextEnabled = (env: string) =>
  parseEnabledFlag(process.env.ONCHAIN_CONTEXT_ENABLED, env);

export const resetOnchainContextRuntimeState = () => {
  onchainContextUnavailable = false;
};

export const enrichSignalWithOnchainContext = async (params: {
  signal: Signal;
  env: string;
  enabled?: boolean;
}): Promise<boolean> => {
  const { signal, env, enabled = isOnchainContextEnabled(env) } = params;
  if (!enabled || onchainContextUnavailable) {
    return false;
  }

  const baseContext = signal.additionalIndicators?.baseContext;
  if (
    !baseContext ||
    typeof baseContext !== 'object' ||
    Array.isArray(baseContext)
  ) {
    return false;
  }

  try {
    const intervals = parseIntervals();
    const referenceSymbols = parseReferenceSymbols();
    const symbols = [
      ...new Set([normalizeSymbol(signal.symbol), ...referenceSymbols]),
    ].filter(Boolean);
    const lookbackMs = parseLookbackMs();
    const contexts = await Promise.all(
      symbols.map(async (symbol) => {
        const rowsByInterval = await getOnchainContextWindow({
          symbol,
          intervals,
          endMs: signal.timestamp,
          lookbackMs,
        });

        return [
          symbol,
          buildOnchainContext({
            symbol,
            direction: signal.direction,
            timestamp: signal.timestamp,
            rowsByInterval,
            intervals,
          }),
        ] as const;
      }),
    );
    const referenceContexts = Object.fromEntries(contexts) as Record<
      string,
      OnchainSymbolContext
    >;
    const onchainContext = buildReferenceOnchainContext({
      targetSymbol: signal.symbol,
      primaryReferenceSymbol: resolvePrimaryReferenceSymbol(
        signal.symbol,
        symbols,
      ),
      referenceSymbols: symbols,
      referenceContexts,
    });

    signal.additionalIndicators = {
      ...(signal.additionalIndicators ?? {}),
      baseContext: {
        ...(baseContext as Record<string, unknown>),
        onchain: onchainContext,
      },
    };
    refreshSignalBaseContextGateFeatures(signal);
    return true;
  } catch (error) {
    onchainContextUnavailable = true;
    logger.warn(
      'Onchain context disabled after Timescale read failure: %s',
      String(error),
    );
    return false;
  }
};
