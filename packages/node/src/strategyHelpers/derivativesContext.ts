import {
  buildDerivativesContext,
  normalizeDerivativesIntervals,
} from '@tradejs/core/indicators';
import { refreshSignalBaseContextGateFeatures } from '@tradejs/core/strategies';
import { resolveDerivativesContextReferenceSymbols } from '@tradejs/core/constants';
import { getDerivativesWindow } from '@tradejs/infra/timescale';
import { logger } from '@tradejs/infra/logger';
import type {
  DerivativesContext,
  DerivativesInterval,
  DerivativesIntervalContext,
  DerivativesSymbolContext,
  DerivativesTargetDerivedContext,
  Signal,
} from '@tradejs/types';

const DEFAULT_INTERVALS: DerivativesInterval[] = ['15m', '1h'];
const DEFAULT_LOOKBACK_HOURS = 48;

let derivativesContextUnavailable = false;

const parseEnabledFlag = (value: unknown, env: string) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (normalized === 'backtest') return env === 'BACKTEST';
  if (normalized === 'live') return env !== 'BACKTEST';
  return false;
};

const parseBooleanFlag = (value: unknown, fallback = false) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
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
  ...resolveDerivativesContextReferenceSymbols(
    process.env.DERIVATIVES_CONTEXT_EXTRA_REFERENCE_SYMBOLS,
  ),
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

const getPrimaryIntervalContext = (
  context: DerivativesSymbolContext | null | undefined,
): DerivativesIntervalContext | null =>
  context?.intervals['15m'] ?? context?.intervals['1h'] ?? null;

const hasDerivativesSymbolData = (context: DerivativesSymbolContext) =>
  Object.keys(context.intervals).length > 0 &&
  !context.summary.riskFlags.includes('missing_derivatives');

const toFiniteNumberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const roundNullable = (value: number | null, digits = 4): number | null => {
  if (value == null || !Number.isFinite(value)) return null;
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
};

const deltaNullable = (
  targetValue: number | null | undefined,
  referenceValue: number | null | undefined,
) => {
  const target = toFiniteNumberOrNull(targetValue);
  const reference = toFiniteNumberOrNull(referenceValue);
  return target == null || reference == null
    ? null
    : roundNullable(target - reference);
};

const buildTargetDerivedContext = (params: {
  targetContext: DerivativesSymbolContext;
  primaryReferenceContext: DerivativesSymbolContext | null;
}): DerivativesTargetDerivedContext => {
  const { targetContext, primaryReferenceContext } = params;
  const targetPrimary = getPrimaryIntervalContext(targetContext);
  const referencePrimary = getPrimaryIntervalContext(primaryReferenceContext);
  const targetDirectionAligned = targetContext.summary.directionAligned;
  const referenceDirectionAligned =
    primaryReferenceContext?.summary.directionAligned ?? null;

  return {
    available: hasDerivativesSymbolData(targetContext),
    stale:
      targetContext.summary.riskFlags.includes('stale_derivatives') ||
      targetPrimary?.stale === true
        ? true
        : targetPrimary == null
          ? null
          : false,
    sourceSymbol: targetContext.symbol,
    referenceSymbol: primaryReferenceContext?.symbol ?? null,
    directionAligned: targetDirectionAligned,
    referenceDirectionAligned,
    pressure: targetContext.summary.pressure ?? null,
    referencePressure: primaryReferenceContext?.summary.pressure ?? null,
    riskFlags: targetContext.summary.riskFlags,
    oiChangePct1h: targetPrimary?.oiChangePct1h ?? null,
    oiAcceleration: targetContext.summary.oiAcceleration ?? null,
    fundingRate: targetPrimary?.fundingRate ?? null,
    fundingZScore: targetPrimary?.fundingZScore ?? null,
    fundingChange1h: targetContext.summary.fundingChange1h ?? null,
    liqSpikeRatio: targetPrimary?.liqSpikeRatio ?? null,
    liqImbalance: targetPrimary?.liqImbalance ?? null,
    targetVsPrimaryOiChangePct1hDelta: deltaNullable(
      targetPrimary?.oiChangePct1h,
      referencePrimary?.oiChangePct1h,
    ),
    targetVsPrimaryFundingZScoreDelta: deltaNullable(
      targetPrimary?.fundingZScore,
      referencePrimary?.fundingZScore,
    ),
    targetReferenceConflict:
      targetDirectionAligned == null || referenceDirectionAligned == null
        ? null
        : targetDirectionAligned !== referenceDirectionAligned,
  };
};

const buildReferenceDerivativesContext = (params: {
  targetSymbol: string;
  primaryReferenceSymbol: string;
  referenceContexts: Record<string, DerivativesSymbolContext>;
  targetContext?: DerivativesSymbolContext;
}): DerivativesContext => {
  const {
    targetSymbol,
    primaryReferenceSymbol,
    referenceContexts,
    targetContext,
  } = params;
  const primaryContext =
    referenceContexts[primaryReferenceSymbol] ??
    referenceContexts[getDerivativesContextReferenceSymbols()[0]];
  if (!primaryContext) {
    throw new Error('No derivatives reference contexts built');
  }
  const targetDerived =
    targetContext && hasDerivativesSymbolData(targetContext)
      ? buildTargetDerivedContext({
          targetContext,
          primaryReferenceContext: primaryContext,
        })
      : undefined;

  return {
    ...primaryContext,
    targetSymbol,
    primaryReferenceSymbol: primaryContext.symbol,
    referenceSymbols: getDerivativesContextReferenceSymbols(),
    referenceContexts,
    ...(targetContext && targetDerived
      ? {
          targetContext,
          targetDerived,
        }
      : {}),
  };
};

export const isDerivativesContextEnabled = (env: string) =>
  parseEnabledFlag(process.env.DERIVATIVES_CONTEXT_ENABLED, env);

export const isDerivativesTargetContextEnabled = () =>
  parseBooleanFlag(process.env.DERIVATIVES_CONTEXT_TARGET_ENABLED, false);

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
    const targetSymbol = normalizeSymbol(signal.symbol);
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
    const shouldLoadTargetContext =
      isDerivativesTargetContextEnabled() &&
      targetSymbol.length > 0 &&
      !referenceSymbols.some(
        (referenceSymbol) => referenceSymbol === targetSymbol,
      );
    const targetContext = shouldLoadTargetContext
      ? await (async () => {
          const rowsByInterval = await getDerivativesWindow({
            symbol: targetSymbol,
            intervals,
            endMs: signal.timestamp,
            lookbackMs,
          });
          const context = buildDerivativesContext({
            symbol: targetSymbol,
            direction: signal.direction,
            timestamp: signal.timestamp,
            rowsByInterval,
            priceChangePct1h: getSignalPriceChangePct1h(signal),
            intervals,
          });
          return hasDerivativesSymbolData(context) ? context : undefined;
        })()
      : undefined;
    const derivativesContext = buildReferenceDerivativesContext({
      targetSymbol: targetSymbol || signal.symbol,
      primaryReferenceSymbol: resolvePrimaryReferenceSymbol(targetSymbol),
      referenceContexts,
      targetContext,
    });

    signal.additionalIndicators = {
      ...(signal.additionalIndicators ?? {}),
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
    refreshSignalBaseContextGateFeatures(signal);
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
