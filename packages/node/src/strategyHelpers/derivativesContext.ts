import {
  buildDerivativesContext,
  normalizeDerivativesIntervals,
} from '@tradejs/core/indicators';
import { getDerivativesWindow } from '@tradejs/infra/timescale';
import { logger } from '@tradejs/infra/logger';
import type { DerivativesInterval, Signal } from '@tradejs/types';

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
    const rowsByInterval = await getDerivativesWindow({
      symbol: signal.symbol,
      intervals,
      endMs: signal.timestamp,
      lookbackMs: parseLookbackMs(),
    });
    const derivativesContext = buildDerivativesContext({
      symbol: signal.symbol,
      direction: signal.direction,
      timestamp: signal.timestamp,
      rowsByInterval,
      intervals,
    });

    signal.additionalIndicators = {
      ...(signal.additionalIndicators ?? {}),
      derivativesContext,
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
