import fs from 'node:fs';
import path from 'node:path';
import type { Candle } from '@tradejs/types';
import type { PineContextLike, RunPineScriptParams } from './pineShared';
export * from './pineShared';

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
  // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
  const resolvedPath = require.resolve('pinets') as string;
  const cjsPath = resolvedPath.includes('pinets.min.browser')
    ? resolvedPath.replace(/pinets\.min\.browser(\.es)?\.js$/, 'pinets.min.cjs')
    : resolvedPath;
  // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
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

export const loadPineScript = (filePath: string, fallback = ''): string => {
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

export const createLoadPineScript = (
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
    return loadPineScript(resolvedPath, fallback);
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
