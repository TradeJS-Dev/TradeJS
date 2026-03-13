import { Candle } from '@tradejs/types';

export interface PinePlotPoint {
  title?: string;
  time?: number;
  value?: unknown;
  options?: Record<string, unknown>;
}

export interface PineContextLike {
  plots?: Record<string, { data?: PinePlotPoint[] }>;
  result?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RunPineScriptParams {
  candles: Candle[];
  script: string;
  symbol?: string;
  timeframe?: string;
  inputs?: Record<string, unknown>;
  limit?: number;
}

export const getPinePlotSeries = (
  context: PineContextLike,
  plotName: string,
): PinePlotPoint[] => {
  const name = String(plotName || '').trim();
  if (!name) return [];

  const data = context?.plots?.[name]?.data;
  return Array.isArray(data) ? data : [];
};

export const getLatestPinePlotValue = (
  context: PineContextLike,
  plotName: string,
): unknown => {
  const series = getPinePlotSeries(context, plotName);
  if (!series.length) return undefined;
  return series[series.length - 1]?.value;
};

export const asFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
};

export const asPineBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  return false;
};
