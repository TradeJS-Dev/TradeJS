const invokeMock = jest.fn();
const chatOpenAICtorMock = jest.fn();
const setDataMock = jest.fn();
const getUserSettingsMock = jest.fn(async (userName = 'root') => ({
  userName,
  BYBIT_API_KEY: '',
  BYBIT_API_SECRET: '',
  token: '',
  COINALYZE_API_KEY: '',
  OPENAI_API_KEY: 'key_123',
  OPENAI_API_ENDPOINT: 'https://api.openai.com/v1',
  TG_BOT_TOKEN: 'tg-token',
  TG_CHAT_ID: 'tg-chat-id',
}));
const analysisKeyMock = jest.fn((symbol: string, signalId: string) => {
  return `analysis:${symbol}:${signalId}`;
});

class MockHumanMessage {
  content: any;
  constructor(content: any) {
    this.content = content;
  }
}

class MockSystemMessage {
  content: any;
  constructor(content: any) {
    this.content = content;
  }
}

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation((config: unknown) => {
    chatOpenAICtorMock(config);
    return {
      invoke: invokeMock,
    };
  }),
}));

jest.mock('@langchain/core/messages', () => ({
  BaseMessage: class {},
  HumanMessage: MockHumanMessage,
  SystemMessage: MockSystemMessage,
}));

jest.mock('@tradejs/infra/redis', () => ({
  setData: (...args: unknown[]) => setDataMock(...args),
  redisKeys: {
    analysis: (...args: [string, string]) => analysisKeyMock(...args),
  },
}));

jest.mock('@tradejs/infra/userSettings', () => ({
  getUserSettings: (...args: unknown[]) => getUserSettingsMock(...args),
}));

const {
  MAX_AI_SERIES_POINTS,
  askAI,
  buildAiPrompts,
  buildAiHumanPrompt,
  buildAiPayload,
  buildAiSystemPrompt,
  getDeterministicAiGateContext,
  getOpenRouterModelKwargs,
  resetAiRuntimeCache,
  runAiPrompt,
  runAiPromptLocal,
  trimSeriesDeep,
} = require('../ai');
const {
  registerStrategyEntries,
  resetStrategyRegistryCache,
} = require('../strategy/manifests');
const { strategyEntries } = require('@tradejs/strategies');

const makeCandle = (timestamp: number) => ({
  timestamp,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
  turnover: 15,
});

const makeSignal = () =>
  ({
    signalId: 'sig-1',
    symbol: 'ETHUSDT',
    strategy: 'TrendLine',
    interval: '15',
    direction: 'LONG',
    timestamp: 1_700_000_000_000,
    figures: {
      trendLine: {
        id: 'tl-1',
        mode: 'lows',
        distance: 1.23,
        touches: [
          { timestamp: 1, value: 100 },
          { timestamp: 2, value: 101 },
          { timestamp: 3, value: 102 },
          { timestamp: 4, value: 103 },
          { timestamp: 5, value: 104 },
          { timestamp: 6, value: 105 },
        ],
        points: [
          { timestamp: 1, value: 95 },
          { timestamp: 4, value: 99 },
        ],
        alpha: [1, 2, 3, 4, 5, 6],
      },
    },
    prices: {
      currentPrice: 100,
      takeProfitPrice: 103,
      stopLossPrice: 99,
      riskRatio: 3,
    },
    indicators: {
      maFast: [1, 2, 3, 4, 5, 6, 7],
      btcMaFast1h: [10, 11, 12, 13, 14, 15],
      nested: {
        atrPct: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
      },
      candles15m: [1, 2, 3, 4, 5, 6].map((i) => makeCandle(i)),
      matrix: [
        [1, 11, 111],
        [2, 22, 222],
        [3, 33, 333],
        [4, 44, 444],
        [5, 55, 555],
        [6, 66, 666],
      ],
      correlation: 0.42,
    },
  }) as any;

const makeBlockedTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'SHORT';
  signal.prices.currentPrice = 100;
  signal.prices.takeProfitPrice = 96;
  signal.prices.stopLossPrice = 102;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'lows',
    points: [
      { timestamp: 1, value: 99.5 },
      { timestamp: 2, value: 100.05 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [3, 4, 5],
    maSlow: [1, 2, 3],
    btcMaFast: [101, 102, 103],
    btcMaSlow: [100, 101, 102],
  };
  signal.additionalIndicators = {
    touches: 4,
    distance: 12,
  };
  return signal;
};

const makeAggressivePreBreakTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'SHORT';
  signal.prices.currentPrice = 100.111;
  signal.prices.takeProfitPrice = 96;
  signal.prices.stopLossPrice = 101.3;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'lows',
    points: [
      { timestamp: 1, value: 98.9 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 98.9 },
      { timestamp: 1.2, value: 99.2 },
      { timestamp: 1.4, value: 99.4 },
      { timestamp: 1.6, value: 99.7 },
      { timestamp: 1.8, value: 99.9 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [101, 100, 98.5],
    maSlow: [101, 101, 100],
    btcMaFast: [101, 100.2, 99.5],
    btcMaSlow: [101, 100.5, 99.9],
  };
  signal.additionalIndicators = {
    touches: 5,
    distance: 100,
  };
  return signal;
};

const makeStrongNearBreakPressureTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'SHORT';
  signal.prices.currentPrice = 99.7372;
  signal.prices.takeProfitPrice = 96;
  signal.prices.stopLossPrice = 101.3;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'lows',
    points: [
      { timestamp: 1, value: 98.8 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 99.1 },
      { timestamp: 1.2, value: 99.35 },
      { timestamp: 1.4, value: 99.55 },
      { timestamp: 1.6, value: 99.8 },
      { timestamp: 1.8, value: 99.95 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [100.4, 99.1, 97.3],
    maSlow: [100.6, 100.3, 100],
    btcMaFast: [100.4, 99.7, 99.3],
    btcMaSlow: [100.5, 100.2, 100],
    atrPct: [0.918],
  };
  signal.additionalIndicators = {
    touches: 5,
    distance: 748,
  };
  return signal;
};

const makeVolumeDivergenceSignal = (overrides: Record<string, any> = {}) => {
  const base = {
    signalId: 'vd-1',
    symbol: 'TESTUSDT',
    strategy: 'VolumeDivergence',
    interval: '15',
    direction: 'LONG',
    timestamp: 1_700_000_000_000,
    figures: {},
    prices: {
      currentPrice: 101,
      takeProfitPrice: 104,
      stopLossPrice: 98,
      riskRatio: 2,
    },
    indicators: {
      maFast: [100, 101, 102],
      maSlow: [100, 100, 101],
      btcMaFast: [50, 51, 52],
      btcMaSlow: [50, 50.5, 51],
    },
    additionalIndicators: {
      deltaAtPivot: 120,
      volumeDivergenceThresholds: {
        allowStructureAdvanceEntry: false,
        minDivergenceAmplitudeAtrRatio: 0.35,
        minReclaimPct: 105,
        minConfirmationCandleQuality: 0.58,
      },
      volumeDivergenceSetup: {
        atrPct: 2.1,
        divergenceAmplitudeAtrRatio: 0.7,
        reclaimPct: 210,
        confirmationCandleQuality: 0.72,
        confirmationDistancePct: 1,
      },
      divergence: {
        kind: 'bullish',
        pivotLookbackLeft: 2,
        pivotLookbackRight: 1,
        currentPivot: {
          index: 6,
          timestamp: 6,
          priceLow: 95,
          priceHigh: 100,
          volumeNorm: 80,
        },
        previousPivot: {
          index: 4,
          timestamp: 4,
          priceLow: 97,
          priceHigh: 101,
          volumeNorm: 60,
        },
        barsBetweenPivotConfirmations: 4,
      },
    },
  };

  return {
    ...base,
    ...overrides,
    prices: {
      ...base.prices,
      ...overrides.prices,
    },
    indicators: {
      ...base.indicators,
      ...overrides.indicators,
    },
    additionalIndicators: {
      ...base.additionalIndicators,
      ...overrides.additionalIndicators,
      volumeDivergenceThresholds: {
        ...base.additionalIndicators.volumeDivergenceThresholds,
        ...overrides.additionalIndicators?.volumeDivergenceThresholds,
      },
      volumeDivergenceSetup: {
        ...base.additionalIndicators.volumeDivergenceSetup,
        ...overrides.additionalIndicators?.volumeDivergenceSetup,
      },
      divergence: {
        ...base.additionalIndicators.divergence,
        ...overrides.additionalIndicators?.divergence,
        currentPivot: {
          ...base.additionalIndicators.divergence.currentPivot,
          ...overrides.additionalIndicators?.divergence?.currentPivot,
        },
        previousPivot: {
          ...base.additionalIndicators.divergence.previousPivot,
          ...overrides.additionalIndicators?.divergence?.previousPivot,
        },
      },
    },
  } as any;
};

const makeWeakBtcLedBreakTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'SHORT';
  signal.prices.currentPrice = 100;
  signal.prices.takeProfitPrice = 96;
  signal.prices.stopLossPrice = 101.2;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'lows',
    points: [
      { timestamp: 1, value: 100.2 },
      { timestamp: 2, value: 100.425 },
    ],
    touches: [
      { timestamp: 1, value: 100.1 },
      { timestamp: 1.2, value: 100.2 },
      { timestamp: 1.4, value: 100.25 },
      { timestamp: 1.6, value: 100.32 },
      { timestamp: 1.8, value: 100.38 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [101, 100, 99.58],
    maSlow: [101, 100, 100],
    btcMaFast: [101, 100, 99.34],
    btcMaSlow: [101, 100, 100],
    atrPct: [1.02],
  };
  signal.additionalIndicators = {
    touches: 5,
    distance: 293,
  };
  return signal;
};

const makeWeakCleanBreakTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'SHORT';
  signal.prices.currentPrice = 99.541;
  signal.prices.takeProfitPrice = 96;
  signal.prices.stopLossPrice = 101.1;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'lows',
    points: [
      { timestamp: 1, value: 100.2 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 100.8 },
      { timestamp: 1.2, value: 100.6 },
      { timestamp: 1.4, value: 100.4 },
      { timestamp: 1.6, value: 100.2 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [100.5, 99.8, 99.1],
    maSlow: [100.7, 100.2, 100],
    btcMaFast: [100.4, 100.1, 99.9],
    btcMaSlow: [100.5, 100.2, 100],
    atrPct: [1.133],
  };
  signal.additionalIndicators = {
    touches: 4,
    distance: 132,
  };
  return signal;
};

const makeCompressedCleanBreakTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'SHORT';
  signal.prices.currentPrice = 99.49;
  signal.prices.takeProfitPrice = 96;
  signal.prices.stopLossPrice = 101.15;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'lows',
    points: [
      { timestamp: 1, value: 100.15 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 100.55 },
      { timestamp: 1.2, value: 100.4 },
      { timestamp: 1.4, value: 100.28 },
      { timestamp: 1.6, value: 100.16 },
      { timestamp: 1.8, value: 100.08 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [100.3, 99.95, 99.8],
    maSlow: [100.4, 100.15, 100],
    btcMaFast: [100.1, 100.02, 99.95],
    btcMaSlow: [100.15, 100.08, 100],
    atrPct: [0.94],
  };
  signal.additionalIndicators = {
    touches: 5,
    distance: 96,
  };
  return signal;
};

const makeWeakLongFarBreakTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'LONG';
  signal.prices.currentPrice = 100.505;
  signal.prices.takeProfitPrice = 104.5;
  signal.prices.stopLossPrice = 98.9;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'highs',
    points: [
      { timestamp: 1, value: 101.4 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 101.3 },
      { timestamp: 1.2, value: 101.1 },
      { timestamp: 1.4, value: 100.8 },
      { timestamp: 1.6, value: 100.4 },
      { timestamp: 1.8, value: 100.15 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [99.8, 100.1, 100.36],
    maSlow: [99.7, 99.95, 100],
    btcMaFast: [100.02, 100.18, 100.3],
    btcMaSlow: [100, 100.08, 100],
    atrPct: [0.93],
  };
  signal.additionalIndicators = {
    touches: 5,
    distance: 1687,
  };
  return signal;
};

const makeDeterministicQualityLongSignal = () => {
  const signal = makeSignal();
  signal.direction = 'LONG';
  signal.prices.currentPrice = 101.15;
  signal.prices.takeProfitPrice = 104.5;
  signal.prices.stopLossPrice = 98.9;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'highs',
    points: [
      { timestamp: 1, value: 101.4 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 101.3 },
      { timestamp: 1.2, value: 101.0 },
      { timestamp: 1.4, value: 100.7 },
      { timestamp: 1.6, value: 100.35 },
      { timestamp: 1.8, value: 100.1 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [99.8, 100.2, 100.9],
    maSlow: [99.7, 99.95, 100],
    btcMaFast: [100.2, 100.5, 100.8],
    btcMaSlow: [100, 100.1, 100],
    atrPct: [0.95],
  };
  signal.additionalIndicators = {
    touches: 5,
    distance: 220,
  };
  return signal;
};

const makeDeterministicQualityShortSignal = () => {
  const signal = makeSignal();
  signal.direction = 'SHORT';
  signal.prices.currentPrice = 98.9;
  signal.prices.takeProfitPrice = 96;
  signal.prices.stopLossPrice = 101.2;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'lows',
    points: [
      { timestamp: 1, value: 100.6 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 100.9 },
      { timestamp: 1.2, value: 100.7 },
      { timestamp: 1.4, value: 100.45 },
      { timestamp: 1.6, value: 100.2 },
      { timestamp: 1.8, value: 100.05 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [100.5, 99.6, 98.6],
    maSlow: [100.7, 100.2, 100],
    btcMaFast: [100.4, 99.4, 98.6],
    btcMaSlow: [100.5, 100.1, 100],
    atrPct: [1],
  };
  signal.additionalIndicators = {
    touches: 5,
    distance: 250,
  };
  return signal;
};

const makeOverextendedShortTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'SHORT';
  signal.prices.currentPrice = 93.8;
  signal.prices.takeProfitPrice = 90;
  signal.prices.stopLossPrice = 101.2;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'lows',
    points: [
      { timestamp: 1, value: 100.8 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 101.1 },
      { timestamp: 1.2, value: 100.9 },
      { timestamp: 1.4, value: 100.6 },
      { timestamp: 1.6, value: 100.3 },
      { timestamp: 1.8, value: 100.1 },
      { timestamp: 1.9, value: 100.02 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [100.7, 98.4, 98.4],
    maSlow: [100.8, 100.2, 100],
    btcMaFast: [100.6, 98.7, 98.6],
    btcMaSlow: [100.7, 100.1, 100],
    atrPct: [1],
  };
  signal.additionalIndicators = {
    touches: 6,
    distance: 700,
  };
  return signal;
};

const makeDeterministicWatchShortSignal = () => {
  const signal = makeSignal();
  signal.direction = 'SHORT';
  signal.prices.currentPrice = 99.36;
  signal.prices.takeProfitPrice = 96;
  signal.prices.stopLossPrice = 101.2;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'lows',
    points: [
      { timestamp: 1, value: 100.5 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 100.7 },
      { timestamp: 1.2, value: 100.5 },
      { timestamp: 1.4, value: 100.3 },
      { timestamp: 1.6, value: 100.15 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [100.5, 99.9, 99.3],
    maSlow: [100.6, 100.1, 100],
    btcMaFast: [100.1, 100.04, 99.95],
    btcMaSlow: [100.15, 100.08, 100],
    atrPct: [1.1],
  };
  signal.additionalIndicators = {
    touches: 4,
    distance: 140,
  };
  return signal;
};

const makeStrongReadyBreakoutShortSignal = () => {
  const signal = makeSignal();
  signal.direction = 'SHORT';
  signal.prices.currentPrice = 97.5;
  signal.prices.takeProfitPrice = 92;
  signal.prices.stopLossPrice = 101.2;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'lows',
    points: [
      { timestamp: 1, value: 100.8 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 101.1 },
      { timestamp: 1.2, value: 100.9 },
      { timestamp: 1.4, value: 100.6 },
      { timestamp: 1.6, value: 100.3 },
      { timestamp: 1.8, value: 100.1 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [100.8, 99.1, 98.4],
    maSlow: [100.9, 100.3, 100],
    btcMaFast: [100.7, 99.1, 98.6],
    btcMaSlow: [100.8, 100.2, 100],
    atrPct: [1],
  };
  signal.additionalIndicators = {
    touches: 5,
    distance: 500,
    trendlineTiming: {
      entryTiming: 'ready_breakout',
    },
  };
  return signal;
};

const makeFollowThroughLongTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'LONG';
  signal.prices.currentPrice = 100.65;
  signal.prices.takeProfitPrice = 103;
  signal.prices.stopLossPrice = 98.9;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'highs',
    points: [
      { timestamp: 1, value: 100.2 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 100.35 },
      { timestamp: 1.2, value: 100.28 },
      { timestamp: 1.4, value: 100.2 },
      { timestamp: 1.6, value: 100.12 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [99.8, 100.1, 100.25],
    maSlow: [100.1, 100.05, 100],
    btcMaFast: [99.8, 100.05, 100.2],
    btcMaSlow: [100.1, 100.08, 100],
    atrPct: [1],
  };
  signal.additionalIndicators = {
    touches: 4,
    distance: 520,
    trendlineTiming: {
      entryTiming: 'ready_follow_through',
    },
  };
  return signal;
};

const makeRetestLongTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'LONG';
  signal.prices.currentPrice = 101.02;
  signal.prices.takeProfitPrice = 103.5;
  signal.prices.stopLossPrice = 98.9;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'highs',
    points: [
      { timestamp: 1, value: 100.1 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 100.3 },
      { timestamp: 1.2, value: 100.25 },
      { timestamp: 1.4, value: 100.18 },
      { timestamp: 1.6, value: 100.1 },
      { timestamp: 1.8, value: 100.05 },
      { timestamp: 1.9, value: 100.02 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [100.1, 100.12, 100.13],
    maSlow: [100.3, 100.2, 100],
    btcMaFast: [99.6, 99.8, 100.05],
    btcMaSlow: [100.2, 100.1, 100],
    atrPct: [1.5],
  };
  signal.additionalIndicators = {
    touches: 6,
    distance: 228,
    trendlineTiming: {
      entryTiming: 'ready_retest',
    },
  };
  return signal;
};

const makeReverseSupportBounceLongSignal = () => {
  const signal = makeSignal();
  signal.strategy = 'ReverseTrendLine';
  signal.direction = 'LONG';
  signal.prices.currentPrice = 100.35;
  signal.prices.takeProfitPrice = 102.4;
  signal.prices.stopLossPrice = 99.1;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'lows',
    points: [
      { timestamp: 1, value: 100 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 100 },
      { timestamp: 1.2, value: 100.02 },
      { timestamp: 1.4, value: 100.01 },
      { timestamp: 1.6, value: 99.99 },
      { timestamp: 1.8, value: 100 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [99.9, 100.05, 100.3],
    maSlow: [99.8, 99.95, 100.1],
    btcMaFast: [99.8, 100.0, 100.25],
    btcMaSlow: [99.9, 99.95, 100.05],
    atrPct: [0.8],
  };
  signal.additionalIndicators = {
    touches: 5,
    distance: 140,
    currentCandle: {
      timestamp: 2,
      open: 99.95,
      close: 100.35,
      high: 100.45,
      low: 99.76,
    },
    reverseTrendlineTiming: {
      entryTiming: 'ready_rejection',
    },
  };
  return signal;
};

const makeReverseConflictSupportBounceLongSignal = () => {
  const signal = makeReverseSupportBounceLongSignal();
  signal.indicators = {
    ...signal.indicators,
    maFast: [100.3, 100.2, 100.1],
    maSlow: [100.1, 100.15, 100.18],
    btcMaFast: [99.8, 99.95, 100.2],
    btcMaSlow: [99.85, 99.9, 100.05],
    atrPct: [0.8],
  };
  signal.additionalIndicators = {
    ...signal.additionalIndicators,
    touches: 5,
    distance: 140,
    currentCandle: {
      timestamp: 2,
      open: 99.9,
      close: 100.55,
      high: 100.62,
      low: 99.62,
    },
    reverseTrendlineTiming: {
      entryTiming: 'ready_rejection',
    },
  };
  signal.prices.currentPrice = 100.55;
  signal.prices.takeProfitPrice = 102.4;
  signal.prices.stopLossPrice = 99.1;
  return signal;
};

const makeReverseScoredBothSupportBounceLongSignal = () => {
  const signal = makeReverseSupportBounceLongSignal();
  signal.indicators = {
    ...signal.indicators,
    maFast: [100.4, 100.2, 100.05],
    maSlow: [100.2, 100.18, 100.16],
    btcMaFast: [100.3, 100.15, 99.95],
    btcMaSlow: [100.15, 100.1, 100.08],
    atrPct: [0.8],
  };
  signal.additionalIndicators = {
    ...signal.additionalIndicators,
    touches: 5,
    distance: 210,
    currentCandle: {
      timestamp: 2,
      open: 99.92,
      close: 100.72,
      high: 100.78,
      low: 99.1,
    },
    reverseTrendlineTiming: {
      entryTiming: 'ready_rejection',
    },
  };
  signal.prices.currentPrice = 100.72;
  signal.prices.takeProfitPrice = 102.6;
  signal.prices.stopLossPrice = 99.15;
  return signal;
};

const makeReverseResistanceBounceShortSignal = () => {
  const signal = makeSignal();
  signal.strategy = 'ReverseTrendLine';
  signal.direction = 'SHORT';
  signal.prices.currentPrice = 99.62;
  signal.prices.takeProfitPrice = 97.5;
  signal.prices.stopLossPrice = 100.8;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'highs',
    points: [
      { timestamp: 1, value: 100 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 100 },
      { timestamp: 1.2, value: 100.03 },
      { timestamp: 1.4, value: 100.01 },
      { timestamp: 1.6, value: 99.99 },
      { timestamp: 1.8, value: 100 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [100.2, 100.0, 99.7],
    maSlow: [100.1, 100.05, 99.9],
    btcMaFast: [100.2, 100.0, 99.7],
    btcMaSlow: [100.1, 100.05, 99.85],
    atrPct: [0.85],
  };
  signal.additionalIndicators = {
    touches: 5,
    distance: 150,
    currentCandle: {
      timestamp: 2,
      open: 100.04,
      close: 99.62,
      high: 100.24,
      low: 99.56,
    },
    reverseTrendlineTiming: {
      entryTiming: 'ready_rejection',
    },
  };
  return signal;
};

const makeReverseScoredAlignedResistanceBounceShortSignal = () => {
  const signal = makeReverseResistanceBounceShortSignal();
  signal.indicators = {
    ...signal.indicators,
    maFast: [100.25, 100.02, 99.6],
    maSlow: [100.18, 100.08, 99.88],
    btcMaFast: [100.2, 100.01, 99.62],
    btcMaSlow: [100.14, 100.05, 99.9],
    atrPct: [0.85],
  };
  signal.additionalIndicators = {
    ...signal.additionalIndicators,
    touches: 5,
    distance: 145,
    currentCandle: {
      timestamp: 2,
      open: 100.12,
      close: 99.34,
      high: 100.4,
      low: 99.28,
    },
    reverseTrendlineTiming: {
      entryTiming: 'ready_rejection',
    },
  };
  signal.prices.currentPrice = 99.34;
  signal.prices.takeProfitPrice = 97.4;
  signal.prices.stopLossPrice = 100.82;
  return signal;
};

const makeReverseConflictResistanceBounceShortSignal = () => {
  const signal = makeReverseResistanceBounceShortSignal();
  signal.indicators = {
    ...signal.indicators,
    maFast: [99.7, 99.8, 100.1],
    maSlow: [99.9, 99.95, 100],
    btcMaFast: [100.2, 100.0, 99.7],
    btcMaSlow: [100.15, 100.05, 99.85],
    atrPct: [0.85],
  };
  signal.additionalIndicators = {
    ...signal.additionalIndicators,
    touches: 5,
    distance: 150,
    currentCandle: {
      timestamp: 2,
      open: 100.1,
      close: 99.35,
      high: 100.42,
      low: 99.28,
    },
    reverseTrendlineTiming: {
      entryTiming: 'ready_rejection',
    },
  };
  signal.prices.currentPrice = 99.35;
  signal.prices.takeProfitPrice = 97.5;
  signal.prices.stopLossPrice = 100.8;
  return signal;
};

const makeReverseBtcOnlyResistanceBounceShortSignal = () => {
  const signal = makeReverseResistanceBounceShortSignal();
  signal.indicators = {
    ...signal.indicators,
    maFast: [100.2, 100.0, 99.7],
    maSlow: [100.1, 100.05, 99.85],
    btcMaFast: [99.8, 100.0, 100.25],
    btcMaSlow: [99.9, 99.95, 100.05],
    atrPct: [0.85],
  };
  signal.additionalIndicators = {
    ...signal.additionalIndicators,
    touches: 5,
    distance: 150,
    currentCandle: {
      timestamp: 2,
      open: 100.08,
      close: 99.36,
      high: 100.4,
      low: 99.29,
    },
    reverseTrendlineTiming: {
      entryTiming: 'ready_rejection',
    },
  };
  signal.prices.currentPrice = 99.36;
  signal.prices.takeProfitPrice = 97.5;
  signal.prices.stopLossPrice = 100.8;
  return signal;
};

const makeReverseAlignedFollowThroughLongSignal = () => {
  const signal = makeReverseSupportBounceLongSignal();
  signal.indicators = {
    ...signal.indicators,
    maFast: [99.95, 100.15, 100.4],
    maSlow: [99.9, 100.0, 100.1],
    btcMaFast: [99.95, 100.1, 100.3],
    btcMaSlow: [99.9, 99.98, 100.05],
    atrPct: [0.9],
  };
  signal.additionalIndicators = {
    ...signal.additionalIndicators,
    touches: 5,
    distance: 180,
    currentCandle: {
      timestamp: 2,
      open: 100.1,
      close: 100.42,
      high: 100.5,
      low: 99.88,
    },
    reverseTrendlineTiming: {
      entryTiming: 'ready_follow_through',
    },
  };
  signal.prices.currentPrice = 100.42;
  signal.prices.takeProfitPrice = 102.6;
  signal.prices.stopLossPrice = 99.2;
  return signal;
};

const makeFailedReverseBounceLongSignal = () => {
  const signal = makeSignal();
  signal.strategy = 'ReverseTrendLine';
  signal.direction = 'LONG';
  signal.prices.currentPrice = 99.4;
  signal.prices.takeProfitPrice = 102.4;
  signal.prices.stopLossPrice = 98.8;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'lows',
    points: [
      { timestamp: 1, value: 100 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 100 },
      { timestamp: 1.2, value: 100.02 },
      { timestamp: 1.4, value: 100.01 },
      { timestamp: 1.6, value: 99.99 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [100.0, 99.8, 99.5],
    maSlow: [100.0, 99.95, 99.8],
    btcMaFast: [100.0, 99.85, 99.6],
    btcMaSlow: [100.0, 99.95, 99.8],
    atrPct: [0.8],
  };
  signal.additionalIndicators = {
    touches: 4,
    distance: 120,
    currentCandle: {
      timestamp: 2,
      open: 100.05,
      close: 99.4,
      high: 100.12,
      low: 99.25,
    },
    reverseTrendlineTiming: {
      entryTiming: 'wait_touch',
    },
  };
  return signal;
};

describe('ai helpers', () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    jest.clearAllMocks();
    resetAiRuntimeCache();
    resetStrategyRegistryCache();
    registerStrategyEntries(strategyEntries);
    invokeMock.mockReset();
    chatOpenAICtorMock.mockReset();
    getUserSettingsMock.mockClear();
    setDataMock.mockReset();
    analysisKeyMock.mockClear();
    setDataMock.mockResolvedValue(undefined);
  });

  afterAll(() => {
    resetStrategyRegistryCache();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  describe('trimSeriesDeep', () => {
    it('trims nested arrays to last N values and keeps scalars', () => {
      const input = {
        a: [1, 2, 3, 4, 5, 6, 7],
        b: {
          c: [10, 11, 12, 13, 14, 15],
          d: 'x',
        },
      };

      const result = trimSeriesDeep(input);

      expect(result.a).toEqual([3, 4, 5, 6, 7]);
      expect(result.b.c).toEqual([11, 12, 13, 14, 15]);
      expect(result.b.d).toBe('x');
    });

    it('trims matrix-like arrays only by outer dimension', () => {
      const matrix = [
        [1, 2, 3, 4, 5, 6],
        [10, 20, 30, 40, 50, 60],
        [100, 200, 300, 400, 500, 600],
        [1000, 2000, 3000, 4000, 5000, 6000],
        [7, 8, 9, 10, 11, 12],
        [13, 14, 15, 16, 17, 18],
      ];

      const result = trimSeriesDeep(matrix);

      expect(result).toEqual(matrix.slice(-MAX_AI_SERIES_POINTS));
      expect(result[0]).toHaveLength(6);
    });
  });

  describe('buildAiPayload', () => {
    it('builds payload with trimmed indicators and full trendline', () => {
      const signal = makeSignal();
      signal.additionalIndicators = {
        ...signal.additionalIndicators,
        trendlineTiming: {
          entryTiming: 'ready_breakout',
        },
      };
      const payload = buildAiPayload(signal);

      expect(payload.signal.symbol).toBe('ETHUSDT');
      expect(payload.signal.strategy).toBe('TrendLine');
      expect(payload.signal.prices).toEqual({
        currentPrice: 100,
        takeProfitPrice: 103,
        stopLossPrice: 99,
      });
      expect((payload.signal.prices as any).riskRatio).toBeUndefined();

      expect(payload.indicators.maFast).toEqual([3, 4, 5, 6, 7]);
      expect(payload.indicators.btcMaFast1h).toEqual([11, 12, 13, 14, 15]);
      expect(payload.indicators.nested.atrPct).toEqual([
        0.2, 0.3, 0.4, 0.5, 0.6,
      ]);
      expect(payload.indicators.candles15m).toHaveLength(MAX_AI_SERIES_POINTS);
      expect(payload.indicators.matrix).toHaveLength(MAX_AI_SERIES_POINTS);

      expect(payload.figures.trendline).toBe(signal.figures.trendLine);
      expect(payload.figures.trendline.touches).toHaveLength(6);
      expect(payload.figures.trendline.alpha).toHaveLength(6);
      expect(
        (payload.additionalIndicators as any).trendlineContext.entryTiming,
      ).toBe('ready_breakout');
    });

    it('uses default adapter for non-trendline strategies without trendline alias', () => {
      const signal = makeSignal();
      signal.strategy = 'Breakout';
      signal.figures = {
        breakoutZone: {
          level: 100,
          values: [1, 2, 3, 4, 5, 6],
        },
      };

      const payload = buildAiPayload(signal);

      expect(payload.figures.breakoutZone).toEqual({
        level: 100,
        values: [2, 3, 4, 5, 6],
      });
      expect((payload.figures as any).trendline).toBeUndefined();
    });
  });

  describe('prompt builders', () => {
    it('system prompt includes critical constraints and examples', () => {
      const prompt = buildAiSystemPrompt();

      expect(prompt).toContain(
        'Ты — внутренний классификатор структуры рынка для уже рассчитанного системного сигнала',
      );
      expect(prompt).toContain('Пиши comment по-русски');
      expect(prompt).toContain(
        'quality" — уровень структурного подтверждения текущего сигнала ИМЕННО СЕЙЧАС',
      );
      expect(prompt).toContain(
        'Никогда не предлагай противоположное направление',
      );
      expect(prompt).toContain('"needRetest": boolean');
      expect(prompt).toContain('"retestPrice": number | null');
      expect(prompt).toContain('"setup": string');
      expect(prompt).toContain('"triggerInvalidation": string');
      expect(prompt).toContain(
        'Не оптимизируй и не пересчитывай TP/SL под "лучшую сделку"',
      );
      expect(prompt).toContain('структурированному анализу');
      expect(prompt).toContain(
        'не пиши технический шаблон вроде "needRetest=false @ null"',
      );
      expect(prompt).toContain('payload.additionalIndicators');
      expect(prompt).toContain('Короткие примеры (few-shot');
      expect(prompt).toContain('Не добавляй другие поля');
      expect(prompt).not.toContain('помощник крипто-трейдера');
      expect(prompt).not.toContain('runtime-нейминг');
    });

    it('adds strategy-specific system prompt section for TrendLine', () => {
      const prompt = buildAiSystemPrompt(makeSignal());

      expect(prompt).toContain('Дополнение для trendline-сетапов');
      expect(prompt).toContain('payload.figures.trendline');
      expect(prompt).toContain('trendlineContext');
    });

    it('human prompt embeds serialized payload and concise task', () => {
      const signal = makeSignal();
      const payload = buildAiPayload(signal);
      const prompt = buildAiHumanPrompt(signal, payload);

      expect(prompt).toContain(
        'Проанализируй уже рассчитанный внутренний сигнал по ETHUSDT',
      );
      expect(prompt).toContain('Исходный сигнал имеет направление LONG');
      expect(prompt).toContain('Это задача классификации/аудита структуры');
      expect(prompt).toContain('"symbol":"ETHUSDT"');
      expect(prompt).toContain('"trendline"');
      expect(prompt).toContain('trendline.currentLinePrice=');
      expect(prompt).toContain('trendline.breakVsAtrRatio=');
      expect(prompt).toContain('trendline.strongNearBreakPressure=');
      expect(prompt).toContain('trendline.entryTiming=');
      expect(prompt).toContain('trendline.weakCleanBreak=');
      expect(prompt).toContain('trendline.weakBtcLedBreak=');
      expect(prompt).toContain('trendline.weakLongFarBreak=');
      expect(prompt).toContain('"maFast":[3,4,5,6,7]');
      expect(prompt).not.toContain('"riskRatio"');
    });

    it('builds prompt pair for dataset replay', () => {
      const prompts = buildAiPrompts(makeSignal());

      expect(prompts.systemPrompt).toContain(
        'Ты — внутренний классификатор структуры рынка',
      );
      expect(prompts.humanPrompt).toContain(
        'Проанализируй уже рассчитанный внутренний сигнал по ETHUSDT',
      );
    });

    it('falls back to additionalIndicators trendLine when figures.trendLine is missing', () => {
      const signal = makeSignal();
      const additionalTrendLine = {
        id: 'tl-ai',
        mode: 'lows',
        distance: 42,
        points: [
          { timestamp: 1, value: 99 },
          { timestamp: 2, value: 101 },
        ],
        touches: [{ timestamp: 1.5, value: 100 }],
        alpha: [0.99, 1.01],
      };
      signal.figures = {};
      signal.additionalIndicators = {
        touches: 3,
        distance: 42,
        trendLine: additionalTrendLine,
      };

      const payload = buildAiPayload(signal);
      const prompt = buildAiHumanPrompt(signal, payload);

      expect(payload.figures.trendline).toEqual(additionalTrendLine);
      expect(payload.additionalIndicators).toEqual(
        expect.objectContaining({
          trendlineContext: expect.objectContaining({
            mode: 'lows',
            touches: 3,
            distance: 42,
            currentLinePrice: 101,
            currentPrice: 100,
            priceVsLineSide: 'below',
          }),
        }),
      );
      expect(prompt).toContain('trendline.priceVsLineSide=below');
      expect(prompt).toContain('trendline.distance=42');
    });
  });

  describe('askAI', () => {
    it('replays explicit prompts via runAiPrompt', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'LONG',
          quality: 3.2,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: '101.5',
          stopLossPrice: '98.2',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt({
        systemPrompt: 'system',
        humanPrompt: 'human',
      });

      expect(chatOpenAICtorMock).toHaveBeenCalledTimes(1);
      const messages = invokeMock.mock.calls[0]?.[0] as any[];
      expect(messages[0].content).toBe('system');
      expect(messages[1].content.content[0].text).toBe('human');
      expect(result).toEqual(
        expect.objectContaining({
          direction: 'LONG',
          quality: 3,
          takeProfitPrice: 101.5,
          stopLossPrice: 98.2,
          comment: 'ok',
        }),
      );
    });

    it('applies TrendLine guardrail when signal context is provided', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'SHORT',
          quality: 5,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 96,
          stopLossPrice: 102,
          setup: 'Пробой вниз',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Сетап сильный',
          triggerInvalidation: 'Отмена при возврате выше',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeBlockedTrendlineSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 2,
          needRetest: true,
          retestPrice: 100.05,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.qualityReason).toContain('TrendLine guardrail');
      expect(result.comment).toContain('TrendLine guardrail');
    });

    it('blocks shallow BTC-led breaks without coin follow-through', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'SHORT',
          quality: 5,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 96,
          stopLossPrice: 101.2,
          setup: 'Чистый пробой вниз',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Сильный шорт',
          triggerInvalidation: 'Отмена при возврате выше',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeWeakBtcLedBreakTrendlineSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          retestPrice: 100.425,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.qualityReason).toContain(
        'пробой слишком мелкий относительно ATR',
      );
      expect(result.comment).toContain('TrendLine guardrail');
    });

    it('blocks weak clean breaks that lack displacement reserve', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'SHORT',
          quality: 5,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 96,
          stopLossPrice: 101.1,
          setup: 'Есть пробой вниз',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Чистый пробой',
          triggerInvalidation: 'Отмена при возврате выше',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeWeakCleanBreakTrendlineSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.qualityReason).toContain('слишком слабый относительно ATR');
      expect(result.comment).toContain('TrendLine guardrail');
    });

    it('blocks compressed clean breaks on short-range lines', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'SHORT',
          quality: 5,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 96,
          stopLossPrice: 101.15,
          setup: 'Есть пробой вниз',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Чистый пробой на короткой линии',
          triggerInvalidation: 'Отмена при возврате выше',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeCompressedCleanBreakTrendlineSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.qualityReason).toContain('слишком сжатым');
      expect(result.comment).toContain('TrendLine guardrail');
    });

    it('blocks weak long breaks on very long lines with weak btc support', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'LONG',
          quality: 5,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 104.5,
          stopLossPrice: 98.9,
          setup: 'Есть пробой вверх',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Чистый пробой вверх',
          triggerInvalidation: 'Отмена при возврате ниже',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeWeakLongFarBreakTrendlineSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.qualityReason).toContain(
        'для LONG пробой очень длинной линии',
      );
      expect(result.comment).toContain('TrendLine guardrail');
    });

    it('uses deterministic q5 for top-tier long breakouts even if model quality is lower', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: null,
          quality: 4,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
          setup: 'Сильный breakout вверх',
          retestPlan: 'Можно ждать ретест',
          qualityReason: 'Модель осторожна',
          triggerInvalidation: 'Отмена при возврате ниже линии',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeDeterministicQualityLongSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'LONG',
          quality: 5,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 104.5,
          stopLossPrice: 98.9,
        }),
      );
    });

    it('uses deterministic q4 for clean moderate short breakouts', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: null,
          quality: 2,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
          setup: 'Шорт можно рассмотреть',
          retestPlan: 'Ждать подтверждение',
          qualityReason: 'Модель осторожна',
          triggerInvalidation: 'Отмена при возврате выше линии',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeDeterministicQualityShortSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'SHORT',
          quality: 4,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 96,
          stopLossPrice: 101.2,
        }),
      );
    });

    it('downgrades overextended short breakouts to watch quality', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'SHORT',
          quality: 5,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 90,
          stopLossPrice: 101.2,
          setup: 'Очень сильный пробой вниз',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Пробой выглядит экстремально сильным',
          triggerInvalidation: 'Отмена при возврате выше',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeOverextendedShortTrendlineSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
    });

    it('downgrades weak allowed shorts to deterministic watch quality', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'SHORT',
          quality: 5,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 96,
          stopLossPrice: 101.2,
          setup: 'Есть пробой вниз',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Шорт выглядит сильно',
          triggerInvalidation: 'Отмена при возврате выше',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeDeterministicWatchShortSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.qualityReason).toContain('deterministic quality');
      expect(result.comment).toContain('deterministic quality');
    });

    it('upgrades strong ready-breakout shorts back to deterministic quality 4', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'SHORT',
          quality: 5,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 92,
          stopLossPrice: 101.2,
          setup: 'Есть сильный пробой вниз',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Шорт выглядит сильно',
          triggerInvalidation: 'Отмена при возврате выше',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeStrongReadyBreakoutShortSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'SHORT',
          quality: 4,
          needRetest: false,
          takeProfitPrice: 92,
          stopLossPrice: 101.2,
        }),
      );
    });

    it('keeps long follow-through setups on watch quality when only model upgrades them', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'LONG',
          quality: 5,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 103,
          stopLossPrice: 98.9,
          setup: 'Есть follow-through вверх',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Лонг выглядит хорошо',
          triggerInvalidation: 'Отмена при возврате ниже',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeFollowThroughLongTrendlineSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
    });

    it('keeps long retest setups on watch quality when only model upgrades them', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'LONG',
          quality: 5,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 103.5,
          stopLossPrice: 98.9,
          setup: 'Есть ретест и удержание над линией',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Лонг после ретеста выглядит хорошо',
          triggerInvalidation: 'Отмена при возврате ниже',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeRetestLongTrendlineSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
    });

    it('downgrades aligned ready-rejection support bounces for ReverseTrendLine', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: null,
          quality: 2,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
          setup: 'Есть отскок от линии поддержки',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Модель осторожна',
          triggerInvalidation: 'Отмена при пробое вниз',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeReverseSupportBounceLongSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
    });

    it('keeps moderate aligned resistance bounces on watch quality for ReverseTrendLine', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: null,
          quality: 2,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
          setup: 'Есть отскок вниз от сопротивления',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Модель осторожна',
          triggerInvalidation: 'Отмена при пробое вверх',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeReverseResistanceBounceShortSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
    });

    it('approves strong conflict-only support bounces for ReverseTrendLine', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: null,
          quality: 2,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
          setup: 'Есть отскок вниз от сопротивления',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Модель осторожна',
          triggerInvalidation: 'Отмена при пробое вверх',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeReverseConflictSupportBounceLongSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'LONG',
          quality: 4,
          needRetest: false,
          takeProfitPrice: 102.4,
          stopLossPrice: 99.1,
        }),
      );
    });

    it('approves scored both-conflict support bounces for ReverseTrendLine', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: null,
          quality: 2,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
          setup: 'Есть отскок от линии поддержки',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Модель осторожна',
          triggerInvalidation: 'Отмена при пробое вниз',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeReverseScoredBothSupportBounceLongSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'LONG',
          quality: 4,
          needRetest: false,
          takeProfitPrice: 102.6,
          stopLossPrice: 99.15,
        }),
      );
    });

    it('approves strong conflict-only resistance bounces for ReverseTrendLine', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: null,
          quality: 2,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
          setup: 'Есть отскок вниз от сопротивления',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Модель осторожна',
          triggerInvalidation: 'Отмена при пробое вверх',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeReverseConflictResistanceBounceShortSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'SHORT',
          quality: 4,
          needRetest: false,
          takeProfitPrice: 97.5,
          stopLossPrice: 100.8,
        }),
      );
    });

    it('keeps SHORT btc-only rejection bounces on watch quality for ReverseTrendLine', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: null,
          quality: 2,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
          setup: 'Есть отскок вниз от сопротивления',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Модель осторожна',
          triggerInvalidation: 'Отмена при пробое вверх',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeReverseBtcOnlyResistanceBounceShortSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
    });

    it('approves scored aligned resistance bounces for ReverseTrendLine', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: null,
          quality: 2,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
          setup: 'Есть отскок вниз от сопротивления',
          retestPlan: 'Можно входить сразу',
          qualityReason: 'Модель осторожна',
          triggerInvalidation: 'Отмена при пробое вверх',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeReverseScoredAlignedResistanceBounceShortSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'SHORT',
          quality: 4,
          needRetest: false,
          takeProfitPrice: 97.4,
          stopLossPrice: 100.82,
        }),
      );
    });

    it('approves aligned follow-through support bounces for ReverseTrendLine', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: null,
          quality: 2,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
          setup: 'Есть отскок от линии поддержки',
          retestPlan: 'Follow-through подтвержден',
          qualityReason: 'Модель осторожна',
          triggerInvalidation: 'Отмена при пробое вниз',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeReverseAlignedFollowThroughLongSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'LONG',
          quality: 5,
          needRetest: false,
          takeProfitPrice: 102.6,
          stopLossPrice: 99.2,
        }),
      );
    });

    it('blocks failed bounce breaks for ReverseTrendLine', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'LONG',
          quality: 5,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 102.4,
          stopLossPrice: 98.8,
          setup: 'Можно ловить отскок',
          retestPlan: 'Вход сейчас',
          qualityReason: 'Модель слишком оптимистична',
          triggerInvalidation: 'Отмена при пробое вниз',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeFailedReverseBounceLongSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 2,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.qualityReason).toContain('ReverseTrendLine guardrail');
    });

    it('allows aggressive pre-break pressure setups but caps quality to 4', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: null,
          quality: 2,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: null,
          stopLossPrice: null,
          setup: 'Агрессивное давление перед пробоем',
          retestPlan: 'Вход агрессивный',
          qualityReason: 'Сильное давление вниз',
          triggerInvalidation: 'Отмена при возврате выше',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeAggressivePreBreakTrendlineSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'SHORT',
          quality: 4,
          takeProfitPrice: 96,
          stopLossPrice: 101.3,
        }),
      );
      expect(result.qualityReason).toBe('Сильное давление вниз');
    });

    it('allows strong near-break pressure setups but caps quality to 4', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: null,
          quality: 2,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
          setup: 'Давление вниз у зрелой линии',
          retestPlan: 'Ждать ретест',
          qualityReason: 'Сильное давление вниз у линии',
          triggerInvalidation: 'Отмена при возврате выше',
          comment: 'ok',
        },
      });

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal: makeStrongNearBreakPressureTrendlineSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'SHORT',
          quality: 4,
          takeProfitPrice: 96,
          stopLossPrice: 101.3,
        }),
      );
      expect(result.qualityReason).toBe('Сильное давление вниз у линии');
    });

    it('replays confirmed VolumeDivergence entries locally without AI provider calls', async () => {
      const signal = makeVolumeDivergenceSignal();
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: true,
          deterministicQuality: 4,
          structuralHardBlockReasons: [],
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'LONG',
          quality: 4,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 104,
          stopLossPrice: 98,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('keeps unconfirmed VolumeDivergence entries in watch mode during local replay', async () => {
      const signal = makeVolumeDivergenceSignal({
        prices: {
          currentPrice: 99,
        },
      });
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 3,
          structuralHardBlockReasons: [],
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('replays VolumeDivergence structure-advance entries locally without AI provider calls', async () => {
      const signal = makeVolumeDivergenceSignal({
        prices: {
          currentPrice: 99,
        },
        indicators: {
          maFast: [99, 99.2, 99.4],
          maSlow: [100, 100.1, 100.2],
          btcMaFast: [49, 49.2, 49.4],
          btcMaSlow: [50, 50.1, 50.2],
        },
        additionalIndicators: {
          volumeDivergenceSetup: {
            atrPct: 2.1,
            divergenceAmplitudeAtrRatio: 0.7,
            reclaimPct: 150,
            confirmationCandleQuality: 0.7,
          },
          volumeDivergenceSignalTiming: {
            entryTiming: 'structure_advance',
            barsSinceDetection: 2,
          },
        },
      });
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 3,
          structuralHardBlockReasons: [],
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('keeps overheated VolumeDivergence long confirmations in watch mode during local replay', async () => {
      const signal = makeVolumeDivergenceSignal({
        additionalIndicators: {
          volumeDivergenceSetup: {
            atrPct: 2.1,
            divergenceAmplitudeAtrRatio: 2.6,
            reclaimPct: 135,
            confirmationCandleQuality: 0.74,
          },
          divergence: {
            currentPivot: {
              volumeNorm: 80,
            },
            previousPivot: {
              volumeNorm: 40,
            },
          },
        },
      });
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 3,
          volumeDivergenceRatio: 2,
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('promotes the best VolumeDivergence long q3 setups into q4 during local replay', async () => {
      const signal = makeVolumeDivergenceSignal({
        additionalIndicators: {
          volumeDivergenceSetup: {
            atrPct: 0.85,
            divergenceAmplitudeAtrRatio: 0.42,
            reclaimPct: 130,
            confirmationCandleQuality: 0.74,
            confirmationDistancePct: 0.8,
          },
          volumeDivergenceSignalTiming: {
            entryTiming: 'confirmation_ready',
            barsSinceDetection: 2,
          },
          divergence: {
            currentPivot: {
              volumeNorm: 110,
            },
            previousPivot: {
              volumeNorm: 60,
            },
          },
        },
      });
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: true,
          deterministicQuality: 4,
          volumeDivergenceRatio: 110 / 60,
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'LONG',
          quality: 4,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 104,
          stopLossPrice: 98,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('keeps immature double-conflict VolumeDivergence long confirmations in watch mode during local replay', async () => {
      const signal = makeVolumeDivergenceSignal({
        indicators: {
          maFast: [99, 99.2, 99.4],
          maSlow: [100, 100.1, 100.2],
          btcMaFast: [49, 49.2, 49.4],
          btcMaSlow: [50, 50.1, 50.2],
        },
        additionalIndicators: {
          volumeDivergenceSetup: {
            atrPct: 1.1,
            divergenceAmplitudeAtrRatio: 0.7,
            reclaimPct: 150,
            confirmationCandleQuality: 0.72,
            confirmationDistancePct: 0.5,
          },
          volumeDivergenceSignalTiming: {
            entryTiming: 'confirmation_ready',
            barsSinceDetection: 1,
          },
        },
      });
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          coinBiasAligned: false,
          btcBiasAligned: false,
          confirmationDistancePct: 0.5,
          deterministicQuality: 3,
          approvalAllowedNow: false,
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('still approves mature counter-trend VolumeDivergence long confirmations during local replay', async () => {
      const signal = makeVolumeDivergenceSignal({
        indicators: {
          maFast: [99, 99.2, 99.4],
          maSlow: [100, 100.1, 100.2],
          btcMaFast: [49, 49.2, 49.4],
          btcMaSlow: [50, 50.1, 50.2],
        },
        additionalIndicators: {
          deltaAtPivot: -40,
          volumeDivergenceSetup: {
            atrPct: 0.8,
            divergenceAmplitudeAtrRatio: 0.55,
            reclaimPct: 132,
            confirmationCandleQuality: 0.74,
            confirmationDistancePct: 0.8,
          },
          volumeDivergenceSignalTiming: {
            entryTiming: 'confirmation_ready',
            barsSinceDetection: 3,
          },
          divergence: {
            currentPivot: {
              volumeNorm: 110,
            },
            previousPivot: {
              volumeNorm: 50,
            },
          },
        },
      });
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          coinBiasAligned: false,
          btcBiasAligned: false,
          deltaAligned: false,
          confirmationDistancePct: 0.8,
          volumeDivergenceRatio: 2.2,
          deterministicQuality: 4,
          approvalAllowedNow: true,
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'LONG',
          quality: 4,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 104,
          stopLossPrice: 98,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('reuses cached settings and model for repeated prompt calls', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'LONG',
          quality: 4,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 101.5,
          stopLossPrice: 98.2,
          comment: 'ok',
        },
      });

      await runAiPrompt({
        systemPrompt: 'system-1',
        humanPrompt: 'human-1',
      });
      await runAiPrompt({
        systemPrompt: 'system-2',
        humanPrompt: 'human-2',
      });

      expect(getUserSettingsMock).toHaveBeenCalledTimes(1);
      expect(chatOpenAICtorMock).toHaveBeenCalledTimes(1);
      expect(invokeMock).toHaveBeenCalledTimes(2);
    });

    it('creates a separate client when model override changes', async () => {
      invokeMock.mockResolvedValue({
        content: {
          direction: 'LONG',
          quality: 4,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 101.5,
          stopLossPrice: 98.2,
          comment: 'ok',
        },
      });

      await runAiPrompt(
        {
          systemPrompt: 'system-1',
          humanPrompt: 'human-1',
        },
        {
          model: 'openai/gpt-5-mini',
        },
      );
      await runAiPrompt(
        {
          systemPrompt: 'system-2',
          humanPrompt: 'human-2',
        },
        {
          model: 'anthropic/claude-sonnet-4.5',
        },
      );

      expect(chatOpenAICtorMock).toHaveBeenCalledTimes(2);
      expect(chatOpenAICtorMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          modelName: 'openai/gpt-5-mini',
        }),
      );
      expect(chatOpenAICtorMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          modelName: 'anthropic/claude-sonnet-4.5',
        }),
      );
    });

    it('normalizes object content and persists analysis to redis', async () => {
      getUserSettingsMock.mockResolvedValueOnce({
        userName: 'root',
        BYBIT_API_KEY: '',
        BYBIT_API_SECRET: '',
        token: '',
        COINALYZE_API_KEY: '',
        OPENAI_API_KEY: 'key_123',
        OPENAI_API_ENDPOINT: 'https://openrouter.example/v1',
        TG_BOT_TOKEN: 'tg-token',
        TG_CHAT_ID: 'tg-chat-id',
      });

      invokeMock.mockResolvedValue({
        content: {
          direction: 'LONG',
          quality: 4.6,
          needRetest: 'yes',
          retestPrice: '101.25',
          takeProfitPrice: 104.5,
          stopLossPrice: '98.9',
          setup: 's'.repeat(500),
          confirmations: 'confirm',
          btcContext: 'btc',
          retestPlan: 'plan',
          riskLevels: 'risk',
          qualityReason: 'reason',
          triggerInvalidation: 'invalidate',
          comment: 'c'.repeat(1500),
        },
      });

      const signal = makeSignal();
      signal.strategy = 'Breakout';
      const result = await askAI(signal);

      expect(chatOpenAICtorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.2,
          modelName: 'openai/gpt-5-mini',
          apiKey: 'key_123',
          modelKwargs: {
            provider: {
              ignore: ['azure'],
            },
          },
          configuration: expect.objectContaining({
            baseURL: 'https://openrouter.example/v1',
          }),
        }),
      );
      expect(invokeMock).toHaveBeenCalledTimes(1);

      const messages = invokeMock.mock.calls[0]?.[0] as any[];
      expect(messages).toHaveLength(2);
      expect(messages[0]).toBeInstanceOf(MockSystemMessage);
      expect(messages[1]).toBeInstanceOf(MockHumanMessage);
      expect(messages[1].content.content[0].text).toContain(
        'Проанализируй уже рассчитанный внутренний сигнал по ETHUSDT',
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'LONG',
          quality: 5,
          needRetest: true,
          retestPrice: 101.25,
          takeProfitPrice: 104.5,
          stopLossPrice: 98.9,
          comment: 'c'.repeat(1024),
        }),
      );
      expect(result.setup).toHaveLength(400);

      expect(analysisKeyMock).toHaveBeenCalledWith('ETHUSDT', 'sig-1');
      expect(setDataMock).toHaveBeenCalledWith(
        'analysis:ETHUSDT:sig-1',
        expect.objectContaining({
          direction: 'LONG',
          quality: 5,
        }),
      );
    });

    it('builds OpenRouter provider preferences only for OpenRouter endpoints', () => {
      expect(getOpenRouterModelKwargs('https://openrouter.ai/api/v1')).toEqual({
        provider: {
          ignore: ['azure'],
        },
      });

      expect(getOpenRouterModelKwargs('https://api.openai.com/v1')).toEqual({});
    });

    it('extracts JSON from array text response and parses numeric strings', async () => {
      invokeMock.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: [
              'prefix',
              '{"direction":"SHORT","quality":0,"needRetest":false,',
              '"retestPrice":"abc","takeProfitPrice":"120.5","stopLossPrice":"130",',
              '"setup":"setup","confirmations":"conf","btcContext":"ctx",',
              '"retestPlan":"plan","riskLevels":"risk","qualityReason":"q",',
              '"triggerInvalidation":"ti","comment":"ok"}',
              'suffix',
            ].join(' '),
          },
        ],
      });

      const signal = makeSignal();
      signal.strategy = 'Breakout';
      const result = await askAI(signal);

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'SHORT',
          quality: 1,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: 120.5,
          stopLossPrice: 130,
          comment: 'ok',
        }),
      );
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('returns safe defaults when model response has no JSON block', async () => {
      invokeMock.mockResolvedValue({
        content: 'no json here',
      });

      const signal = makeSignal();
      signal.strategy = 'Breakout';
      const result = await askAI(signal);

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: undefined,
          needRetest: false,
          retestPrice: null,
          takeProfitPrice: null,
          stopLossPrice: null,
          comment: '',
        }),
      );
      expect(errorSpy).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith('🔍 Исходный текст:', 'no json here');
    });

    it('handles invalid json block and non-text array parts', async () => {
      invokeMock.mockResolvedValue({
        content: [{ image_url: 'x' }, { text: '```json { invalid } ```' }],
      });

      const signal = makeSignal();
      signal.strategy = 'Breakout';
      const result = await askAI(signal);

      expect(result.direction).toBeNull();
      expect(result.comment).toBe('');
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
