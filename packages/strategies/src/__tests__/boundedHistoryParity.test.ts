/** @jest-environment node */

import { createHash } from 'crypto';
import { Candle } from '@tradejs/types';
import { config as DOUBLE_TAP_CONFIG } from '../DoubleTap/config';
import { createDoubleTapEngine } from '../DoubleTap/engine';
import { config as GRID_CONFIG } from '../Grid/config';
import { createGridEngine } from '../Grid/engine';
import { config as LIQUIDITY_ZONES_CONFIG } from '../LiquidityZones/config';
import { createLiquidityZonesEngine } from '../LiquidityZones/engine';
import { config as STRUCTURE_ZONES_CONFIG } from '../StructureZones/config';
import { createStructureZonesEngine } from '../StructureZones/engine';
import { config as TREND_FOLLOW_CONFIG } from '../TrendFollow/config';
import { createTrendFollowEngine } from '../TrendFollow/engine';

const makeCandle = (
  index: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1_000,
): Candle => ({
  timestamp: 1_700_000_000_000 + index * 60_000,
  open,
  high,
  low,
  close,
  volume,
  turnover: close * volume,
});

const createRandom = (seedValue: number) => {
  let seed = seedValue;
  return () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
};

const createRandomWalk = (count: number, seed: number) => {
  const random = createRandom(seed);
  let price = 100;
  const candles: Candle[] = [];

  for (let index = 0; index < count; index += 1) {
    const open = price;
    const close = Math.max(1, open + (random() - 0.5) * 4);
    const high = Math.max(open, close) + random() * 3;
    const low = Math.max(0.1, Math.min(open, close) - random() * 3);
    price = close;
    candles.push(
      makeCandle(index, open, high, low, close, 1_000 + random() * 5_000),
    );
  }

  return candles;
};

const createCraftedSet = () => {
  const candles: Candle[] = [];

  for (let index = 0; index < 60; index += 1) {
    const price = 50 + index * 0.2;
    candles.push(makeCandle(index, price, price + 1, price - 1, price));
  }

  const base = candles.length;
  const patternRows: Array<[number, number, number, number]> = [
    [100, 102, 98, 100],
    [101, 104, 99, 102],
    [102, 110, 100, 108],
    [108, 106, 101, 103],
    [103, 105, 96, 99],
    [99, 104, 94, 96],
    [96, 103, 95, 101],
    [101, 105, 97, 103],
    [103, 113, 102, 112],
    [112, 114, 90, 91],
    [91, 112, 89, 111],
    [111, 111, 94, 96],
    [96, 107, 95, 100],
    [100, 110, 96, 109],
    [109, 109, 93, 93],
  ];

  patternRows.forEach(([open, high, low, close], offset) => {
    candles.push(makeCandle(base + offset, open, high, low, close, 2_000));
  });

  return candles;
};

const normalize = (value: unknown) =>
  JSON.stringify(value, (_key, nested) =>
    typeof nested === 'number' && Number.isFinite(nested)
      ? Number(nested.toFixed(10))
      : nested,
  );

const hashStateStream = (states: unknown[]) =>
  createHash('sha256').update(normalize(states)).digest('hex');

const datasets = [
  ['random-a', createRandomWalk(1_600, 12_345)],
  ['random-b', createRandomWalk(1_600, 67_890)],
  ['crafted', createCraftedSet()],
] as const;

const scenarios = [
  {
    strategyName: 'TrendFollow',
    createEngine: createTrendFollowEngine,
    baseConfig: TREND_FOLLOW_CONFIG,
    variants: [
      {},
      {
        TRENDFOLLOW_PIVOT_LENGTH: 2,
        TRENDFOLLOW_ATR_LENGTH: 2,
        TRENDFOLLOW_ATR_MULT: 1,
      },
      {
        TRENDFOLLOW_PIVOT_LENGTH: 12,
        TRENDFOLLOW_MIN_BARS_BETWEEN_SIGNALS: 8,
      },
    ],
  },
  {
    strategyName: 'StructureZones',
    createEngine: createStructureZonesEngine,
    baseConfig: STRUCTURE_ZONES_CONFIG,
    variants: [
      {},
      {
        STRUCTURE_ZONES_PIVOT_LENGTH: 2,
        STRUCTURE_ZONES_ATR_LENGTH: 5,
        STRUCTURE_ZONES_MIN_SWING_ATR: 0.1,
      },
      {
        STRUCTURE_ZONES_PIVOT_LENGTH: 8,
        STRUCTURE_ZONES_ACCEPT_BARS: 4,
        STRUCTURE_ZONES_TRADE_TRANSITION_BREAKOUTS: true,
      },
    ],
  },
  {
    strategyName: 'LiquidityZones',
    createEngine: createLiquidityZonesEngine,
    baseConfig: LIQUIDITY_ZONES_CONFIG,
    variants: [
      {},
      {
        LIQUIDITY_ZONES_PIVOT_LOOKBACK: 1,
        LIQUIDITY_ZONES_MIN_FILTER_VALUE: 0,
      },
      {
        LIQUIDITY_ZONES_PIVOT_LOOKBACK: 20,
        LIQUIDITY_ZONES_MIN_FILTER_VALUE: 1,
        LIQUIDITY_ZONES_FILTER_MODE: 'count',
      },
    ],
  },
  {
    strategyName: 'DoubleTap',
    createEngine: createDoubleTapEngine,
    baseConfig: DOUBLE_TAP_CONFIG,
    variants: [
      {},
      {
        DOUBLETAP_PIVOT_LENGTH: 2,
        DOUBLETAP_MIN_PATTERN_HEIGHT_PCT: 0,
        DOUBLETAP_MAX_BREAKOUT_DISTANCE_PCT: 5,
      },
      {
        DOUBLETAP_PIVOT_LENGTH: 20,
        DOUBLETAP_PIVOT_TOLERANCE_PCT: 10,
        DOUBLETAP_MAX_BREAKOUT_DISTANCE_PCT: 1.4,
      },
    ],
  },
  {
    strategyName: 'Grid',
    createEngine: createGridEngine,
    baseConfig: GRID_CONFIG,
    variants: [
      {},
      {
        GRID_FAST_EMA: 8,
        GRID_SLOW_EMA: 21,
        GRID_ATR_PERIOD: 7,
        GRID_TREND_SLOPE_BARS: 3,
      },
      {
        GRID_FAST_EMA: 34,
        GRID_SLOW_EMA: 89,
        GRID_STEP_ATR_MULT: 1.2,
        GRID_MAX_FIGURE_POINTS: 80,
      },
    ],
  },
] as const;

describe('bounded strategy engine history parity', () => {
  it('keeps deterministic per-bar outputs stable on long histories', () => {
    const summaries = scenarios.flatMap((scenario) =>
      scenario.variants.flatMap((variant, variantIndex) =>
        datasets.map(([datasetName, candles]) => {
          const engine = (scenario.createEngine as any)({
            config: { ...scenario.baseConfig, ...variant } as any,
          });
          const states = candles.map((candle) =>
            JSON.parse(normalize(engine.next(candle as any))),
          );
          const signalCount = states.filter(
            (state) => state.signal || state.pattern,
          ).length;

          return {
            strategyName: scenario.strategyName,
            variantIndex,
            datasetName,
            signalCount,
            stateHash: hashStateStream(states),
          };
        }),
      ),
    );

    expect(summaries).toMatchSnapshot();
  });
});
