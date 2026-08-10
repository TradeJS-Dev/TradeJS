import {
  Candle,
  BaseStrategyContextSnapshot,
  IndicatorSnapshot,
  IndicatorsHistorySnapshot,
  MlCandleIndicatorsSnapshot,
} from '@tradejs/types';
import { ML_BASE_CANDLES_WINDOW, CORRELATION_WINDOW } from '../constants';
import { cloneArrayValues } from './array';
import { calculateCoinBtcCorrelation } from './correlation';
import {
  BASE_CONTEXT_MA_LAYER_PERIODS,
  buildBaseContextSnapshot,
  type BaseContextAdaptiveChannelInput,
  type BaseContextContextMaInput,
  type BaseContextMaLayerInput,
  type BaseContextPsarInput,
  type BreakoutRuntimeState,
  type CloseStreakRuntimeState,
} from './indicatorBaseContext';
import {
  appendNumericHistory,
  cloneNumericHistoryBuffer,
  createNumericHistoryBuffer,
  getLatestHistoryNumber,
  materializeNumericHistory,
  type NumericHistoryBuffer,
} from './indicatorHistory';
import {
  BASE_INTERVAL_MINUTES,
  buildMlCandleIndicators,
  calculateZScore,
  cloneMlCandle,
  createIncrementalResampleCache,
  CANDLE_WINDOW,
  INDICATOR_TIMEFRAMES,
  isFiniteNumber,
  ONE_DAY_MS,
  ONE_DAY_CANDLE_WINDOW,
  percentChange,
  resampleCandles,
  toMlCandle,
  toNullable,
  type IndicatorValue,
} from './indicatorMath';
import { getRegisteredIndicatorEntries } from './indicatorPlugins';
import {
  createSerializableAtr,
  createSerializableAdx,
  createSerializableBollinger,
  createSerializableEma,
  createSerializableMacd,
  createSerializableObv,
  createSerializablePsar,
  createSerializableRsi,
  SerializableAdxState,
  SerializableAdxOutput,
  createSerializableSma,
  SerializableAtrState,
  SerializableBollingerState,
  SerializableEmaState,
  SerializableMacdState,
  SerializableObvState,
  SerializablePsarState,
  SerializableRsiState,
  SerializableSdState,
  SerializableSmaState,
} from './serializableIndicators';
import {
  createSerializableSpreadSmoother,
  SpreadSmootherState,
} from './spread';

export { buildMlCandleIndicators };

const DEFAULT_INDICATOR_PERIODS: IndicatorPeriods = {
  maFast: 14,
  maMedium: 49,
  maSlow: 50,
  obvSma: 10,
  atr: 14,
  atrPctShort: 7,
  atrPctLong: 30,
  bb: 20,
  bbStd: 2,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  levelLookback: 20,
  levelDelay: 2,
};

const resolveIndicatorPeriods = (
  periods: Partial<IndicatorPeriods> = {},
): IndicatorPeriods => {
  const resolved = {
    ...DEFAULT_INDICATOR_PERIODS,
  };

  for (const [key, value] of Object.entries(periods) as Array<
    [keyof IndicatorPeriods, unknown]
  >) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      resolved[key] = value;
    }
  }

  return resolved;
};

const ONE_HOUR_MS = 3_600_000;
const BASE_CONTEXT_RAW_HISTORY_WINDOW = 200;
const BASE_CONTEXT_CONTEXT_MA_PERIOD = 34;
const BASE_CONTEXT_ADAPTIVE_CHANNEL_PERIOD = 20;
const BASE_CONTEXT_PSAR_START = 0.02;
const BASE_CONTEXT_PSAR_INCREMENT = 0.02;
const BASE_CONTEXT_PSAR_MAXIMUM = 0.2;
const BASE_CONTEXT_PSAR_EMA_PERIOD = 50;
const BASE_CONTEXT_PSAR_ADX_MIN = 15;
const BASE_CONTEXT_PSAR_COOLDOWN_BARS = 1;

const baseContextEmaKey = (period: number) => String(period);

type IndicatorNextProfileKey =
  | 'pushMs'
  | 'btcMs'
  | 'coreMs'
  | 'baseContextStateMs'
  | 'structureMs'
  | 'correlationMs'
  | 'spreadMs'
  | 'windowStatsMs'
  | 'pluginMs'
  | 'historyMs'
  | 'resultMs'
  | 'maMs'
  | 'atrMs'
  | 'atrPctMs'
  | 'bbMs'
  | 'obvMs'
  | 'macdMs'
  | 'rsiMs'
  | 'adxMs'
  | 'baseContextMaMs'
  | 'baseContextPsarMs';

type IndicatorNextProfileStats = Record<IndicatorNextProfileKey, number> & {
  calls: number;
  totalMs: number;
  runtimeOnlyCalls: number;
  nullReturns: number;
};

const processLike = (
  globalThis as {
    process?: {
      env?: Record<string, string | undefined>;
      once?: (event: string, listener: () => void) => void;
    };
  }
).process;
const INDICATOR_NEXT_PROFILE =
  processLike?.env?.TRADEJS_INDICATOR_NEXT_PROFILE === '1';
const indicatorNextProfileStats: IndicatorNextProfileStats = {
  calls: 0,
  totalMs: 0,
  runtimeOnlyCalls: 0,
  nullReturns: 0,
  pushMs: 0,
  btcMs: 0,
  coreMs: 0,
  baseContextStateMs: 0,
  structureMs: 0,
  correlationMs: 0,
  spreadMs: 0,
  windowStatsMs: 0,
  pluginMs: 0,
  historyMs: 0,
  resultMs: 0,
  maMs: 0,
  atrMs: 0,
  atrPctMs: 0,
  bbMs: 0,
  obvMs: 0,
  macdMs: 0,
  rsiMs: 0,
  adxMs: 0,
  baseContextMaMs: 0,
  baseContextPsarMs: 0,
};

const indicatorNextProfileNow = () =>
  globalThis.performance?.now?.() ?? Date.now();

if (INDICATOR_NEXT_PROFILE) {
  processLike?.once?.('exit', () => {
    const round = (value: number) => Number(value.toFixed(2));
    const stats = indicatorNextProfileStats;
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          indicatorNextProfile: {
            calls: stats.calls,
            runtimeOnlyCalls: stats.runtimeOnlyCalls,
            nullReturns: stats.nullReturns,
            totalMs: round(stats.totalMs),
            avgUs:
              stats.calls > 0
                ? round((stats.totalMs * 1_000) / stats.calls)
                : null,
            sections: {
              pushMs: round(stats.pushMs),
              btcMs: round(stats.btcMs),
              coreMs: round(stats.coreMs),
              baseContextStateMs: round(stats.baseContextStateMs),
              structureMs: round(stats.structureMs),
              correlationMs: round(stats.correlationMs),
              spreadMs: round(stats.spreadMs),
              windowStatsMs: round(stats.windowStatsMs),
              pluginMs: round(stats.pluginMs),
              historyMs: round(stats.historyMs),
              resultMs: round(stats.resultMs),
              maMs: round(stats.maMs),
              atrMs: round(stats.atrMs),
              atrPctMs: round(stats.atrPctMs),
              bbMs: round(stats.bbMs),
              obvMs: round(stats.obvMs),
              macdMs: round(stats.macdMs),
              rsiMs: round(stats.rsiMs),
              adxMs: round(stats.adxMs),
              baseContextMaMs: round(stats.baseContextMaMs),
              baseContextPsarMs: round(stats.baseContextPsarMs),
            },
          },
        },
        null,
        2,
      ),
    );
  });
}

const deriveSmaValue = (
  state: SerializableSmaState | undefined,
): number | null =>
  state && state.values.length >= state.period
    ? state.sum / state.period
    : null;

type TrendlineIndicatorHistoryPush = (
  key: string,
  value: number | null | undefined,
) => void;

type IndicatorRuntimeState = {
  maFast: SerializableSmaState;
  maMedium: SerializableSmaState;
  maSlow: SerializableSmaState;
  atr: SerializableAtrState;
  atrPctShort: SerializableSmaState;
  atrPctLong: SerializableSmaState;
  bb: SerializableBollingerState;
  obv: SerializableObvState;
  smaObv: SerializableSmaState;
  macd: SerializableMacdState;
  rsi: SerializableRsiState;
  adx: SerializableAdxState;
  baseContextHl2Ema: Record<string, SerializableEmaState>;
  baseContextCloseEma34: SerializableEmaState;
  baseContextTypicalSma20: SerializableSmaState;
  baseContextAdaptivePreviousCenterline: number | null;
  baseContextPsar: SerializablePsarState;
  baseContextPsarEma50: SerializableEmaState;
  baseContextPsarFilterBarsSinceSignal: number | null;
  btcMaFast: SerializableSmaState;
  btcMaSlow: SerializableSmaState;
  spreadSmoother: SpreadSmootherState;
};

export const getRequiredControllerSeedWindow = (
  periods: Partial<IndicatorPeriods> = {},
): number => {
  const resolved = resolveIndicatorPeriods(periods);
  return Math.max(
    2,
    ML_BASE_CANDLES_WINDOW,
    CORRELATION_WINDOW,
    BASE_CONTEXT_RAW_HISTORY_WINDOW,
    ONE_DAY_CANDLE_WINDOW + 1,
    resolved.levelLookback + Math.max(0, resolved.levelDelay) + 1,
  );
};

export type IndicatorsControllerRuntimeState = {
  indicatorState: IndicatorRuntimeState;
  indicatorHistory: Record<string, NumericHistoryBuffer>;
  btcRuntimeHistory: Record<string, NumericHistoryBuffer>;
  latestIndicatorValues: Record<string, number>;
  rawCoinCandles: Candle[];
  rawBtcCandles: Candle[];
  rawEthCandles?: Candle[];
  coinResampledCandles: {
    h1: Candle[];
    h4: Candle[];
    d1: Candle[];
  };
  btcResampledCandles: {
    h1: Candle[];
    h4: Candle[];
    d1: Candle[];
  };
  ethResampledCandles?: {
    h1: Candle[];
    h4: Candle[];
    d1: Candle[];
  };
  closeStreaks: CloseStreakRuntimeState;
  breakoutState: BreakoutRuntimeState;
  btcCloses: number[];
  btcBinanceCursor: number;
  btcCoinbaseCursor: number;
};

export type IndicatorsControllerCheckpointState = Pick<
  IndicatorsControllerRuntimeState,
  | 'indicatorState'
  | 'rawCoinCandles'
  | 'rawBtcCandles'
  | 'rawEthCandles'
  | 'coinResampledCandles'
  | 'btcResampledCandles'
  | 'ethResampledCandles'
  | 'closeStreaks'
  | 'breakoutState'
  | 'btcCloses'
  | 'btcBinanceCursor'
  | 'btcCoinbaseCursor'
> &
  Partial<
    Pick<
      IndicatorsControllerRuntimeState,
      'indicatorHistory' | 'btcRuntimeHistory' | 'latestIndicatorValues'
    >
  >;

type TrendlineIndicators = {
  maFast: IndicatorValue;
  maMedium: IndicatorValue;
  maSlow: IndicatorValue;
  atr: IndicatorValue;
  atrPct: IndicatorValue;
  bbUpper: IndicatorValue;
  bbMiddle: IndicatorValue;
  bbLower: IndicatorValue;
  obv: IndicatorValue;
  smaObv: IndicatorValue;
  macd: IndicatorValue;
  macdSignal: IndicatorValue;
  macdHistogram: IndicatorValue;
  price24hPcnt: IndicatorValue;
  price1hPcnt: IndicatorValue;
  highPrice1h: IndicatorValue;
  lowPrice1h: IndicatorValue;
  volume1h: IndicatorValue;
  highPrice24h: IndicatorValue;
  lowPrice24h: IndicatorValue;
  volume24h: IndicatorValue;
  highLevel: IndicatorValue;
  lowLevel: IndicatorValue;
  prevClose: IndicatorValue;
  correlation: IndicatorValue;
  spread: IndicatorValue;
};

type CreateIndicatorsOptions = {
  includeMlPayload?: boolean;
  runtimeOnly?: boolean;
  ethData?: Candle[];
  btcBinanceData?: Candle[];
  btcCoinbaseData?: Candle[];
  pluginRegistryScope?: string;
  initialRuntimeState?:
    | IndicatorsControllerRuntimeState
    | IndicatorsControllerCheckpointState;
};

export const COMPACT_INDICATORS_SNAPSHOT_SYMBOL = Symbol.for(
  'tradejs.indicators.compactSnapshot',
);
export const COMPACT_INDICATORS_SNAPSHOT_KEY =
  '__tradejsCompactIndicatorsSnapshot';

const cloneHistorySnapshot = (
  record: Record<string, number[] | Candle[]>,
): Record<string, number[] | Candle[]> =>
  Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? value.map((item) =>
            item && typeof item === 'object'
              ? ({ ...(item as Candle) } as Candle)
              : item,
          )
        : value,
    ]),
  ) as Record<string, number[] | Candle[]>;

export interface IndicatorPeriods {
  maFast: number;
  maMedium: number;
  maSlow: number;
  obvSma: number;
  atr: number;
  atrPctShort: number;
  atrPctLong: number;
  bb: number;
  bbStd: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  levelLookback: number;
  levelDelay: number;
}

export const applyIndicatorsToHistory = (
  indicators: TrendlineIndicators,
  pushIndicator: TrendlineIndicatorHistoryPush,
) => {
  pushIndicator('maFast', indicators.maFast);
  pushIndicator('maMedium', indicators.maMedium);
  pushIndicator('maSlow', indicators.maSlow);
  pushIndicator('atr', indicators.atr);
  pushIndicator('atrPct', indicators.atrPct);
  pushIndicator('bbUpper', indicators.bbUpper);
  pushIndicator('bbMiddle', indicators.bbMiddle);
  pushIndicator('bbLower', indicators.bbLower);
  pushIndicator('obv', indicators.obv);
  pushIndicator('smaObv', indicators.smaObv);
  pushIndicator('macd', indicators.macd);
  pushIndicator('macdSignal', indicators.macdSignal);
  pushIndicator('macdHistogram', indicators.macdHistogram);
  pushIndicator('price24hPcnt', indicators.price24hPcnt ?? undefined);
  pushIndicator('price1hPcnt', indicators.price1hPcnt ?? undefined);
  pushIndicator('highPrice1h', indicators.highPrice1h ?? undefined);
  pushIndicator('lowPrice1h', indicators.lowPrice1h ?? undefined);
  pushIndicator('volume1h', indicators.volume1h ?? undefined);
  pushIndicator('highPrice24h', indicators.highPrice24h ?? undefined);
  pushIndicator('lowPrice24h', indicators.lowPrice24h ?? undefined);
  pushIndicator('volume24h', indicators.volume24h ?? undefined);
  pushIndicator('highLevel', indicators.highLevel ?? undefined);
  pushIndicator('lowLevel', indicators.lowLevel ?? undefined);
  pushIndicator('prevClose', indicators.prevClose ?? undefined);
  pushIndicator('correlation', indicators.correlation ?? undefined);
  pushIndicator('spread', indicators.spread ?? undefined);
};

const BASE_HISTORY_KEYS = [
  'maFast',
  'maMedium',
  'maSlow',
  'atr',
  'atrPct',
  'bbUpper',
  'bbMiddle',
  'bbLower',
  'obv',
  'smaObv',
  'macd',
  'macdSignal',
  'macdHistogram',
  'price24hPcnt',
  'price1hPcnt',
  'highPrice1h',
  'lowPrice1h',
  'volume1h',
  'highPrice24h',
  'lowPrice24h',
  'volume24h',
  'highLevel',
  'lowLevel',
  'prevClose',
  'correlation',
  'spread',
] as const;

const TIMEFRAME_SUFFIXES = ['1h', '4h', '1d'] as const;
const CANDLE_SERIES_KEYS = [
  'candles15m',
  'candles1h',
  'candles4h',
  'candles1d',
  'btcCandles15m',
  'btcCandles1h',
  'btcCandles4h',
  'btcCandles1d',
] as const;
const BTC_RUNTIME_KEYS = ['btcMaFast', 'btcMaSlow'] as const;
const prefixStrategySnapshotKey = (key: string, sourcePrefix = '') => {
  if (!sourcePrefix) return key;
  return `${sourcePrefix}${key[0].toUpperCase()}${key.slice(1)}`;
};
const COIN_TIMEFRAME_KEYS = BASE_HISTORY_KEYS.flatMap((key) =>
  TIMEFRAME_SUFFIXES.map((suffix) => `${key}${suffix}`),
);
const BTC_TIMEFRAME_KEYS = BASE_HISTORY_KEYS.flatMap((key) => [
  prefixStrategySnapshotKey(key, 'btc'),
  ...TIMEFRAME_SUFFIXES.map((suffix) =>
    prefixStrategySnapshotKey(`${key}${suffix}`, 'btc'),
  ),
]);
const STRATEGY_SNAPSHOT_LAZY_KEYS = new Set<string>([
  ...CANDLE_SERIES_KEYS,
  ...COIN_TIMEFRAME_KEYS,
  ...BTC_TIMEFRAME_KEYS.filter(
    (key) =>
      !BTC_RUNTIME_KEYS.includes(key as (typeof BTC_RUNTIME_KEYS)[number]),
  ),
]);

const buildLatestBaseResult = ({
  latestIndicatorValues,
  prevClose,
}: {
  latestIndicatorValues: Record<string, number>;
  prevClose: number | null;
}) => ({
  maFast: getLatestHistoryNumber(latestIndicatorValues, 'maFast'),
  maMedium: getLatestHistoryNumber(latestIndicatorValues, 'maMedium'),
  maSlow: getLatestHistoryNumber(latestIndicatorValues, 'maSlow'),
  atr: getLatestHistoryNumber(latestIndicatorValues, 'atr'),
  atrPct: getLatestHistoryNumber(latestIndicatorValues, 'atrPct'),
  bbUpper: getLatestHistoryNumber(latestIndicatorValues, 'bbUpper'),
  bbMiddle: getLatestHistoryNumber(latestIndicatorValues, 'bbMiddle'),
  bbLower: getLatestHistoryNumber(latestIndicatorValues, 'bbLower'),
  obv: getLatestHistoryNumber(latestIndicatorValues, 'obv'),
  smaObv: getLatestHistoryNumber(latestIndicatorValues, 'smaObv'),
  macd: getLatestHistoryNumber(latestIndicatorValues, 'macd'),
  macdSignal: getLatestHistoryNumber(latestIndicatorValues, 'macdSignal'),
  macdHistogram: getLatestHistoryNumber(latestIndicatorValues, 'macdHistogram'),
  price24hPcnt:
    getLatestHistoryNumber(latestIndicatorValues, 'price24hPcnt') ?? 0,
  price1hPcnt:
    getLatestHistoryNumber(latestIndicatorValues, 'price1hPcnt') ?? 0,
  highPrice1h: getLatestHistoryNumber(latestIndicatorValues, 'highPrice1h'),
  lowPrice1h: getLatestHistoryNumber(latestIndicatorValues, 'lowPrice1h'),
  volume1h: getLatestHistoryNumber(latestIndicatorValues, 'volume1h'),
  highPrice24h: getLatestHistoryNumber(latestIndicatorValues, 'highPrice24h'),
  lowPrice24h: getLatestHistoryNumber(latestIndicatorValues, 'lowPrice24h'),
  volume24h: getLatestHistoryNumber(latestIndicatorValues, 'volume24h'),
  highLevel: getLatestHistoryNumber(latestIndicatorValues, 'highLevel'),
  lowLevel: getLatestHistoryNumber(latestIndicatorValues, 'lowLevel'),
  prevClose,
  correlation:
    getLatestHistoryNumber(latestIndicatorValues, 'correlation') ?? 0,
  spread: getLatestHistoryNumber(latestIndicatorValues, 'spread'),
});

export const createIndicators = (
  data: Candle[],
  btcData: Candle[] = [],
  options: CreateIndicatorsOptions & {
    periods?: Partial<IndicatorPeriods>;
  } = {},
) => {
  const runtimeOnly = options.runtimeOnly === true;
  const indicatorPluginEntries = runtimeOnly
    ? []
    : getRegisteredIndicatorEntries(options.pluginRegistryScope);
  const includeMlPayload = options.includeMlPayload !== false;
  const indicatorPeriods = resolveIndicatorPeriods(options.periods);
  const controllerStateCandleWindow =
    getRequiredControllerSeedWindow(indicatorPeriods);
  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const volumes: number[] = [];
  const timestamps: number[] = [];
  const btcCloses: number[] = [];
  const candlesHistory: Candle[] = [];
  const btcCandlesHistory: Candle[] = [];
  const ethCandlesHistory: Candle[] = [];
  const ethData = (options.ethData ?? []).map(toMlCandle);
  let ethCandlesByTimestamp: Map<number, Candle> | null = null;
  const resolveEthCandle = (candle: Candle, index: number) => {
    const alignedEthCandle = ethData[index];
    if (alignedEthCandle?.timestamp === candle.timestamp) {
      return alignedEthCandle;
    }

    ethCandlesByTimestamp ??= new Map(
      ethData.map((item) => [item.timestamp, item]),
    );
    return ethCandlesByTimestamp.get(candle.timestamp);
  };
  let btcBinanceCandles = (options.btcBinanceData ?? []).map(toMlCandle);
  let btcCoinbaseCandles = (options.btcCoinbaseData ?? []).map(toMlCandle);
  const restoredState = options.initialRuntimeState;
  const spreadSmoother = createSerializableSpreadSmoother(
    undefined,
    restoredState?.indicatorState.spreadSmoother,
  );
  let btcBinanceCursor = restoredState?.btcBinanceCursor ?? 0;
  let btcCoinbaseCursor = restoredState?.btcCoinbaseCursor ?? 0;
  const replaceReferenceData = ({
    btcBinanceData,
    btcCoinbaseData,
  }: {
    btcBinanceData?: Candle[];
    btcCoinbaseData?: Candle[];
  }) => {
    const binanceCursorTimestamp =
      btcBinanceCandles[btcBinanceCursor]?.timestamp ?? null;
    const coinbaseCursorTimestamp =
      btcCoinbaseCandles[btcCoinbaseCursor]?.timestamp ?? null;
    btcBinanceCandles = (btcBinanceData ?? []).map(toMlCandle);
    btcCoinbaseCandles = (btcCoinbaseData ?? []).map(toMlCandle);
    const resolveCursor = (candles: Candle[], timestamp: number | null) => {
      if (candles.length === 0 || timestamp == null) {
        return 0;
      }
      let low = 0;
      let high = candles.length - 1;
      let result = 0;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (candles[middle].timestamp <= timestamp) {
          result = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      return result;
    };
    btcBinanceCursor = resolveCursor(btcBinanceCandles, binanceCursorTimestamp);
    btcCoinbaseCursor = resolveCursor(
      btcCoinbaseCandles,
      coinbaseCursorTimestamp,
    );
  };
  const createRollingCandleWindow = (windowSize: number) => {
    const buffer = new Array<Candle | undefined>(Math.max(0, windowSize));
    const snapshot: Candle[] = [];
    let startIndex = 0;
    let size = 0;

    return {
      push: (candle: Candle) => {
        if (windowSize <= 0) {
          return;
        }

        if (size < windowSize) {
          buffer[(startIndex + size) % windowSize] = candle;
          size += 1;
          return;
        }

        buffer[startIndex] = candle;
        startIndex = (startIndex + 1) % windowSize;
      },
      snapshot: (): Candle[] => {
        snapshot.length = size;
        for (let index = 0; index < size; index += 1) {
          snapshot[index] = buffer[(startIndex + index) % windowSize]!;
        }
        return snapshot;
      },
      size: () => size,
    };
  };
  const correlationCoinWindow = createRollingCandleWindow(CORRELATION_WINDOW);
  const correlationBtcWindow = createRollingCandleWindow(CORRELATION_WINDOW);
  const coin1hCache = createIncrementalResampleCache(60);
  const coin4hCache = createIncrementalResampleCache(240);
  const coin1dCache = createIncrementalResampleCache(1440);
  const btc1hCache = createIncrementalResampleCache(60);
  const btc4hCache = createIncrementalResampleCache(240);
  const btc1dCache = createIncrementalResampleCache(1440);
  const eth1hCache = createIncrementalResampleCache(60);
  const eth4hCache = createIncrementalResampleCache(240);
  const eth1dCache = createIncrementalResampleCache(1440);

  const obv = createSerializableObv(restoredState?.indicatorState.obv);
  const smaObv = createSerializableSma(
    indicatorPeriods.obvSma,
    restoredState?.indicatorState.smaObv,
  );
  const ma14 = createSerializableSma(
    indicatorPeriods.maFast,
    restoredState?.indicatorState.maFast,
  );
  const ma49 = createSerializableSma(
    indicatorPeriods.maMedium,
    restoredState?.indicatorState.maMedium,
  );
  const ma50 = createSerializableSma(
    indicatorPeriods.maSlow,
    restoredState?.indicatorState.maSlow,
  );
  const atr = createSerializableAtr(
    indicatorPeriods.atr,
    restoredState?.indicatorState.atr,
  );
  const atrPctShort = createSerializableSma(
    indicatorPeriods.atrPctShort,
    restoredState?.indicatorState.atrPctShort,
  );
  const atrPctLong = createSerializableSma(
    indicatorPeriods.atrPctLong,
    restoredState?.indicatorState.atrPctLong,
  );
  const bb = createSerializableBollinger(
    indicatorPeriods.bb,
    indicatorPeriods.bbStd,
    restoredState?.indicatorState.bb,
  );
  const macd = createSerializableMacd(
    {
      fastPeriod: indicatorPeriods.macdFast,
      slowPeriod: indicatorPeriods.macdSlow,
      signalPeriod: indicatorPeriods.macdSignal,
      simpleOscillator: false,
      simpleSignal: false,
    },
    restoredState?.indicatorState.macd,
  );
  const rsiIndicator = createSerializableRsi(
    14,
    restoredState?.indicatorState.rsi,
  );
  const adxIndicator = createSerializableAdx(
    14,
    restoredState?.indicatorState.adx,
  );
  const restoredBaseContextHl2Ema =
    restoredState?.indicatorState.baseContextHl2Ema ?? {};
  const baseContextHl2EmaPeriods = [
    ...new Set(
      BASE_CONTEXT_MA_LAYER_PERIODS.flatMap(([fast, slow]) => [fast, slow]),
    ),
  ];
  const baseContextHl2Ema = Object.fromEntries(
    baseContextHl2EmaPeriods.map((period) => [
      baseContextEmaKey(period),
      createSerializableEma(
        period,
        restoredBaseContextHl2Ema[baseContextEmaKey(period)],
      ),
    ]),
  );
  const baseContextCloseEma34 = createSerializableEma(
    BASE_CONTEXT_CONTEXT_MA_PERIOD,
    restoredState?.indicatorState.baseContextCloseEma34,
  );
  const baseContextTypicalSma20 = createSerializableSma(
    BASE_CONTEXT_ADAPTIVE_CHANNEL_PERIOD,
    restoredState?.indicatorState.baseContextTypicalSma20,
  );
  const baseContextPsar = createSerializablePsar(
    {
      start: BASE_CONTEXT_PSAR_START,
      increment: BASE_CONTEXT_PSAR_INCREMENT,
      maximum: BASE_CONTEXT_PSAR_MAXIMUM,
    },
    restoredState?.indicatorState.baseContextPsar,
  );
  const baseContextPsarEma50 = createSerializableEma(
    BASE_CONTEXT_PSAR_EMA_PERIOD,
    restoredState?.indicatorState.baseContextPsarEma50,
  );
  const btcMaFast = createSerializableSma(
    indicatorPeriods.maFast,
    restoredState?.indicatorState.btcMaFast,
  );
  const btcMaSlow = createSerializableSma(
    indicatorPeriods.maSlow,
    restoredState?.indicatorState.btcMaSlow,
  );

  const indicatorHistory: Record<string, NumericHistoryBuffer> =
    Object.fromEntries(
      Object.entries(restoredState?.indicatorHistory ?? {}).map(
        ([key, buffer]) => [key, cloneNumericHistoryBuffer(buffer)],
      ),
    );
  const btcRuntimeHistory: Record<
    (typeof BTC_RUNTIME_KEYS)[number],
    NumericHistoryBuffer
  > = {
    btcMaFast: cloneNumericHistoryBuffer(
      restoredState?.btcRuntimeHistory?.btcMaFast ??
        createNumericHistoryBuffer(),
    ),
    btcMaSlow: cloneNumericHistoryBuffer(
      restoredState?.btcRuntimeHistory?.btcMaSlow ??
        createNumericHistoryBuffer(),
    ),
  };
  const latestIndicatorValues: Record<string, number> = {
    ...(restoredState?.latestIndicatorValues ?? {}),
  };
  let latestRsiValue: number | null = null;
  let latestAdxValue: SerializableAdxOutput | null = null;
  const latestBaseContextHl2EmaValues: Record<string, number | null> =
    Object.fromEntries(
      baseContextHl2EmaPeriods.map((period) => [
        baseContextEmaKey(period),
        restoredBaseContextHl2Ema[baseContextEmaKey(period)]?.current ?? null,
      ]),
    );
  let latestBaseContextCloseEma34 =
    restoredState?.indicatorState.baseContextCloseEma34?.current ?? null;
  let latestBaseContextAdaptiveCenterline = deriveSmaValue(
    restoredState?.indicatorState.baseContextTypicalSma20,
  );
  let latestBaseContextAdaptivePreviousCenterline =
    restoredState?.indicatorState.baseContextAdaptivePreviousCenterline ?? null;
  let latestBaseContextPsarValue =
    restoredState?.indicatorState.baseContextPsar?.sar ?? null;
  let latestBaseContextPsarEma50 =
    restoredState?.indicatorState.baseContextPsarEma50?.current ?? null;
  let baseContextPsarFilterBarsSinceSignal =
    restoredState?.indicatorState.baseContextPsarFilterBarsSinceSignal ?? null;
  let latestBaseContextPsar: BaseContextPsarInput = {
    value: latestBaseContextPsarValue,
    direction:
      latestBaseContextPsarValue == null
        ? 'unknown'
        : candlesHistory[candlesHistory.length - 1]?.close >
            latestBaseContextPsarValue
          ? 'bull'
          : 'bear',
    rawBuySignal: null,
    rawSellSignal: null,
    buySignal: null,
    sellSignal: null,
    emaFilter: latestBaseContextPsarEma50,
    trendLongOk: null,
    trendShortOk: null,
    adxOk: null,
    candleLongOk: null,
    candleShortOk: null,
    cooldownOk: null,
    barsSinceSignal: baseContextPsarFilterBarsSinceSignal,
  };
  const closeStreaks: CloseStreakRuntimeState = {
    up: restoredState?.closeStreaks?.up ?? 0,
    down: restoredState?.closeStreaks?.down ?? 0,
  };
  const breakoutState: BreakoutRuntimeState = {
    side: restoredState?.breakoutState?.side ?? null,
    barsSinceBreakout: restoredState?.breakoutState?.barsSinceBreakout ?? null,
  };
  const indicatorPluginErrorShown = new Set<string>();
  let cachedBaseHistoryResult: Record<string, number[]> | null = null;
  let cachedBtcRuntimeHistoryResult: Record<string, number[]> | null = null;
  let cachedHistoryResult: IndicatorsHistorySnapshot | null = null;
  let isBaseHistoryDirty = true;
  let isBtcRuntimeHistoryDirty = true;
  let isHistoryResultDirty = true;

  restoredState?.rawCoinCandles.forEach((candle) => {
    const normalized = toMlCandle(candle);
    candlesHistory.push(normalized);
    closes.push(normalized.close);
    highs.push(normalized.high);
    lows.push(normalized.low);
    volumes.push(normalized.volume);
    timestamps.push(normalized.timestamp);
  });
  restoredState?.rawBtcCandles.forEach((candle) => {
    const normalized = toMlCandle(candle);
    btcCandlesHistory.push(normalized);
  });
  restoredState?.rawEthCandles?.forEach((candle) => {
    const normalized = toMlCandle(candle);
    ethCandlesHistory.push(normalized);
  });
  restoredState?.btcCloses.forEach((value) => {
    btcCloses.push(value);
  });
  coin1hCache.restore(restoredState?.coinResampledCandles.h1 ?? []);
  coin4hCache.restore(restoredState?.coinResampledCandles.h4 ?? []);
  coin1dCache.restore(restoredState?.coinResampledCandles.d1 ?? []);
  btc1hCache.restore(restoredState?.btcResampledCandles.h1 ?? []);
  btc4hCache.restore(restoredState?.btcResampledCandles.h4 ?? []);
  btc1dCache.restore(restoredState?.btcResampledCandles.d1 ?? []);
  eth1hCache.restore(restoredState?.ethResampledCandles?.h1 ?? []);
  eth4hCache.restore(restoredState?.ethResampledCandles?.h4 ?? []);
  eth1dCache.restore(restoredState?.ethResampledCandles?.d1 ?? []);

  const buildBaseContextMaLayers = (): BaseContextMaLayerInput[] =>
    BASE_CONTEXT_MA_LAYER_PERIODS.map(([fastPeriod, slowPeriod]) => ({
      fastPeriod,
      slowPeriod,
      fast:
        latestBaseContextHl2EmaValues[baseContextEmaKey(fastPeriod)] ?? null,
      slow:
        latestBaseContextHl2EmaValues[baseContextEmaKey(slowPeriod)] ?? null,
    }));

  const buildBaseContextContextMa = (): BaseContextContextMaInput => ({
    baseline: latestBaseContextCloseEma34,
  });

  const buildBaseContextAdaptiveChannel =
    (): BaseContextAdaptiveChannelInput => ({
      centerline: latestBaseContextAdaptiveCenterline,
      previousCenterline: latestBaseContextAdaptivePreviousCenterline,
    });

  const getBaseHistoryResult = (): Record<string, number[]> => {
    if (isBaseHistoryDirty || !cachedBaseHistoryResult) {
      cachedBaseHistoryResult = Object.fromEntries(
        Object.entries(indicatorHistory).map(([key, buffer]) => [
          key,
          materializeNumericHistory(buffer),
        ]),
      ) as Record<string, number[]>;
      isBaseHistoryDirty = false;
    }

    return cachedBaseHistoryResult;
  };

  const getBtcRuntimeHistoryResult = (): Record<string, number[]> => {
    if (isBtcRuntimeHistoryDirty || !cachedBtcRuntimeHistoryResult) {
      cachedBtcRuntimeHistoryResult = Object.fromEntries(
        Object.entries(btcRuntimeHistory).map(([key, buffer]) => [
          key,
          materializeNumericHistory(buffer),
        ]),
      ) as Record<string, number[]>;
      isBtcRuntimeHistoryDirty = false;
    }

    return cachedBtcRuntimeHistoryResult;
  };

  const getHistoryResult = (): IndicatorsHistorySnapshot => {
    if (isHistoryResultDirty || !cachedHistoryResult) {
      const baseHistory = cloneArrayValues(getBaseHistoryResult());
      cachedHistoryResult = !includeMlPayload
        ? (baseHistory as IndicatorsHistorySnapshot)
        : ({
            ...baseHistory,
            ...buildMlTimeframeIndicators(candlesHistory, indicatorPeriods),
            ...buildMlCandleIndicators(candlesHistory, btcCandlesHistory),
            ...buildIndicatorSeriesByTimeframes(
              btcCandlesHistory,
              indicatorPeriods,
              'btc',
            ),
          } as IndicatorsHistorySnapshot);
      isHistoryResultDirty = false;
    }

    return cachedHistoryResult;
  };

  const pushIndicator = (key: string, value: number | null | undefined) => {
    if (value == null) {
      return;
    }
    if (!indicatorHistory[key]) {
      indicatorHistory[key] = createNumericHistoryBuffer();
    }
    latestIndicatorValues[key] = value;
    appendNumericHistory(indicatorHistory[key], value);
    isBaseHistoryDirty = true;
    isHistoryResultDirty = true;
  };

  const resolveCloseAtOrBefore = (
    candles: Candle[],
    cursor: number,
    targetTs: number,
  ) => {
    let idx = cursor;
    while (idx + 1 < candles.length && candles[idx + 1].timestamp <= targetTs) {
      idx += 1;
    }
    const close =
      idx < candles.length && candles[idx].timestamp <= targetTs
        ? candles[idx].close
        : null;
    return { close, cursor: idx };
  };

  const levelHighDeque: number[] = [];
  const levelLowDeque: number[] = [];

  const pushLevelHighIndex = (index: number) => {
    while (
      levelHighDeque.length > 0 &&
      highs[levelHighDeque[levelHighDeque.length - 1]] <= highs[index]
    ) {
      levelHighDeque.pop();
    }
    levelHighDeque.push(index);
  };

  const pushLevelLowIndex = (index: number) => {
    while (
      levelLowDeque.length > 0 &&
      lows[levelLowDeque[levelLowDeque.length - 1]] >= lows[index]
    ) {
      levelLowDeque.pop();
    }
    levelLowDeque.push(index);
  };

  const updateLevelWindow = (currentIndex: number) => {
    const enteringIndex = currentIndex - indicatorPeriods.levelDelay;
    if (enteringIndex >= 0) {
      pushLevelHighIndex(enteringIndex);
      pushLevelLowIndex(enteringIndex);
    }

    const validStartIndex =
      currentIndex -
      indicatorPeriods.levelDelay -
      indicatorPeriods.levelLookback +
      1;

    while (levelHighDeque.length > 0 && levelHighDeque[0] < validStartIndex) {
      levelHighDeque.shift();
    }

    while (levelLowDeque.length > 0 && levelLowDeque[0] < validStartIndex) {
      levelLowDeque.shift();
    }
  };

  const createRollingWindowTracker = (windowMs: number) => {
    let startIdx = 0;
    let volumeSum = 0;
    const highDeque: number[] = [];
    const lowDeque: number[] = [];

    return {
      push: (currentIndex: number, currentTimestamp: number) => {
        volumeSum += volumes[currentIndex] ?? 0;

        while (
          highDeque.length > 0 &&
          highs[highDeque[highDeque.length - 1]] <= highs[currentIndex]
        ) {
          highDeque.pop();
        }
        highDeque.push(currentIndex);

        while (
          lowDeque.length > 0 &&
          lows[lowDeque[lowDeque.length - 1]] >= lows[currentIndex]
        ) {
          lowDeque.pop();
        }
        lowDeque.push(currentIndex);

        const windowStart = currentTimestamp - windowMs;
        while (
          startIdx < timestamps.length &&
          timestamps[startIdx] < windowStart
        ) {
          if (highDeque[0] === startIdx) {
            highDeque.shift();
          }
          if (lowDeque[0] === startIdx) {
            lowDeque.shift();
          }
          volumeSum -= volumes[startIdx] ?? 0;
          startIdx += 1;
        }

        if (timestamps.length === 0 || timestamps[0] > windowStart) {
          return {
            startIdx,
            high: null,
            low: null,
            volume: null,
            startClose: null,
            hasFullWindow: false,
          };
        }

        return {
          startIdx,
          high: highDeque.length > 0 ? highs[highDeque[0]] : null,
          low: lowDeque.length > 0 ? lows[lowDeque[0]] : null,
          volume: volumeSum,
          startClose: closes[startIdx] ?? null,
          hasFullWindow: true,
        };
      },
    };
  };

  const createNearestStartCloseTracker = (windowMs: number) => {
    let lowerBoundIdx = 0;

    return {
      resolve: (currentTimestamp: number) => {
        if (timestamps.length === 0) {
          return { startClose: null, startIdx: 0 };
        }

        const windowStart = currentTimestamp - windowMs;
        while (
          lowerBoundIdx < timestamps.length &&
          timestamps[lowerBoundIdx] < windowStart
        ) {
          lowerBoundIdx += 1;
        }

        const idx = lowerBoundIdx;
        if (idx <= 0) {
          return { startClose: closes[0], startIdx: 0 };
        }
        if (idx >= timestamps.length) {
          const lastIdx = timestamps.length - 1;
          return { startClose: closes[lastIdx], startIdx: lastIdx };
        }

        const prevIdx = idx - 1;
        const currentIdx = timestamps.length - 1;
        // For coarse timeframes (e.g. 4h/1d), prevent anchoring to the current bar
        // when the target window is shorter than a single candle.
        if (idx === currentIdx && timestamps[idx] > windowStart) {
          return { startClose: closes[prevIdx], startIdx: prevIdx };
        }

        const prevDiff = windowStart - timestamps[prevIdx];
        const nextDiff = timestamps[idx] - windowStart;
        const chosenIdx = prevDiff <= nextDiff ? prevIdx : idx;

        return { startClose: closes[chosenIdx], startIdx: chosenIdx };
      },
    };
  };

  const window1hTracker = createRollingWindowTracker(ONE_HOUR_MS);
  const window24hTracker = createRollingWindowTracker(ONE_DAY_MS);
  const price1hStartTracker = createNearestStartCloseTracker(ONE_HOUR_MS);
  const price24hStartTracker = createNearestStartCloseTracker(ONE_DAY_MS);

  candlesHistory.forEach((candle, index) => {
    if (!runtimeOnly) {
      correlationCoinWindow.push(candle);
    }
    if (indicatorPeriods.levelLookback > 0) {
      updateLevelWindow(index);
    }
    if (!runtimeOnly) {
      window1hTracker.push(index, candle.timestamp);
      window24hTracker.push(index, candle.timestamp);
      price1hStartTracker.resolve(candle.timestamp);
      price24hStartTracker.resolve(candle.timestamp);
    }
  });
  if (!runtimeOnly) {
    btcCandlesHistory.forEach((candle) => {
      correlationBtcWindow.push(candle);
    });
  }

  let latestSnapshot: IndicatorSnapshot | null = null;

  const next = (
    candle: Candle,
    btcCandle?: Candle,
    ethCandle?: Candle,
  ): IndicatorSnapshot | null => {
    const profileEnabled = INDICATOR_NEXT_PROFILE;
    const profileStartedAt = profileEnabled ? indicatorNextProfileNow() : 0;
    let profileLastAt = profileStartedAt;
    const recordProfile = (key: IndicatorNextProfileKey) => {
      if (!profileEnabled) return;
      const now = indicatorNextProfileNow();
      indicatorNextProfileStats[key] += now - profileLastAt;
      profileLastAt = now;
    };
    const recordElapsedProfile = (
      key: IndicatorNextProfileKey,
      startedAt: number,
    ) => {
      if (!profileEnabled) return;
      indicatorNextProfileStats[key] += indicatorNextProfileNow() - startedAt;
    };
    const finishProfile = (returnedNull: boolean) => {
      if (!profileEnabled) return;
      const now = indicatorNextProfileNow();
      indicatorNextProfileStats.calls += 1;
      indicatorNextProfileStats.totalMs += now - profileStartedAt;
      if (runtimeOnly) {
        indicatorNextProfileStats.runtimeOnlyCalls += 1;
      }
      if (returnedNull) {
        indicatorNextProfileStats.nullReturns += 1;
      }
    };

    isHistoryResultDirty = true;
    candlesHistory.push(candle);
    coin1hCache.push(candle);
    coin4hCache.push(candle);
    coin1dCache.push(candle);
    if (!runtimeOnly) {
      correlationCoinWindow.push(candle);
    }
    recordProfile('pushMs');
    if (btcCandle) {
      btcCandlesHistory.push(btcCandle);
      btcCloses.push(btcCandle.close);
      btc1hCache.push(btcCandle);
      btc4hCache.push(btcCandle);
      btc1dCache.push(btcCandle);
      if (!runtimeOnly) {
        correlationBtcWindow.push(btcCandle);
      }

      const btcMaFastValue = btcMaFast.nextValue(btcCandle.close);
      const btcMaSlowValue = btcMaSlow.nextValue(btcCandle.close);

      if (btcMaFastValue != null) {
        appendNumericHistory(btcRuntimeHistory.btcMaFast, btcMaFastValue);
        latestIndicatorValues.btcMaFast = btcMaFastValue;
        isBtcRuntimeHistoryDirty = true;
      }

      if (btcMaSlowValue != null) {
        appendNumericHistory(btcRuntimeHistory.btcMaSlow, btcMaSlowValue);
        latestIndicatorValues.btcMaSlow = btcMaSlowValue;
        isBtcRuntimeHistoryDirty = true;
      }
    }
    recordProfile('btcMs');
    if (ethCandle) {
      ethCandlesHistory.push(ethCandle);
      eth1hCache.push(ethCandle);
      eth4hCache.push(ethCandle);
      eth1dCache.push(ethCandle);
    }

    closes.push(candle.close);
    highs.push(candle.high);
    lows.push(candle.low);
    volumes.push(candle.volume);
    timestamps.push(candle.timestamp);

    let sectionStartedAt = profileEnabled ? indicatorNextProfileNow() : 0;
    const ma14Value = ma14.nextValue(candle.close);
    const ma49Value = ma49.nextValue(candle.close);
    const ma50Value = ma50.nextValue(candle.close);
    recordElapsedProfile('maMs', sectionStartedAt);
    sectionStartedAt = profileEnabled ? indicatorNextProfileNow() : 0;
    const atrValue = atr.nextValue(candle);
    recordElapsedProfile('atrMs', sectionStartedAt);
    sectionStartedAt = profileEnabled ? indicatorNextProfileNow() : 0;
    const atrPctValue =
      atrValue != null && Number.isFinite(atrValue) && candle.close
        ? (atrValue / candle.close) * 100
        : null;
    const atrPctShortValue =
      atrPctValue == null ? null : atrPctShort.nextValue(atrPctValue);
    const atrPctLongValue =
      atrPctValue == null ? null : atrPctLong.nextValue(atrPctValue);
    const atrPctRatio =
      typeof atrPctShortValue === 'number' &&
      Number.isFinite(atrPctShortValue) &&
      typeof atrPctLongValue === 'number' &&
      Number.isFinite(atrPctLongValue) &&
      atrPctLongValue !== 0
        ? atrPctShortValue / atrPctLongValue
        : null;
    recordElapsedProfile('atrPctMs', sectionStartedAt);
    sectionStartedAt = profileEnabled ? indicatorNextProfileNow() : 0;
    const bbValue = bb.nextValue(candle.close);
    recordElapsedProfile('bbMs', sectionStartedAt);
    sectionStartedAt = profileEnabled ? indicatorNextProfileNow() : 0;
    const obvValue = obv.nextValue(candle);
    const smaObvValue = obvValue == null ? null : smaObv.nextValue(obvValue);
    recordElapsedProfile('obvMs', sectionStartedAt);
    sectionStartedAt = profileEnabled ? indicatorNextProfileNow() : 0;
    const macdValue = macd.nextValue(candle.close);
    recordElapsedProfile('macdMs', sectionStartedAt);
    sectionStartedAt = profileEnabled ? indicatorNextProfileNow() : 0;
    const rsiValue = rsiIndicator.nextValue(candle.close);
    recordElapsedProfile('rsiMs', sectionStartedAt);
    sectionStartedAt = profileEnabled ? indicatorNextProfileNow() : 0;
    const adxValue = adxIndicator.nextValue(candle);
    recordElapsedProfile('adxMs', sectionStartedAt);
    if (typeof rsiValue === 'number') {
      latestRsiValue = rsiValue;
    }
    if (adxValue) {
      latestAdxValue = adxValue;
    }
    recordProfile('coreMs');
    sectionStartedAt = profileEnabled ? indicatorNextProfileNow() : 0;
    const hl2Value = (candle.high + candle.low) / 2;
    for (const period of baseContextHl2EmaPeriods) {
      const key = baseContextEmaKey(period);
      const emaValue = baseContextHl2Ema[key]?.nextValue(hl2Value);
      latestBaseContextHl2EmaValues[key] =
        typeof emaValue === 'number' ? emaValue : null;
    }
    const closeEma34Value = baseContextCloseEma34.nextValue(candle.close);
    latestBaseContextCloseEma34 =
      typeof closeEma34Value === 'number' ? closeEma34Value : null;
    const previousAdaptiveCenterline = latestBaseContextAdaptiveCenterline;
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    const adaptiveCenterline = baseContextTypicalSma20.nextValue(typicalPrice);
    latestBaseContextAdaptiveCenterline =
      typeof adaptiveCenterline === 'number' ? adaptiveCenterline : null;
    latestBaseContextAdaptivePreviousCenterline =
      latestBaseContextAdaptiveCenterline == null
        ? null
        : previousAdaptiveCenterline;
    recordElapsedProfile('baseContextMaMs', sectionStartedAt);

    const currentTimestamp = candle.timestamp;
    const len = candlesHistory.length;
    const currentIndex = len - 1;
    const prevCandle = len > 1 ? candlesHistory[len - 2] : null;
    sectionStartedAt = profileEnabled ? indicatorNextProfileNow() : 0;
    const previousPsarValue = latestBaseContextPsarValue;
    const psarValue = baseContextPsar.nextValue(candle);
    latestBaseContextPsarValue =
      typeof psarValue === 'number' ? psarValue : latestBaseContextPsarValue;
    const psarEma50Value = baseContextPsarEma50.nextValue(candle.close);
    latestBaseContextPsarEma50 =
      typeof psarEma50Value === 'number' ? psarEma50Value : null;
    const psarReady =
      typeof psarValue === 'number' &&
      Number.isFinite(psarValue) &&
      previousPsarValue != null &&
      prevCandle != null;
    const psarDirection =
      typeof psarValue === 'number'
        ? candle.close > psarValue
          ? 'bull'
          : 'bear'
        : 'unknown';
    const psarRawBuySignal = psarReady
      ? prevCandle.close <= previousPsarValue && candle.close > psarValue
      : null;
    const psarRawSellSignal = psarReady
      ? prevCandle.close >= previousPsarValue && candle.close < psarValue
      : null;
    const psarTrendLongOk =
      latestBaseContextPsarEma50 == null
        ? null
        : candle.close > latestBaseContextPsarEma50;
    const psarTrendShortOk =
      latestBaseContextPsarEma50 == null
        ? null
        : candle.close < latestBaseContextPsarEma50;
    const psarAdxOk =
      latestAdxValue?.adx == null
        ? null
        : latestAdxValue.adx >= BASE_CONTEXT_PSAR_ADX_MIN;
    const psarCandleLongOk = candle.close > candle.open;
    const psarCandleShortOk = candle.close < candle.open;
    const psarCooldownOk =
      baseContextPsarFilterBarsSinceSignal == null
        ? true
        : baseContextPsarFilterBarsSinceSignal >
          BASE_CONTEXT_PSAR_COOLDOWN_BARS;
    const psarBuySignal =
      psarRawBuySignal == null
        ? null
        : psarRawBuySignal &&
          psarTrendLongOk === true &&
          psarAdxOk === true &&
          psarCooldownOk;
    const psarSellSignal =
      psarRawSellSignal == null
        ? null
        : psarRawSellSignal &&
          psarTrendShortOk === true &&
          psarAdxOk === true &&
          psarCooldownOk;
    if (psarBuySignal || psarSellSignal) {
      baseContextPsarFilterBarsSinceSignal = 0;
    } else if (baseContextPsarFilterBarsSinceSignal != null) {
      baseContextPsarFilterBarsSinceSignal += 1;
    }
    latestBaseContextPsar = {
      value: typeof psarValue === 'number' ? psarValue : null,
      direction: psarDirection,
      rawBuySignal: psarRawBuySignal,
      rawSellSignal: psarRawSellSignal,
      buySignal: psarBuySignal,
      sellSignal: psarSellSignal,
      emaFilter: latestBaseContextPsarEma50,
      trendLongOk: psarTrendLongOk,
      trendShortOk: psarTrendShortOk,
      adxOk: psarAdxOk,
      candleLongOk: psarCandleLongOk,
      candleShortOk: psarCandleShortOk,
      cooldownOk: psarCooldownOk,
      barsSinceSignal: baseContextPsarFilterBarsSinceSignal,
    };
    recordElapsedProfile('baseContextPsarMs', sectionStartedAt);
    recordProfile('baseContextStateMs');
    if (!prevCandle) {
      closeStreaks.up = 0;
      closeStreaks.down = 0;
    } else if (candle.close > prevCandle.close) {
      closeStreaks.up += 1;
      closeStreaks.down = 0;
    } else if (candle.close < prevCandle.close) {
      closeStreaks.down += 1;
      closeStreaks.up = 0;
    } else {
      closeStreaks.up = 0;
      closeStreaks.down = 0;
    }
    if (indicatorPeriods.levelLookback > 0) {
      updateLevelWindow(currentIndex);
    }
    recordProfile('structureMs');
    const correlation =
      !runtimeOnly && correlationBtcWindow.size() > 0
        ? calculateCoinBtcCorrelation(
            correlationCoinWindow.snapshot() as any,
            correlationBtcWindow.snapshot() as any,
          ).correlation ?? 0
        : 0;
    recordProfile('correlationMs');

    let spread: number | null = null;
    if (btcBinanceCandles.length > 0 && btcCoinbaseCandles.length > 0) {
      const binanceResolved = resolveCloseAtOrBefore(
        btcBinanceCandles,
        btcBinanceCursor,
        currentTimestamp,
      );
      const coinbaseResolved = resolveCloseAtOrBefore(
        btcCoinbaseCandles,
        btcCoinbaseCursor,
        currentTimestamp,
      );
      btcBinanceCursor = binanceResolved.cursor;
      btcCoinbaseCursor = coinbaseResolved.cursor;

      if (
        binanceResolved.close != null &&
        coinbaseResolved.close != null &&
        Number.isFinite(binanceResolved.close) &&
        Number.isFinite(coinbaseResolved.close) &&
        binanceResolved.close > 0
      ) {
        spread = spreadSmoother.next({
          binancePrice: binanceResolved.close,
          coinbasePrice: coinbaseResolved.close,
        });
      }
    }
    recordProfile('spreadMs');

    const computePluginSeries = (baseResult: Partial<IndicatorSnapshot>) => {
      const pluginSeries: Record<string, number> = {};

      for (const pluginEntry of indicatorPluginEntries) {
        if (!pluginEntry.compute) continue;

        const historyKey = pluginEntry.historyKey || pluginEntry.indicator.id;
        try {
          const pluginValue = pluginEntry.compute({
            candle,
            btcCandle,
            data: candlesHistory,
            btcData: btcCandlesHistory,
            baseResult,
          });

          if (
            pluginValue == null ||
            typeof pluginValue !== 'number' ||
            !Number.isFinite(pluginValue)
          ) {
            continue;
          }

          pluginSeries[historyKey] = pluginValue;
          pushIndicator(historyKey, pluginValue);
        } catch (error) {
          if (indicatorPluginErrorShown.has(historyKey)) {
            continue;
          }
          indicatorPluginErrorShown.add(historyKey);
          // Log once per plugin key to avoid noisy per-candle output.
          console.warn(
            `Indicator plugin "${historyKey}" compute failed: ${String(error)}`,
          );
        }
      }

      return pluginSeries;
    };

    const window1h = runtimeOnly
      ? null
      : window1hTracker.push(currentIndex, currentTimestamp);
    const window24h = runtimeOnly
      ? null
      : window24hTracker.push(currentIndex, currentTimestamp);

    const price1hStart = runtimeOnly
      ? null
      : price1hStartTracker.resolve(currentTimestamp);
    const price24hStart = runtimeOnly
      ? null
      : price24hStartTracker.resolve(currentTimestamp);
    const price1hPcntRaw =
      price1hStart?.startClose != null
        ? percentChange(candle.close, price1hStart.startClose)
        : null;
    const price24hPcntRaw =
      price24hStart?.startClose != null
        ? percentChange(candle.close, price24hStart.startClose)
        : null;
    const price1hPcnt = price1hPcntRaw ?? 0;
    const price24hPcnt = price24hPcntRaw ?? 0;

    const highPrice1h = window1h?.hasFullWindow ? window1h.high : null;
    const lowPrice1h = window1h?.hasFullWindow ? window1h.low : null;
    const volume1h = window1h?.hasFullWindow ? window1h.volume : null;
    const highPrice24h = window24h?.hasFullWindow ? window24h.high : null;
    const lowPrice24h = window24h?.hasFullWindow ? window24h.low : null;
    const volume24h = window24h?.hasFullWindow ? window24h.volume : null;
    recordProfile('windowStatsMs');

    if (
      ma14Value == null ||
      ma49Value == null ||
      ma50Value == null ||
      atrValue == null ||
      !bbValue ||
      obvValue == null ||
      smaObvValue == null ||
      !macdValue
    ) {
      if (!runtimeOnly) {
        computePluginSeries({
          prevCandle,
          correlation,
          spread,
          candle,
        });
        recordProfile('pluginMs');
      }
      finishProfile(true);
      latestSnapshot = null;
      return null;
    }

    let highLevel: number | null = null;
    let lowLevel: number | null = null;
    if (indicatorPeriods.levelLookback > 0) {
      if (
        len >= indicatorPeriods.levelLookback + indicatorPeriods.levelDelay &&
        levelHighDeque.length > 0 &&
        levelLowDeque.length > 0
      ) {
        highLevel = highs[levelHighDeque[0]];
        lowLevel = lows[levelLowDeque[0]];
      }
    } else if (
      len >=
      indicatorPeriods.levelLookback + indicatorPeriods.levelDelay
    ) {
      const window = candlesHistory.slice(
        len - indicatorPeriods.levelLookback - indicatorPeriods.levelDelay,
        len - indicatorPeriods.levelDelay,
      );
      highLevel = Math.max(...window.map((item) => item.high));
      lowLevel = Math.min(...window.map((item) => item.low));
    }

    if (
      highLevel != null &&
      prevCandle != null &&
      candle.close > highLevel &&
      prevCandle.close <= highLevel
    ) {
      breakoutState.side = 'high';
      breakoutState.barsSinceBreakout = 0;
    } else if (
      lowLevel != null &&
      prevCandle != null &&
      candle.close < lowLevel &&
      prevCandle.close >= lowLevel
    ) {
      breakoutState.side = 'low';
      breakoutState.barsSinceBreakout = 0;
    } else if (breakoutState.barsSinceBreakout != null) {
      breakoutState.barsSinceBreakout += 1;
    }

    if (runtimeOnly) {
      recordProfile('resultMs');
      finishProfile(false);
      const runtimeResult = {
        maFast: ma14Value,
        maMedium: ma49Value,
        maSlow: ma50Value,
        atr: atrValue,
        atrPct: atrPctRatio,
        bbUpper: bbValue.upper,
        bbMiddle: bbValue.middle,
        bbLower: bbValue.lower,
        obv: obvValue,
        smaObv: smaObvValue,
        macd: macdValue.MACD,
        macdSignal: macdValue.signal,
        macdHistogram: macdValue.histogram,
        price24hPcnt,
        price1hPcnt,
        highPrice1h,
        lowPrice1h,
        volume1h,
        highPrice24h,
        lowPrice24h,
        volume24h,
        highLevel,
        lowLevel,
        prevClose: prevCandle?.close ?? null,
        correlation,
        spread,
        candle,
        prevCandle,
      } as IndicatorSnapshot;
      latestSnapshot = runtimeResult;
      return runtimeResult;
    }

    const baseResult = {
      maFast: ma14Value,
      maMedium: ma49Value,
      maSlow: ma50Value,
      atr: atrValue,
      atrPct: atrPctRatio,
      bbUpper: bbValue.upper,
      bbMiddle: bbValue.middle,
      bbLower: bbValue.lower,
      obv: obvValue,
      smaObv: smaObvValue,
      macd: macdValue.MACD,
      macdSignal: macdValue.signal,
      macdHistogram: macdValue.histogram,
      price24hPcnt,
      price1hPcnt,
      highPrice1h,
      lowPrice1h,
      volume1h,
      highPrice24h,
      lowPrice24h,
      volume24h,
      highLevel,
      lowLevel,
      prevClose: prevCandle?.close ?? null,
      correlation,
      spread,
    };

    applyIndicatorsToHistory(baseResult, pushIndicator);
    recordProfile('historyMs');

    const pluginSeries = computePluginSeries({
      ...baseResult,
      candle,
      prevCandle,
      correlation,
    });
    recordProfile('pluginMs');
    let cachedBaseContext: BaseStrategyContextSnapshot | null = null;

    const result = {
      ...baseResult,
      ...pluginSeries,
      candle,
      prevCandle,
      highLevel,
      lowLevel,
      correlation,
    } as IndicatorSnapshot;

    Object.defineProperty(result, 'baseContext', {
      configurable: true,
      enumerable: true,
      get() {
        if (!cachedBaseContext) {
          cachedBaseContext = buildBaseContextSnapshot({
            candle,
            prevCandle,
            baseResult,
            candlesHistory,
            btcCandlesHistory,
            ethCandlesHistory,
            closeSeries: closes,
            volumeSeries: volumes,
            btcCloseSeries: btcCloses,
            coinResampledCandles: {
              h1: coin1hCache.snapshot().slice(-ML_BASE_CANDLES_WINDOW),
              h4: coin4hCache.snapshot().slice(-ML_BASE_CANDLES_WINDOW),
              d1: coin1dCache.snapshot().slice(-ML_BASE_CANDLES_WINDOW),
            },
            btcResampledCandles: {
              h1: btc1hCache.snapshot().slice(-ML_BASE_CANDLES_WINDOW),
              h4: btc4hCache.snapshot().slice(-ML_BASE_CANDLES_WINDOW),
              d1: btc1dCache.snapshot().slice(-ML_BASE_CANDLES_WINDOW),
            },
            ethResampledCandles: {
              h1: eth1hCache.snapshot().slice(-ML_BASE_CANDLES_WINDOW),
              h4: eth4hCache.snapshot().slice(-ML_BASE_CANDLES_WINDOW),
              d1: eth1dCache.snapshot().slice(-ML_BASE_CANDLES_WINDOW),
            },
            indicatorHistory,
            indicatorPeriods,
            closeStreaks,
            breakoutState,
            rsiValue,
            adxValue,
            maLayers: buildBaseContextMaLayers(),
            contextMa: buildBaseContextContextMa(),
            adaptiveChannel: buildBaseContextAdaptiveChannel(),
            psar: latestBaseContextPsar,
          });
        }

        return cachedBaseContext;
      },
    });

    recordProfile('resultMs');
    finishProfile(false);
    latestSnapshot = result;
    return result;
  };

  const buildStrategySnapshot = (): IndicatorsHistorySnapshot => {
    const baseSnapshot = {
      ...cloneArrayValues(getBaseHistoryResult()),
      ...cloneArrayValues(getBtcRuntimeHistoryResult()),
    } as Record<string, unknown>;
    const capturedCoinLength = candlesHistory.length;
    const capturedBtcLength = btcCandlesHistory.length;
    const capturedEthLength = ethCandlesHistory.length;
    const capturedCoin1hLength = coin1hCache.size();
    const capturedCoin4hLength = coin4hCache.size();
    const capturedCoin1dLength = coin1dCache.size();
    const capturedBtc1hLength = btc1hCache.size();
    const capturedBtc4hLength = btc4hCache.size();
    const capturedBtc1dLength = btc1dCache.size();
    const capturedEth1hLength = eth1hCache.size();
    const capturedEth4hLength = eth4hCache.size();
    const capturedEth1dLength = eth1dCache.size();
    const capturedCloseStreaks = { ...closeStreaks };
    const capturedBreakoutState = { ...breakoutState };
    const capturedRsiValue = latestRsiValue;
    const capturedAdxValue = latestAdxValue ? { ...latestAdxValue } : null;
    const capturedMaLayers = buildBaseContextMaLayers().map((layer) => ({
      ...layer,
    }));
    const capturedContextMa = { ...buildBaseContextContextMa() };
    const capturedAdaptiveChannel = { ...buildBaseContextAdaptiveChannel() };
    const capturedPsar = { ...latestBaseContextPsar };

    let cachedMlCandleSnapshot: MlCandleIndicatorsSnapshot | null = null;
    let cachedCoinTimeframeSnapshot: Record<string, number[]> | null = null;
    let cachedBtcSnapshot: Record<string, number[]> | null = null;
    let cachedBaseContextSnapshot: BaseStrategyContextSnapshot | undefined;

    const getCapturedCoinCandles = () =>
      candlesHistory.slice(0, capturedCoinLength);
    const getCapturedBtcCandles = () =>
      btcCandlesHistory.slice(0, capturedBtcLength);
    const getCapturedEthCandles = () =>
      ethCandlesHistory.slice(0, capturedEthLength);
    const getCapturedCoinResampled = () => ({
      h1: coin1hCache.snapshot(capturedCoin1hLength),
      h4: coin4hCache.snapshot(capturedCoin4hLength),
      d1: coin1dCache.snapshot(capturedCoin1dLength),
    });
    const getCapturedBtcResampled = () => ({
      h1: btc1hCache.snapshot(capturedBtc1hLength),
      h4: btc4hCache.snapshot(capturedBtc4hLength),
      d1: btc1dCache.snapshot(capturedBtc1dLength),
    });
    const getCapturedEthResampled = () => ({
      h1: eth1hCache.snapshot(capturedEth1hLength),
      h4: eth4hCache.snapshot(capturedEth4hLength),
      d1: eth1dCache.snapshot(capturedEth1dLength),
    });
    const buildCompactSnapshot = ({
      limit = 5,
    }: {
      limit?: number;
    } = {}) => {
      const snapshot = buildStrategySnapshot() as Record<PropertyKey, any>;
      const compact: Record<string, unknown> = {};
      const normalizedLimit =
        Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 5;
      const keys = new Set<string>([
        ...BASE_HISTORY_KEYS,
        ...BTC_RUNTIME_KEYS,
        ...CANDLE_SERIES_KEYS,
        ...Array.from(STRATEGY_SNAPSHOT_LAZY_KEYS),
      ]);

      for (const key of keys) {
        const value = snapshot[key];
        if (Array.isArray(value)) {
          compact[key] = value.slice(-normalizedLimit);
        } else if (value !== undefined) {
          compact[key] = value;
        }
      }

      compact.baseContext = snapshot.baseContext;
      return compact;
    };

    const resolveMlCandleSnapshot = () => {
      if (!cachedMlCandleSnapshot) {
        cachedMlCandleSnapshot = buildMlCandleIndicators(
          getCapturedCoinCandles(),
          getCapturedBtcCandles(),
        );
      }

      return cachedMlCandleSnapshot;
    };

    const resolveCoinTimeframeSnapshot = () => {
      if (!cachedCoinTimeframeSnapshot) {
        cachedCoinTimeframeSnapshot = buildMlTimeframeIndicators(
          getCapturedCoinCandles(),
          indicatorPeriods,
        );
      }

      return cachedCoinTimeframeSnapshot;
    };

    const resolveBtcSnapshot = () => {
      if (!cachedBtcSnapshot) {
        cachedBtcSnapshot = buildIndicatorSeriesByTimeframes(
          getCapturedBtcCandles(),
          indicatorPeriods,
          'btc',
        );
      }

      return cachedBtcSnapshot;
    };

    return new Proxy(baseSnapshot, {
      get(target, prop, receiver) {
        if (
          prop === COMPACT_INDICATORS_SNAPSHOT_SYMBOL ||
          prop === COMPACT_INDICATORS_SNAPSHOT_KEY
        ) {
          return buildCompactSnapshot;
        }

        if (typeof prop !== 'string') {
          return Reflect.get(target, prop, receiver);
        }

        if (prop === 'baseContext') {
          if (cachedBaseContextSnapshot) {
            return cachedBaseContextSnapshot;
          }

          const latestCandle = candlesHistory[capturedCoinLength - 1];
          if (!latestCandle) return undefined;

          const latestPrevCandle =
            capturedCoinLength > 1
              ? candlesHistory[capturedCoinLength - 2]
              : null;

          const baseResult = buildLatestBaseResult({
            latestIndicatorValues,
            prevClose: latestPrevCandle?.close ?? null,
          });
          cachedBaseContextSnapshot = buildBaseContextSnapshot({
            candle: latestCandle,
            prevCandle: latestPrevCandle,
            baseResult,
            candlesHistory: getCapturedCoinCandles(),
            btcCandlesHistory: getCapturedBtcCandles(),
            ethCandlesHistory: getCapturedEthCandles(),
            closeSeries: closes.slice(0, capturedCoinLength),
            volumeSeries: volumes.slice(0, capturedCoinLength),
            btcCloseSeries: btcCloses.slice(0, capturedBtcLength),
            coinResampledCandles: getCapturedCoinResampled(),
            btcResampledCandles: getCapturedBtcResampled(),
            ethResampledCandles: getCapturedEthResampled(),
            indicatorHistory,
            indicatorPeriods,
            closeStreaks: capturedCloseStreaks,
            breakoutState: capturedBreakoutState,
            rsiValue: capturedRsiValue,
            adxValue: capturedAdxValue,
            maLayers: capturedMaLayers,
            contextMa: capturedContextMa,
            adaptiveChannel: capturedAdaptiveChannel,
            psar: capturedPsar,
          });

          return cachedBaseContextSnapshot;
        }

        if (Reflect.has(target, prop)) {
          return Reflect.get(target, prop, receiver);
        }

        if ((CANDLE_SERIES_KEYS as readonly string[]).includes(prop)) {
          return resolveMlCandleSnapshot()[
            prop as keyof MlCandleIndicatorsSnapshot
          ];
        }

        if ((COIN_TIMEFRAME_KEYS as readonly string[]).includes(prop)) {
          return resolveCoinTimeframeSnapshot()[prop];
        }

        if ((BTC_TIMEFRAME_KEYS as readonly string[]).includes(prop)) {
          return resolveBtcSnapshot()[prop];
        }

        return undefined;
      },
      ownKeys(target) {
        return Array.from(
          new Set([
            ...Reflect.ownKeys(target),
            ...Array.from(STRATEGY_SNAPSHOT_LAZY_KEYS),
          ]),
        );
      },
      getOwnPropertyDescriptor(target, prop) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, prop);
        if (descriptor) {
          return descriptor;
        }

        if (typeof prop === 'string' && STRATEGY_SNAPSHOT_LAZY_KEYS.has(prop)) {
          return {
            enumerable: true,
            configurable: true,
          };
        }

        return undefined;
      },
    }) as IndicatorsHistorySnapshot;
  };

  data.forEach((candle, index) => {
    next(candle, btcData[index], resolveEthCandle(candle, index));
  });

  const runtimeState = (): IndicatorsControllerRuntimeState => ({
    indicatorState: {
      maFast: ma14.snapshot(),
      maMedium: ma49.snapshot(),
      maSlow: ma50.snapshot(),
      atr: atr.snapshot(),
      atrPctShort: atrPctShort.snapshot(),
      atrPctLong: atrPctLong.snapshot(),
      bb: bb.snapshot(),
      obv: obv.snapshot(),
      smaObv: smaObv.snapshot(),
      macd: macd.snapshot(),
      rsi: rsiIndicator.snapshot(),
      adx: adxIndicator.snapshot(),
      baseContextHl2Ema: Object.fromEntries(
        Object.entries(baseContextHl2Ema).map(([key, ema]) => [
          key,
          ema.snapshot(),
        ]),
      ),
      baseContextCloseEma34: baseContextCloseEma34.snapshot(),
      baseContextTypicalSma20: baseContextTypicalSma20.snapshot(),
      baseContextAdaptivePreviousCenterline:
        latestBaseContextAdaptivePreviousCenterline,
      baseContextPsar: baseContextPsar.snapshot(),
      baseContextPsarEma50: baseContextPsarEma50.snapshot(),
      baseContextPsarFilterBarsSinceSignal,
      btcMaFast: btcMaFast.snapshot(),
      btcMaSlow: btcMaSlow.snapshot(),
      spreadSmoother: spreadSmoother.snapshot(),
    },
    indicatorHistory: Object.fromEntries(
      Object.entries(indicatorHistory).map(([key, buffer]) => [
        key,
        cloneNumericHistoryBuffer(buffer),
      ]),
    ),
    btcRuntimeHistory: Object.fromEntries(
      Object.entries(btcRuntimeHistory).map(([key, buffer]) => [
        key,
        cloneNumericHistoryBuffer(buffer),
      ]),
    ),
    latestIndicatorValues: { ...latestIndicatorValues },
    rawCoinCandles: candlesHistory
      .slice(-controllerStateCandleWindow)
      .map(cloneMlCandle),
    rawBtcCandles: btcCandlesHistory
      .slice(-controllerStateCandleWindow)
      .map(cloneMlCandle),
    rawEthCandles: ethCandlesHistory
      .slice(-controllerStateCandleWindow)
      .map(cloneMlCandle),
    coinResampledCandles: {
      h1: coin1hCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
      h4: coin4hCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
      d1: coin1dCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
    },
    btcResampledCandles: {
      h1: btc1hCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
      h4: btc4hCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
      d1: btc1dCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
    },
    ethResampledCandles: {
      h1: eth1hCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
      h4: eth4hCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
      d1: eth1dCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
    },
    closeStreaks: { ...closeStreaks },
    breakoutState: { ...breakoutState },
    btcCloses: btcCloses.slice(-controllerStateCandleWindow),
    btcBinanceCursor,
    btcCoinbaseCursor,
  });

  const checkpointRuntimeState = (): IndicatorsControllerCheckpointState => ({
    indicatorState: {
      maFast: ma14.snapshot(),
      maMedium: ma49.snapshot(),
      maSlow: ma50.snapshot(),
      atr: atr.snapshot(),
      atrPctShort: atrPctShort.snapshot(),
      atrPctLong: atrPctLong.snapshot(),
      bb: bb.snapshot(),
      obv: obv.snapshot(),
      smaObv: smaObv.snapshot(),
      macd: macd.snapshot(),
      rsi: rsiIndicator.snapshot(),
      adx: adxIndicator.snapshot(),
      baseContextHl2Ema: Object.fromEntries(
        Object.entries(baseContextHl2Ema).map(([key, ema]) => [
          key,
          ema.snapshot(),
        ]),
      ),
      baseContextCloseEma34: baseContextCloseEma34.snapshot(),
      baseContextTypicalSma20: baseContextTypicalSma20.snapshot(),
      baseContextAdaptivePreviousCenterline:
        latestBaseContextAdaptivePreviousCenterline,
      baseContextPsar: baseContextPsar.snapshot(),
      baseContextPsarEma50: baseContextPsarEma50.snapshot(),
      baseContextPsarFilterBarsSinceSignal,
      btcMaFast: btcMaFast.snapshot(),
      btcMaSlow: btcMaSlow.snapshot(),
      spreadSmoother: spreadSmoother.snapshot(),
    },
    rawCoinCandles: candlesHistory
      .slice(-controllerStateCandleWindow)
      .map(cloneMlCandle),
    rawBtcCandles: btcCandlesHistory
      .slice(-controllerStateCandleWindow)
      .map(cloneMlCandle),
    rawEthCandles: ethCandlesHistory
      .slice(-controllerStateCandleWindow)
      .map(cloneMlCandle),
    coinResampledCandles: {
      h1: coin1hCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
      h4: coin4hCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
      d1: coin1dCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
    },
    btcResampledCandles: {
      h1: btc1hCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
      h4: btc4hCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
      d1: btc1dCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
    },
    ethResampledCandles: {
      h1: eth1hCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
      h4: eth4hCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
      d1: eth1dCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
    },
    closeStreaks: { ...closeStreaks },
    breakoutState: { ...breakoutState },
    btcCloses: btcCloses.slice(-controllerStateCandleWindow),
    btcBinanceCursor,
    btcCoinbaseCursor,
  });

  return {
    next,
    updateReferenceData: replaceReferenceData,
    snapshot: (options?: {
      compact?: boolean;
      limit?: number;
    }): IndicatorsHistorySnapshot =>
      options?.compact
        ? ((buildStrategySnapshot() as Record<PropertyKey, any>)[
            COMPACT_INDICATORS_SNAPSHOT_SYMBOL
          ]({
            limit: options.limit,
          }) as IndicatorsHistorySnapshot)
        : buildStrategySnapshot(),
    checkpointRuntimeState,
    latestSnapshot: (): IndicatorSnapshot | null => latestSnapshot,
    runtimeState,
    latestNumber: (key: string): number | undefined => {
      const latestValue = latestIndicatorValues[key];
      if (typeof latestValue === 'number') {
        return latestValue;
      }

      const value = getHistoryResult()[key as keyof IndicatorsHistorySnapshot];
      if (!Array.isArray(value) || value.length === 0) {
        return undefined;
      }

      const last = value[value.length - 1];
      return typeof last === 'number' ? last : undefined;
    },
    latestNumbers: (key: string, count: number): number[] => {
      const normalizedCount = Number.isFinite(count)
        ? Math.max(0, Math.trunc(count))
        : 0;
      if (normalizedCount === 0) return [];

      const buffer = indicatorHistory[key];
      if (buffer) {
        const resultSize = Math.min(normalizedCount, buffer.size);
        const result = new Array<number>(resultSize);
        const firstOffset = buffer.size - resultSize;
        for (let index = 0; index < resultSize; index += 1) {
          result[index] =
            buffer.values[
              (buffer.start + firstOffset + index) % ML_BASE_CANDLES_WINDOW
            ]!;
        }
        return result;
      }

      const value = getHistoryResult()[key as keyof IndicatorsHistorySnapshot];
      return Array.isArray(value)
        ? value
            .slice(-normalizedCount)
            .filter((item): item is number => typeof item === 'number')
        : [];
    },
    result: (): IndicatorsHistorySnapshot => {
      return cloneHistorySnapshot(
        getHistoryResult() as Record<string, number[] | Candle[]>,
      ) as IndicatorsHistorySnapshot;
    },
  };
};

export const buildMlTimeframeIndicators = (
  candles: Candle[],
  periods: Partial<IndicatorPeriods> = {},
): Record<string, number[]> => {
  const result: Record<string, number[]> = {};
  const indicatorPeriods = resolveIndicatorPeriods(periods);

  for (const timeframe of INDICATOR_TIMEFRAMES) {
    const tfCandles = resampleCandles(candles, timeframe.minutes);
    if (tfCandles.length === 0) continue;

    const history = createIndicators(tfCandles, [], {
      includeMlPayload: false,
      periods: indicatorPeriods,
    }).result() as Record<string, number[]>;
    for (const [key, values] of Object.entries(history)) {
      result[`${key}${timeframe.suffix}`] = values;
    }
  }

  return cloneArrayValues(result);
};

const withSourcePrefix = (key: string, sourcePrefix = '') => {
  if (!sourcePrefix) return key;
  return `${sourcePrefix}${key[0].toUpperCase()}${key.slice(1)}`;
};

const buildIndicatorSeriesByTimeframes = (
  candles: Candle[],
  periods: Partial<IndicatorPeriods>,
  sourcePrefix = '',
): Record<string, number[]> => {
  const result: Record<string, number[]> = {};
  if (candles.length === 0) return result;

  const baseHistory = createIndicators(candles, [], {
    includeMlPayload: false,
    periods,
  }).result() as Record<string, number[]>;
  for (const [key, values] of Object.entries(baseHistory)) {
    result[withSourcePrefix(key, sourcePrefix)] = values;
  }

  const timeframeHistory = buildMlTimeframeIndicators(candles, periods);
  for (const [key, values] of Object.entries(timeframeHistory)) {
    result[withSourcePrefix(key, sourcePrefix)] = values;
  }

  return cloneArrayValues(result);
};
