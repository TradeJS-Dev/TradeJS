import fs from 'node:fs';
import path from 'node:path';
import type { Candle } from '@tradejs/types';

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

export const getLatestPineRawPlotValue = (
  context: PineContextLike,
  plotName: string,
): unknown => {
  const series = getPinePlotSeries(context, plotName);
  if (!series.length) return undefined;
  return series[series.length - 1]?.value;
};

export const getLatestPineNumberPlotValue = (
  context: PineContextLike,
  plotName: string,
): number | null =>
  toFiniteNumber(getLatestPineRawPlotValue(context, plotName)) ?? null;

export const getLatestPineBooleanPlotValue = (
  context: PineContextLike,
  plotName: string,
): boolean => toPineBoolean(getLatestPineRawPlotValue(context, plotName));

export const getLatestPineNumberPlotValues = <TPlotName extends string>(
  context: PineContextLike,
  plotNames: readonly TPlotName[],
): Record<TPlotName, number | null> =>
  Object.fromEntries(
    plotNames.map((plotName) => [
      plotName,
      getLatestPineNumberPlotValue(context, plotName),
    ]),
  ) as Record<TPlotName, number | null>;

export const getLatestPineBooleanPlotValues = <TPlotName extends string>(
  context: PineContextLike,
  plotNames: readonly TPlotName[],
): Record<TPlotName, boolean> =>
  Object.fromEntries(
    plotNames.map((plotName) => [
      plotName,
      getLatestPineBooleanPlotValue(context, plotName),
    ]),
  ) as Record<TPlotName, boolean>;

export const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
};

export const toPineBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  return false;
};

type PineRuntime = {
  run: (indicator: unknown) => Promise<unknown>;
};

type PineRuntimeCtor = new (
  source: unknown,
  tickerId?: string,
  timeframe?: string,
  limit?: number,
  sDate?: number,
  eDate?: number,
) => PineRuntime;

type PineIndicatorCtor = new (
  source: Function | string,
  inputs?: Record<string, unknown>,
) => unknown;

type PinetsCjsModule = {
  PineTS: PineRuntimeCtor;
  Indicator: PineIndicatorCtor;
};

const loadPinets = (): PinetsCjsModule => {
  // In Jest (jsdom), "pinets" may resolve to browser bundle by default.
  // Resolve then force CJS/node bundle path when needed.
  const resolvedPath = require.resolve('pinets') as string;
  const cjsPath = resolvedPath.includes('pinets.min.browser')
    ? resolvedPath.replace(/pinets\.min\.browser(\.es)?\.js$/, 'pinets.min.cjs')
    : resolvedPath;
  return require(cjsPath) as PinetsCjsModule;
};

interface PineRuntimeCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openTime: number;
  closeTime: number;
}

export const loadPineScriptFile = (filePath: string, fallback = ''): string => {
  const resolvedPath = String(filePath || '').trim();
  if (!resolvedPath) {
    return fallback;
  }

  try {
    return fs.readFileSync(resolvedPath, 'utf8').trim();
  } catch {
    return fallback;
  }
};

export const createPineScriptLoader = (
  baseDir: string,
): ((fileNameOrPath: string, fallback?: string) => string) => {
  const resolvedBaseDir = path.resolve(baseDir);
  return (fileNameOrPath: string, fallback = '') => {
    const rawPath = String(fileNameOrPath || '').trim();
    if (!rawPath) {
      return fallback;
    }

    const resolvedPath = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(resolvedBaseDir, rawPath);
    return loadPineScriptFile(resolvedPath, fallback);
  };
};

const MINUTE_MS = 60_000;

const normalizeTimestampMs = (timestamp: number): number =>
  timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;

const resolveCandleDuration = (candles: Candle[]): number => {
  if (candles.length < 2) {
    return MINUTE_MS;
  }

  const first = normalizeTimestampMs(candles[0].timestamp);
  const second = normalizeTimestampMs(candles[1].timestamp);
  const duration = Math.max(second - first, MINUTE_MS);
  return Number.isFinite(duration) && duration > 0 ? duration : MINUTE_MS;
};

const toPineRuntimeCandles = (candles: Candle[]): PineRuntimeCandle[] => {
  const candleDuration = resolveCandleDuration(candles);
  return candles.map((candle) => {
    const openTime = normalizeTimestampMs(candle.timestamp);
    return {
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume ?? 0),
      openTime,
      closeTime: openTime + candleDuration,
    };
  });
};

export const runPineScript = async ({
  candles,
  script,
  symbol = 'SYMBOL',
  timeframe = '15',
  inputs = {},
  limit,
}: RunPineScriptParams): Promise<PineContextLike> => {
  const { PineTS, Indicator } = loadPinets();
  const trimmedScript = String(script || '').trim();
  if (!trimmedScript) {
    throw new Error('Pine script is empty');
  }

  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('No candles provided for Pine script execution');
  }

  const pineCandles = toPineRuntimeCandles(candles);
  const pine = new PineTS(
    pineCandles,
    symbol,
    timeframe,
    Math.max(1, limit ?? pineCandles.length),
  );
  const indicator = new Indicator(trimmedScript, inputs);
  const context = await pine.run(indicator);
  return context as unknown as PineContextLike;
};
