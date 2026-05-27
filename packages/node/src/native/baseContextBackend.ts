import type {
  BaseContextBackend,
  BaseContextBackendParams,
} from '@tradejs/core/indicators';
import type { Candle } from '@tradejs/types';
import type { NativeCandle } from '@tradejs/native';

type TradejsNative = typeof import('@tradejs/native');

export type IndicatorBackendName = 'ts' | 'rust';

const ENV_KEY = 'TRADEJS_INDICATOR_BACKEND';
const NATIVE_BASE_CONTEXT_LOOKBACK = 220;

let loadedNative: TradejsNative | null = null;

export const resolveIndicatorBackendName = (
  value = process.env[ENV_KEY],
): IndicatorBackendName => {
  const normalized = String(value ?? 'ts')
    .trim()
    .toLowerCase();

  if (!normalized || normalized === 'ts' || normalized === 'typescript') {
    return 'ts';
  }

  if (normalized === 'rust' || normalized === 'native') {
    return 'rust';
  }

  throw new Error(
    `${ENV_KEY} must be "ts" or "rust", received "${String(value)}"`,
  );
};

const loadNative = (): TradejsNative => {
  if (!loadedNative) {
    // Keep this as a runtime require so TS/default mode does not need a built
    // native binding during unit tests or browser-safe package builds.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loadedNative = require('@tradejs/native') as TradejsNative;
  }

  return loadedNative;
};

const toNativeCandle = (candle: Candle): NativeCandle => ({
  timestamp: candle.timestamp,
  open: candle.open,
  high: candle.high,
  low: candle.low,
  close: candle.close,
  volume: candle.volume,
  turnover: candle.turnover ?? undefined,
  takerBuyBaseVolume: candle.takerBuyBaseVolume ?? undefined,
  takerSellBaseVolume: candle.takerSellBaseVolume ?? undefined,
});

const buildRustBaseContextOverlay = ({
  candlesHistory,
  candle,
  prevCandle,
  atr,
}: BaseContextBackendParams) => {
  const native = loadNative();
  const nativeCandlesWindow = candlesHistory.slice(
    -NATIVE_BASE_CONTEXT_LOOKBACK,
  );
  const json = native.buildBaseContextOverlayJson(
    nativeCandlesWindow.map(toNativeCandle),
    candle.close,
    prevCandle?.close ?? null,
    atr,
  );

  return JSON.parse(json) as ReturnType<BaseContextBackend>;
};

export const createBaseContextBackend = (): BaseContextBackend | undefined => {
  const backend = resolveIndicatorBackendName();
  if (backend === 'ts') {
    return undefined;
  }

  return buildRustBaseContextOverlay;
};
