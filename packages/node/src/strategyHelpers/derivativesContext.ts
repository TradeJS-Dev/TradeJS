import {
  buildDerivativesContext,
  normalizeDerivativesIntervals,
} from '@tradejs/core/indicators';
import { DERIVATIVES_CONTEXT_REFERENCE_SYMBOLS } from '@tradejs/core/constants';
import { getDerivativesWindow } from '@tradejs/infra/timescale';
import { logger } from '@tradejs/infra/logger';
import type {
  DerivativesContext,
  DerivativesInterval,
  DerivativesSymbolContext,
  Signal,
} from '@tradejs/types';

const DEFAULT_INTERVALS: DerivativesInterval[] = ['15m', '1h'];
const DEFAULT_LOOKBACK_HOURS = 48;

let derivativesContextUnavailable = false;

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
  const hours = Number(process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS);
  const normalizedHours =
    Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_LOOKBACK_HOURS;
  return normalizedHours * 60 * 60 * 1000;
};

const parseIntervals = (): DerivativesInterval[] => {
  const fromEnv = normalizeDerivativesIntervals(
    process.env.DERIVATIVES_CONTEXT_INTERVALS,
  );
  return fromEnv.length ? fromEnv : DEFAULT_INTERVALS;
};

export const getDerivativesContextReferenceSymbols = () => [
  ...DERIVATIVES_CONTEXT_REFERENCE_SYMBOLS,
];

const normalizeSymbol = (symbol: string) =>
  String(symbol || '')
    .trim()
    .toUpperCase();

const getSignalPriceChangePct1h = (signal: Signal) => {
  const baseContext = signal.additionalIndicators?.baseContext;
  if (
    !baseContext ||
    typeof baseContext !== 'object' ||
    Array.isArray(baseContext)
  ) {
    return null;
  }

  const raw =
    typeof (baseContext as Record<string, unknown>).raw === 'object' &&
    (baseContext as Record<string, unknown>).raw &&
    !Array.isArray((baseContext as Record<string, unknown>).raw)
      ? ((baseContext as Record<string, unknown>).raw as Record<
          string,
          unknown
        >)
      : null;
  const price =
    raw &&
    typeof raw.price === 'object' &&
    raw.price &&
    !Array.isArray(raw.price)
      ? (raw.price as Record<string, unknown>)
      : null;
  const value = price?.price1hPct;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const resolvePrimaryReferenceSymbol = (signalSymbol: string) => {
  const symbol = normalizeSymbol(signalSymbol);
  const referenceSymbols = getDerivativesContextReferenceSymbols();
  return referenceSymbols.some((referenceSymbol) => referenceSymbol === symbol)
    ? symbol
    : referenceSymbols[0];
};

const buildReferenceDerivativesContext = (params: {
  targetSymbol: string;
  primaryReferenceSymbol: string;
  referenceContexts: Record<string, DerivativesSymbolContext>;
}): DerivativesContext => {
  const { targetSymbol, primaryReferenceSymbol, referenceContexts } = params;
  const primaryContext =
    referenceContexts[primaryReferenceSymbol] ??
    referenceContexts[getDerivativesContextReferenceSymbols()[0]];
  if (!primaryContext) {
    throw new Error('No derivatives reference contexts built');
  }

  return {
    ...primaryContext,
    targetSymbol,
    primaryReferenceSymbol: primaryContext.symbol,
    referenceSymbols: getDerivativesContextReferenceSymbols(),
    referenceContexts,
  };
};

export const isDerivativesContextEnabled = (env: string) =>
  parseEnabledFlag(process.env.DERIVATIVES_CONTEXT_ENABLED, env);

export const resetDerivativesContextRuntimeState = () => {
  derivativesContextUnavailable = false;
};

export const enrichSignalWithDerivativesContext = async (params: {
  signal: Signal;
  env: string;
  enabled?: boolean;
}): Promise<boolean> => {
  const { signal, env, enabled = isDerivativesContextEnabled(env) } = params;
  if (!enabled || derivativesContextUnavailable) {
    return false;
  }

  try {
    const intervals = parseIntervals();
    const referenceSymbols = getDerivativesContextReferenceSymbols();
    const lookbackMs = parseLookbackMs();
    const contexts = await Promise.all(
      referenceSymbols.map(async (symbol) => {
        const rowsByInterval = await getDerivativesWindow({
          symbol,
          intervals,
          endMs: signal.timestamp,
          lookbackMs,
        });

        return [
          symbol,
          buildDerivativesContext({
            symbol,
            direction: signal.direction,
            timestamp: signal.timestamp,
            rowsByInterval,
            priceChangePct1h: getSignalPriceChangePct1h(signal),
            intervals,
          }),
        ] as const;
      }),
    );
    const referenceContexts = Object.fromEntries(contexts) as Record<
      string,
      DerivativesSymbolContext
    >;
    const derivativesContext = buildReferenceDerivativesContext({
      targetSymbol: signal.symbol,
      primaryReferenceSymbol: resolvePrimaryReferenceSymbol(signal.symbol),
      referenceContexts,
    });

    signal.additionalIndicators = {
      ...(signal.additionalIndicators ?? {}),
      derivativesContext,
      baseContext:
        signal.additionalIndicators?.baseContext &&
        typeof signal.additionalIndicators.baseContext === 'object' &&
        !Array.isArray(signal.additionalIndicators.baseContext)
          ? {
              ...(signal.additionalIndicators.baseContext as Record<
                string,
                unknown
              >),
              derivatives: derivativesContext,
            }
          : signal.additionalIndicators?.baseContext,
    };
    return true;
  } catch (error) {
    derivativesContextUnavailable = true;
    logger.warn(
      'Derivatives context disabled after Timescale read failure: %s',
      String(error),
    );
    return false;
  }
};
