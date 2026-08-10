const invokeMock = jest.fn();
const chatOpenAICtorMock = jest.fn();
const setDataMock = jest.fn();
const getUserSettingsMock = jest.fn(async (userName = 'root') => ({
  userName,
  BYBIT_API_KEY: '',
  BYBIT_API_SECRET: '',
  COINALYZE_API_KEY: '',
  AI_API_KEY: 'key_123',
  AI_API_ENDPOINT: 'https://api.openai.com/v1',
  AI_MODEL: 'gpt-5-mini',
  AI_RESPONSE_LANGUAGE: 'en',
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
  buildCompactAiIndicatorsSnapshot,
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

const getLastFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  for (let i = value.length - 1; i >= 0; i -= 1) {
    const current = value[i];
    if (typeof current === 'number' && Number.isFinite(current)) {
      return current;
    }
  }

  return null;
};

const withBaseContext = (signal: any) => {
  const indicators = signal?.indicators ?? {};
  const additionalIndicators = signal?.additionalIndicators ?? {};
  const existingBaseContext = additionalIndicators.baseContext ?? {};
  const existingRaw = existingBaseContext.raw ?? {};
  const existingCrossAsset = existingRaw.crossAsset ?? {};
  const existingRelative = existingBaseContext.relative ?? {};
  const existingExecution = existingRelative.execution ?? {};
  const existingTargetVsBtc = existingRelative.targetVsBtc ?? {};
  const existingDerivatives = existingBaseContext.derivatives;
  const setupAtrPct =
    additionalIndicators.volumeDivergenceSetup?.atrPct ??
    additionalIndicators.baseContext?.raw?.volatility?.atrPct;
  const atrPct = getLastFiniteNumber(indicators.atrPct) ?? setupAtrPct ?? null;
  const maFast = getLastFiniteNumber(indicators.maFast);
  const maSlow = getLastFiniteNumber(indicators.maSlow);
  const btcMaFast =
    getLastFiniteNumber(indicators.btcMaFast) ??
    getLastFiniteNumber(indicators.btcMaFast1h);
  const btcMaSlow =
    getLastFiniteNumber(indicators.btcMaSlow) ??
    getLastFiniteNumber(indicators.btcMaSlow1h);
  const btcCorrelation =
    getLastFiniteNumber(indicators.correlation) ??
    existingCrossAsset.btcCorrelation ??
    null;
  const venueSpread =
    getLastFiniteNumber(indicators.spread) ??
    existingExecution.venueSpread ??
    null;

  return {
    ...signal,
    additionalIndicators: {
      ...additionalIndicators,
      baseContext: {
        ...existingBaseContext,
        regime: {
          ...(existingBaseContext.regime ?? {}),
          session: {
            sessionPhase: 'off_hours',
            isOverlap: false,
            minutesFromSessionOpen: null,
            minutesToFundingWindow: 60,
            fundingWindowNearby: true,
            ...((existingBaseContext.regime?.session as Record<
              string,
              unknown
            >) ?? {}),
          },
        },
        raw: {
          ...existingRaw,
          trend: {
            ...(existingRaw.trend ?? {}),
            maFast,
            maSlow,
          },
          volatility: {
            ...(existingRaw.volatility ?? {}),
            atrPct,
          },
          crossAsset: {
            ...existingCrossAsset,
            btcCorrelation,
          },
        },
        relative: {
          ...existingRelative,
          benchmark: {
            ...(existingRelative.benchmark ?? {}),
            maFast: btcMaFast,
            maSlow: btcMaSlow,
          },
          execution: {
            ...(existingExecution as Record<string, unknown>),
            venueSpread,
            venueSpreadZScore: existingExecution.venueSpreadZScore ?? 1.4,
          },
          targetVsBtc: {
            ...(existingTargetVsBtc as Record<string, unknown>),
            alphaVsBtc1h: existingTargetVsBtc.alphaVsBtc1h ?? 3.4,
            alphaVsBtc4h: existingTargetVsBtc.alphaVsBtc4h ?? 4.2,
            alphaVsBtc24h: existingTargetVsBtc.alphaVsBtc24h ?? 8,
            ratioTrend: existingTargetVsBtc.ratioTrend ?? 'up',
          },
        },
        derivatives: existingDerivatives,
      },
    },
  };
};

const withTrendlineQ4ReferenceConfirmation = (signal: any) => {
  const additionalIndicators = signal.additionalIndicators ?? {};
  const baseContext = additionalIndicators.baseContext ?? {};
  const participation = baseContext.participation ?? {};
  const derivatives = baseContext.derivatives ?? {};
  const referenceContexts = derivatives.referenceContexts ?? {};
  const ethReference = referenceContexts.ETHUSDT ?? {};

  signal.additionalIndicators = {
    ...additionalIndicators,
    baseContext: {
      ...baseContext,
      participation: {
        ...participation,
        volumeStructure: {
          ...(participation.volumeStructure ?? {}),
          pocIndex: 5,
        },
      },
      derivatives: {
        ...derivatives,
        referenceContexts: {
          ...referenceContexts,
          ETHUSDT: {
            ...ethReference,
            summary: {
              ...(ethReference.summary ?? {}),
              oiAcceleration: -0.7,
            },
          },
        },
      },
    },
  };

  return signal;
};

const withTrendlineMarketContextApproval = (signal: any) => {
  const additionalIndicators = signal.additionalIndicators ?? {};
  const baseContext = additionalIndicators.baseContext ?? {};
  const regime = baseContext.regime ?? {};
  const relative = baseContext.relative ?? {};
  const gateFeatures = baseContext.gateFeatures ?? {};

  signal.additionalIndicators = {
    ...additionalIndicators,
    baseContext: {
      ...baseContext,
      regime: {
        ...regime,
        trend: {
          ...(regime.trend ?? {}),
          persistence: 0.7,
        },
      },
      relative: {
        ...relative,
        cmcGlobal: {
          ...(relative.cmcGlobal ?? {}),
          totalMarketCapUsd: 2_330_000_000_000,
        },
      },
      gateFeatures: {
        ...gateFeatures,
        decisionHints: {
          ...(gateFeatures.decisionHints ?? {}),
          primaryIssue: 'market_context_against',
        },
      },
    },
  };

  return signal;
};

const makeSignal = () =>
  withBaseContext({
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
      spread: [0.0008, 0.001, 0.0012],
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
    additionalIndicators: {
      baseContext: {
        regime: {
          session: {
            sessionPhase: 'us',
            isOverlap: true,
            minutesFromSessionOpen: 90,
            minutesToFundingWindow: 90,
            fundingWindowNearby: false,
          },
        },
      },
    },
  } as any);

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
  return withBaseContext(signal);
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
  return withBaseContext(signal);
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
  return withBaseContext(signal);
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

  return withBaseContext({
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
  } as any);
};

const makeAdaptiveMomentumRibbonSignal = (
  overrides: Record<string, any> = {},
) => {
  const base = {
    signalId: 'amr-1',
    symbol: 'TESTUSDT',
    strategy: 'AdaptiveMomentumRibbon',
    interval: '15',
    direction: 'LONG',
    timestamp: 1_700_000_000_000,
    figures: {},
    prices: {
      currentPrice: 100.8,
      takeProfitPrice: 103,
      stopLossPrice: 99.7,
      riskRatio: 2,
    },
    indicators: {
      maFast: [100, 100.4, 100.7],
      maSlow: [99.9, 100.1, 100.3],
      btcMaFast: [50, 50.2, 50.5],
      btcMaSlow: [49.9, 50.0, 50.1],
    },
    additionalIndicators: {
      amr: {
        entryLong: 1,
        entryShort: 0,
        invalidated: 0,
        activeBuy: 1,
        activeSell: 0,
        signalOsc: 1.6,
        kcMidline: 100.2,
        kcUpper: 100.7,
        kcLower: 99.7,
        invalidationLevel: 99.9,
      },
      amrSignalTiming: {
        entryTiming: 'zero_cross',
        waitClose: true,
        confirmOnNextBar: true,
        lookbackBars: 200,
      },
      amrConfigSnapshot: {
        momentumPeriod: 32,
        butterworthSmoothing: 4,
        minSignalOscAbs: 0.55,
        requireKcBias: true,
        minBarsBetweenSignals: 12,
        kcLength: 20,
        atrLength: 14,
        atrMultiplier: 2,
      },
      baseContext: {
        regime: {
          trend: {
            adx: {
              adx: 18,
            },
          },
        },
        relative: {
          benchmark: {
            relativeStrength1d: 0,
          },
        },
        gateFeatures: {
          setup: {
            tpDistanceAtr: 3,
          },
        },
        participation: {
          volume: {
            volumeRel20: 1,
            effortVsResult: 80,
          },
        },
        derivatives: {
          summary: {
            directionAligned: true,
            riskFlags: [],
          },
          intervals: {
            '15m': {
              fundingZScore: 0.2,
            },
          },
        },
      },
    },
  };

  return withBaseContext({
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
      amr: {
        ...base.additionalIndicators.amr,
        ...overrides.additionalIndicators?.amr,
      },
      amrSignalTiming: {
        ...base.additionalIndicators.amrSignalTiming,
        ...overrides.additionalIndicators?.amrSignalTiming,
      },
      amrConfigSnapshot: {
        ...base.additionalIndicators.amrConfigSnapshot,
        ...overrides.additionalIndicators?.amrConfigSnapshot,
      },
      baseContext: {
        ...base.additionalIndicators.baseContext,
        ...overrides.additionalIndicators?.baseContext,
        derivatives: {
          ...base.additionalIndicators.baseContext.derivatives,
          ...overrides.additionalIndicators?.baseContext?.derivatives,
          summary: {
            ...base.additionalIndicators.baseContext.derivatives.summary,
            ...overrides.additionalIndicators?.baseContext?.derivatives
              ?.summary,
          },
          intervals: {
            ...base.additionalIndicators.baseContext.derivatives.intervals,
            ...overrides.additionalIndicators?.baseContext?.derivatives
              ?.intervals,
            '15m': {
              ...base.additionalIndicators.baseContext.derivatives.intervals[
                '15m'
              ],
              ...overrides.additionalIndicators?.baseContext?.derivatives
                ?.intervals?.['15m'],
            },
          },
        },
      },
    },
  } as any);
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
  return withBaseContext(signal);
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
  return withBaseContext(signal);
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
  return withBaseContext(signal);
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
  return withBaseContext(signal);
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
    baseContext: {
      relative: {
        execution: {
          venueSpreadZScore: -1.2,
        },
      },
    },
  };
  return withBaseContext(signal);
};

const makeAlignedRecentLongTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'LONG';
  signal.prices.currentPrice = 100.56;
  signal.prices.takeProfitPrice = 104.5;
  signal.prices.stopLossPrice = 98.9;
  signal.figures.trendLine = {
    ...signal.figures.trendLine,
    mode: 'highs',
    points: [
      { timestamp: 1, value: 101.3 },
      { timestamp: 2, value: 100 },
    ],
    touches: [
      { timestamp: 1, value: 101.2 },
      { timestamp: 1.2, value: 100.95 },
      { timestamp: 1.4, value: 100.7 },
      { timestamp: 1.6, value: 100.35 },
      { timestamp: 1.8, value: 100.1 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [99.9, 100.2, 100.45],
    maSlow: [99.8, 99.95, 100],
    btcMaFast: [100.1, 100.45, 100.75],
    btcMaSlow: [100, 100.05, 100],
    atrPct: [0.9],
  };
  signal.additionalIndicators = {
    touches: 5,
    distance: 370,
    baseContext: {
      relative: {
        execution: {
          venueSpreadZScore: -1.2,
        },
      },
    },
    trendlineTiming: {
      entryTiming: 'ready_follow_through',
    },
  };
  return withBaseContext(signal);
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
  return withBaseContext(signal);
};

const makeModerateReadyBreakoutShortTrendlineSignal = () => {
  const signal = makeSignal();
  signal.direction = 'SHORT';
  signal.prices.currentPrice = 99.25;
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
      { timestamp: 1, value: 100.85 },
      { timestamp: 1.2, value: 100.65 },
      { timestamp: 1.4, value: 100.4 },
      { timestamp: 1.6, value: 100.2 },
      { timestamp: 1.8, value: 100.05 },
    ],
  };
  signal.indicators = {
    ...signal.indicators,
    maFast: [100.4, 100.1, 99.65],
    maSlow: [100.5, 100.25, 100],
    btcMaFast: [100.1, 100, 99.9],
    btcMaSlow: [100.15, 100.05, 100],
    atrPct: [1],
  };
  signal.additionalIndicators = {
    touches: 5,
    distance: 220,
    trendlineTiming: {
      entryTiming: 'ready_breakout',
    },
  };
  return withBaseContext(signal);
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
  return withBaseContext(signal);
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
  return withBaseContext(signal);
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
  return withBaseContext(signal);
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
  return withBaseContext(signal);
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
  return withBaseContext(signal);
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
  return withBaseContext(signal);
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
  return withBaseContext(signal);
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
    distance: 145,
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
  return withBaseContext(signal);
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
  return withBaseContext(signal);
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
  return withBaseContext(signal);
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
    distance: 220,
    currentCandle: {
      timestamp: 2,
      open: 100.1,
      close: 99.35,
      high: 100.56,
      low: 99.28,
    },
    reverseTrendlineTiming: {
      entryTiming: 'ready_rejection',
    },
  };
  signal.prices.currentPrice = 99.35;
  signal.prices.takeProfitPrice = 97.5;
  signal.prices.stopLossPrice = 100.8;
  return withBaseContext(signal);
};

const makeReverseWeakConflictResistanceBounceShortSignal = () => {
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
  return withBaseContext(signal);
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
  return withBaseContext(signal);
};

const makeReverseEliteBtcOnlyResistanceBounceShortSignal = () => {
  const signal = makeReverseBtcOnlyResistanceBounceShortSignal();
  signal.additionalIndicators = {
    ...signal.additionalIndicators,
    touches: 5,
    distance: 120,
    currentCandle: {
      timestamp: 2,
      open: 100.06,
      close: 98.95,
      high: 100.72,
      low: 98.88,
    },
    reverseTrendlineTiming: {
      entryTiming: 'ready_rejection',
    },
  };
  signal.prices.currentPrice = 98.95;
  signal.prices.takeProfitPrice = 97.2;
  signal.prices.stopLossPrice = 100.82;
  return withBaseContext(signal);
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
    distance: 145,
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
  return withBaseContext(signal);
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
  return withBaseContext(signal);
};

describe('ai helpers', () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const originalProjectCwd = process.env.PROJECT_CWD;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROJECT_CWD = '/tmp/tradejs-ai-test';
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
    if (originalProjectCwd === undefined) {
      delete process.env.PROJECT_CWD;
    } else {
      process.env.PROJECT_CWD = originalProjectCwd;
    }
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

  describe('buildCompactAiIndicatorsSnapshot', () => {
    it('uses compact snapshot hook without enumerating proxy keys', () => {
      const compactSnapshot = jest.fn(() => ({
        maFast: [3, 4, 5],
        baseContext: { raw: { trend: { maFast: 5 } } },
      }));
      const indicators = new Proxy(
        {},
        {
          get(_target, prop) {
            if (
              prop === Symbol.for('tradejs.indicators.compactSnapshot') ||
              prop === '__tradejsCompactIndicatorsSnapshot'
            ) {
              return compactSnapshot;
            }
            return undefined;
          },
          ownKeys() {
            throw new Error('ownKeys should not be used for compact snapshot');
          },
        },
      );

      const result = buildCompactAiIndicatorsSnapshot(indicators);

      expect(result).toEqual({
        maFast: [3, 4, 5],
        baseContext: { raw: { trend: { maFast: 5 } } },
      });
      expect(compactSnapshot).toHaveBeenCalledWith({
        limit: MAX_AI_SERIES_POINTS,
      });
    });
  });

  describe('buildAiPayload', () => {
    it('builds payload with trimmed indicators and full trendline', () => {
      const signal = makeSignal();
      signal.timestamp = Date.UTC(2026, 0, 1, 14, 30);
      signal.indicators.spread = [0.0001, null, 0.0012];
      signal.additionalIndicators = {
        ...signal.additionalIndicators,
        baseContext: {
          ...signal.additionalIndicators.baseContext,
          relative: {
            ...signal.additionalIndicators.baseContext.relative,
            cmcGlobal: {
              source: 'coinmarketcap_global',
              interval: '1d',
              asOfTs: Date.UTC(2026, 0, 1),
              stale: false,
              totalMarketCapUsd: 2_600_000_000_000,
              totalVolumeUsd: 120_000_000_000,
              totalVolumeReportedUsd: 110_000_000_000,
              altMarketCapUsd: 1_200_000_000_000,
              altVolumeUsd: 55_000_000_000,
              altVolumeReportedUsd: 50_000_000_000,
              btcDominancePct: 54.5,
              ethDominancePct: 17.2,
              btcDominanceChange24hPct: -0.4,
              ethDominanceChange24hPct: 0.2,
              altMarketCapChange24hPct: 0.018,
              altVolumeChange24hPct: 0.12,
              activeCryptocurrencies: 14_000,
              activeExchanges: 780,
              activeMarketPairs: 120_000,
              altLiquidityRegime: 'alt_friendly',
            },
            cmcReferenceAssets: {
              source: 'coinmarketcap_reference_asset',
              interval: '1d',
              asOfTs: Date.UTC(2026, 0, 1),
              stale: false,
              btcMarketCapUsd: 1_400_000_000_000,
              ethMarketCapUsd: 450_000_000_000,
              btcVolumeUsd: 45_000_000_000,
              ethVolumeUsd: 24_000_000_000,
              btcVolumeToMarketCap: 0.032,
              ethVolumeToMarketCap: 0.053,
              ethBtcMarketCapRatio: 0.321,
              ethBtcMarketCapRatioChange24hPct: 0.014,
              ethVsBtcVolumeRatio: 0.533,
              referenceLiquidityRegime: 'eth_led',
            },
            cmcExchangeLiquidity: {
              source: 'coinmarketcap_exchange_liquidity',
              interval: '1d',
              asOfTs: Date.UTC(2026, 0, 1),
              stale: false,
              exchangesCount: 5,
              totalVolumeUsd: 80_000_000_000,
              totalVolumeChange24hPct: 0.18,
              binanceVolumeUsd: 36_000_000_000,
              binanceVolumeShare: 0.45,
              topExchangeVolumeShare: 0.45,
              liquidityRegime: 'expanding',
            },
            cmcFearGreed: {
              source: 'coinmarketcap_fear_greed',
              interval: '1d',
              asOfTs: Date.UTC(2026, 0, 1),
              stale: false,
              value: 62,
              valueChange24h: 8,
              valueChange7d: 15,
              classification: 'Greed',
              sentimentRegime: 'risk_on',
            },
            cmcIndexes: {
              source: 'coinmarketcap_index',
              interval: '1d',
              asOfTs: Date.UTC(2026, 0, 1),
              stale: false,
              cmc100Value: 240,
              cmc100Change24hPct: 0.01,
              cmc100TopConstituentSymbol: 'BTC',
              cmc100TopConstituentWeightPct: 64.2,
              cmc20Value: 260,
              cmc20Change24hPct: 0.024,
              cmc20TopConstituentSymbol: 'BTC',
              cmc20TopConstituentWeightPct: 72.4,
              cmc20ToCmc100Ratio: 260 / 240,
              cmc20ToCmc100RatioChange24hPct: 0.014,
              indexRegime: 'top20_led',
            },
            execution: {
              ...signal.additionalIndicators.baseContext.relative.execution,
              venueSpread: 0.0012,
            },
          },
        },
        trendlineTiming: {
          entryTiming: 'ready_breakout',
        },
      };
      withTrendlineQ4ReferenceConfirmation(signal);
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
      expect((payload.additionalIndicators as any).marketContext).toMatchObject(
        {
          execution: {
            binanceCoinbaseSpread: {
              source:
                'payload.additionalIndicators.baseContext.relative.execution.venueSpread',
              indicatorKey:
                'payload.additionalIndicators.baseContext.relative.execution.venueSpread',
              available: true,
              value: 0.0012,
              zScore: 1.4,
              bps: 12,
              absBps: 12,
              bias: 'coinbase_premium',
              severity: 'elevated',
            },
          },
          relative: {
            cmcGlobal: {
              source: 'coinmarketcap_global',
              available: true,
              interval: '1d',
              asOfTs: Date.UTC(2026, 0, 1),
              stale: false,
              altLiquidityRegime: 'alt_friendly',
              ethDominancePct: 17.2,
              altVolumeChange24hPct: 0.12,
              activeMarketPairs: 120_000,
            },
            cmcReferenceAssets: {
              source: 'coinmarketcap_reference_asset',
              available: true,
              interval: '1d',
              asOfTs: Date.UTC(2026, 0, 1),
              stale: false,
              ethBtcMarketCapRatioChange24hPct: 0.014,
              ethVsBtcVolumeRatio: 0.533,
              referenceLiquidityRegime: 'eth_led',
            },
            cmcExchangeLiquidity: {
              source: 'coinmarketcap_exchange_liquidity',
              available: true,
              totalVolumeChange24hPct: 0.18,
              liquidityRegime: 'expanding',
            },
            cmcFearGreed: {
              source: 'coinmarketcap_fear_greed',
              available: true,
              value: 62,
              valueChange24h: 8,
              valueChange7d: 15,
              classification: 'Greed',
              sentimentRegime: 'risk_on',
            },
            cmcIndexes: {
              source: 'coinmarketcap_index',
              available: true,
              interval: '1d',
              asOfTs: Date.UTC(2026, 0, 1),
              stale: false,
              cmc100Value: 240,
              cmc100Change24hPct: 0.01,
              cmc100TopConstituentSymbol: 'BTC',
              cmc100TopConstituentWeightPct: 64.2,
              cmc20Value: 260,
              cmc20Change24hPct: 0.024,
              cmc20TopConstituentSymbol: 'BTC',
              cmc20TopConstituentWeightPct: 72.4,
              cmc20ToCmc100Ratio: 260 / 240,
              cmc20ToCmc100RatioChange24hPct: 0.014,
              indexRegime: 'top20_led',
            },
          },
        },
      );
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
        'You are an internal market-structure classifier for an already computed system signal',
      );
      expect(prompt).toContain(
        'Write all user-visible text fields in the requested response language',
      );
      expect(prompt).toContain(
        '`quality` is the structural confirmation level of the current signal right now',
      );
      expect(prompt).toContain('Never propose the opposite direction');
      expect(prompt).toContain('"needRetest": boolean');
      expect(prompt).toContain('"retestPrice": number | null');
      expect(prompt).toContain('"setup": string');
      expect(prompt).toContain('"triggerInvalidation": string');
      expect(prompt).toContain(
        'Do not optimize or recalculate TP/SL for a "better trade"',
      );
      expect(prompt).toContain('Requirements for useful structured analysis');
      expect(prompt).toContain(
        'avoid technical placeholders like `needRetest=false @ null`',
      );
      expect(prompt).toContain('payload.additionalIndicators');
      expect(prompt).toContain('payload.additionalIndicators.baseContext');
      expect(prompt).toContain('marketContext.execution.binanceCoinbaseSpread');
      expect(prompt).toContain('marketContext.relative.cmcGlobal');
      expect(prompt).toContain('marketContext.relative.cmcReferenceAssets');
      expect(prompt).toContain('marketContext.relative.cmcExchangeLiquidity');
      expect(prompt).toContain('marketContext.relative.cmcFearGreed');
      expect(prompt).toContain('marketContext.relative.cmcIndexes');
      expect(prompt).toContain('Short few-shot examples');
      expect(prompt).toContain('Do not add any other fields');
      expect(prompt).not.toContain('помощник крипто-трейдера');
      expect(prompt).not.toContain('runtime-нейминг');
    });

    it('adds strategy-specific system prompt section for TrendLine', () => {
      const prompt = buildAiSystemPrompt(makeSignal());

      expect(prompt).toContain('TrendLine addon');
      expect(prompt).toContain('payload.figures.trendline');
      expect(prompt).toContain('trendlineContext');
    });

    it('human prompt embeds serialized payload and concise task', () => {
      const signal = makeSignal();
      const payload = buildAiPayload(signal);
      const prompt = buildAiHumanPrompt(signal, payload);

      expect(prompt).toContain(
        'Analyze the already computed internal signal for ETHUSDT',
      );
      expect(prompt).toContain('The original signal direction is LONG');
      expect(prompt).toContain(
        'This is a structure-classification and audit task',
      );
      expect(prompt).toContain('"symbol":"ETHUSDT"');
      expect(prompt).toContain('"trendline"');
      expect(prompt).toContain('trendline.currentLinePrice=');
      expect(prompt).toContain('trendline.breakVsAtrRatio=');
      expect(prompt).toContain('trendline.strongNearBreakPressure=');
      expect(prompt).toContain('trendline.entryTiming=');
      expect(prompt).toContain('trendline.marketContextApprovalPocket=');
      expect(prompt).toContain('trendline.gatePrimaryIssue=');
      expect(prompt).toContain('trendline.weakCleanBreak=');
      expect(prompt).toContain('trendline.weakBtcLedBreak=');
      expect(prompt).toContain('trendline.weakLongFarBreak=');
      expect(prompt).toContain('"maFast":[3,4,5,6,7]');
      expect(prompt).not.toContain('"riskRatio"');
    });

    it('builds prompt pair for dataset replay', () => {
      const prompts = buildAiPrompts(makeSignal());

      expect(prompts.systemPrompt).toContain(
        'You are an internal market-structure classifier',
      );
      expect(prompts.humanPrompt).toContain(
        'Analyze the already computed internal signal for ETHUSDT',
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
    it('reports an empty provider completion explicitly', async () => {
      invokeMock.mockRejectedValue(
        new TypeError(
          "Cannot read properties of undefined (reading 'message')",
        ),
      );

      await expect(
        runAiPrompt({
          systemPrompt: 'system',
          humanPrompt: 'human',
        }),
      ).rejects.toThrow('AI provider returned an empty chat completion');
    });

    it('rejects an empty provider response before parsing it', async () => {
      invokeMock.mockResolvedValue({ content: '' });

      await expect(
        runAiPrompt({
          systemPrompt: 'system',
          humanPrompt: 'human',
        }),
      ).rejects.toThrow('AI provider returned an empty chat completion');
    });

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
      expect(messages[1].content).toContain(
        'Write all user-visible text fields in English',
      );
      expect(messages[2].content.content[0].text).toBe('human');
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
        'the breakout is too small relative to ATR',
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
      expect(result.qualityReason).toContain('too weak relative to ATR');
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
      expect(result.qualityReason).toContain('too compressed');
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
        'for LONG, the breakout of the very long line',
      );
      expect(result.comment).toContain('TrendLine guardrail');
    });

    it('keeps top-tier TrendLine long breakouts in watch mode without the market-context pocket', async () => {
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
          direction: null,
          quality: 5,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
    });

    it('keeps clean moderate TrendLine short breakouts in watch mode without the market-context pocket', async () => {
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
          signal: withTrendlineQ4ReferenceConfirmation(
            makeModerateReadyBreakoutShortTrendlineSignal(),
          ),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 4,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
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

    it('keeps strong ready-breakout shorts in watch mode without the market-context pocket', async () => {
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
          signal: withTrendlineQ4ReferenceConfirmation(
            makeStrongReadyBreakoutShortSignal(),
          ),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 4,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
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

    it('keeps lower-score conflict-only support bounces on watch for ReverseTrendLine', async () => {
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
          direction: null,
          quality: 4,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.qualityReason).toContain('rejection score');
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

    it('keeps lower-score conflict-only resistance bounces on watch for ReverseTrendLine', async () => {
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
          direction: null,
          quality: 4,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.qualityReason).toContain('rejection score');
    });

    it('keeps shallow short conflict-only resistance bounces on watch quality for ReverseTrendLine', async () => {
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
          signal: makeReverseWeakConflictResistanceBounceShortSignal(),
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

    it('keeps elite but lower-score SHORT btc-only rejection bounces on watch for ReverseTrendLine', async () => {
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
          signal: makeReverseEliteBtcOnlyResistanceBounceShortSignal(),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 4,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.qualityReason).toContain('rejection score');
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

    it('approves narrowed extreme-volatility recovery pockets for ReverseTrendLine', async () => {
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

      const signal = makeReverseSupportBounceLongSignal();
      signal.additionalIndicators = {
        ...signal.additionalIndicators,
        baseContext: {
          ...signal.additionalIndicators.baseContext,
          gateFeatures: {
            decisionHints: {
              approveBias: 'reject',
              primaryIssue: 'extreme_volatility',
            },
          },
          regime: {
            ...signal.additionalIndicators.baseContext.regime,
            momentum: {
              upCloseStreak: 2,
            },
            trend: {
              adaptiveChannel: {
                flipUp: false,
              },
            },
            volatility: {
              atrPctZScore: 3,
              percentiles: {
                atrPctRank100: 99,
              },
            },
          },
          derivatives: {
            summary: {
              riskFlags: [],
            },
          },
        },
      };

      const result = await runAiPrompt(
        {
          systemPrompt: 'system',
          humanPrompt: 'human',
        },
        {
          signal,
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

    it('keeps aligned follow-through support bounces on watch without the strict lane for ReverseTrendLine', async () => {
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
          direction: null,
          quality: 5,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.qualityReason).toContain('rejection score');
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

    it('keeps aggressive pre-break pressure setups in watch mode without the market-context pocket', async () => {
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
          signal: withTrendlineQ4ReferenceConfirmation(
            makeAggressivePreBreakTrendlineSignal(),
          ),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 4,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.qualityReason).toContain('TrendLine guardrail');
    });

    it('keeps strong near-break pressure setups in watch mode without the market-context pocket', async () => {
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
          signal: withTrendlineQ4ReferenceConfirmation(
            makeStrongNearBreakPressureTrendlineSignal(),
          ),
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 4,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.qualityReason).toContain('TrendLine guardrail');
    });

    it('keeps TrendLine short approvals in watch mode during off-hours local replay', async () => {
      const signal = makeDeterministicQualityShortSignal();
      signal.timestamp = Date.UTC(2026, 0, 1, 23, 30);
      signal.additionalIndicators = {
        ...signal.additionalIndicators,
        trendlineTiming: {
          entryTiming: 'ready_follow_through',
        },
      };
      withTrendlineQ4ReferenceConfirmation(signal);
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 3,
          hardBlockReasons: expect.arrayContaining(['short_session_risk']),
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('keeps aligned recent TrendLine long follow-through setups in watch mode without the market-context pocket', async () => {
      const signal = makeAlignedRecentLongTrendlineSignal();
      signal.additionalIndicators.baseContext = {
        ...signal.additionalIndicators.baseContext,
        participation: {
          volume: {
            volumeRel20: 1.6,
          },
        },
        relative: {
          ...signal.additionalIndicators.baseContext.relative,
          benchmark: {
            ...signal.additionalIndicators.baseContext.relative.benchmark,
            trendAlignment: 'aligned_bull',
          },
        },
        derivatives: {
          summary: {
            directionAligned: true,
            riskFlags: ['crowded_short'],
          },
        },
      };
      withTrendlineQ4ReferenceConfirmation(signal);
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 4,
          hardBlockReasons: [],
          longStrongDerivativesAlignedApproval: true,
          marketContextApprovalPocket: false,
          q4ReferenceOiPocApproval: true,
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 4,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('keeps US low-volume crowded-short TrendLine long squeeze setups in watch mode without stronger confirmation', async () => {
      const signal = makeAlignedRecentLongTrendlineSignal();
      signal.additionalIndicators.baseContext = {
        ...signal.additionalIndicators.baseContext,
        regime: {
          ...signal.additionalIndicators.baseContext.regime,
          session: {
            ...signal.additionalIndicators.baseContext.regime.session,
            sessionPhase: 'us',
          },
        },
        participation: {
          volume: {
            volumeRel20: 0.6,
          },
        },
        relative: {
          ...signal.additionalIndicators.baseContext.relative,
          benchmark: {
            ...signal.additionalIndicators.baseContext.relative.benchmark,
            trendAlignment: 'aligned_bull',
          },
          execution: {
            ...signal.additionalIndicators.baseContext.relative.execution,
            venueSpreadZScore: 1.6,
          },
        },
        derivatives: {
          summary: {
            riskFlags: ['crowded_short'],
          },
        },
      };
      withTrendlineQ4ReferenceConfirmation(signal);
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 4,
          hardBlockReasons: [],
          longUsLowVolumeCrowdedShortSqueeze: true,
          longStrongDerivativesAlignedApproval: false,
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 4,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('keeps moderate TrendLine long retests in watch mode without the market-context pocket', async () => {
      const signal = makeAlignedRecentLongTrendlineSignal();
      signal.additionalIndicators.trendlineTiming = {
        ...signal.additionalIndicators.trendlineTiming,
        entryTiming: 'ready_retest',
      };
      signal.additionalIndicators.baseContext = {
        ...signal.additionalIndicators.baseContext,
        regime: {
          ...signal.additionalIndicators.baseContext.regime,
          session: {
            ...signal.additionalIndicators.baseContext.regime.session,
            sessionPhase: 'us',
          },
        },
        participation: {
          volume: {
            volumeRel20: 1.1,
          },
        },
        relative: {
          ...signal.additionalIndicators.baseContext.relative,
          benchmark: {
            ...signal.additionalIndicators.baseContext.relative.benchmark,
            trendAlignment: 'neutral',
          },
          execution: {
            ...signal.additionalIndicators.baseContext.relative.execution,
            venueSpreadZScore: 1.6,
          },
        },
        derivatives: {
          summary: {
            directionAligned: null,
            riskFlags: ['crowded_short'],
          },
        },
      };
      withTrendlineQ4ReferenceConfirmation(signal);
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 4,
          hardBlockReasons: [],
          longModerateRetestLiquidSessionApproval: true,
          marketContextApprovalPocket: false,
          q4ReferenceOiPocApproval: true,
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 4,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('keeps thin neutral-benchmark TrendLine short ready-breakouts in watch mode during local replay', async () => {
      const signal = makeModerateReadyBreakoutShortTrendlineSignal();
      signal.additionalIndicators.baseContext = {
        ...signal.additionalIndicators.baseContext,
        participation: {
          volume: {
            volumeRel20: 0.6,
          },
        },
        relative: {
          ...signal.additionalIndicators.baseContext.relative,
          benchmark: {
            ...signal.additionalIndicators.baseContext.relative.benchmark,
            trendAlignment: 'neutral',
          },
        },
      };
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 4,
          hardBlockReasons: [],
          shortThinNeutralBenchmarkRisk: true,
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 4,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('keeps TrendLine q4 setups in watch mode without reference OI and POC confirmation', async () => {
      const signal = makeModerateReadyBreakoutShortTrendlineSignal();
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 4,
          hardBlockReasons: [],
          q4ReferenceOiPocApproval: false,
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 4,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('approves TrendLine market-context pocket during local replay', async () => {
      const signal = withTrendlineMarketContextApproval(
        makeModerateReadyBreakoutShortTrendlineSignal(),
      );
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: true,
          deterministicQuality: 4,
          hardBlockReasons: [],
          gatePrimaryIssue: 'market_context_against',
          cmcTotalMarketCapUsd: 2_330_000_000_000,
          trendPersistence: 0.7,
          marketContextApprovalPocket: true,
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: 'SHORT',
          quality: 4,
          needRetest: false,
          takeProfitPrice: 96,
          stopLossPrice: 101.2,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('keeps moderate TrendLine short ready-breakout setups in watch mode without the market-context pocket', async () => {
      const signal = makeModerateReadyBreakoutShortTrendlineSignal();
      withTrendlineQ4ReferenceConfirmation(signal);
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 4,
          hardBlockReasons: [],
          marketContextApprovalPocket: false,
          q4ReferenceOiPocApproval: true,
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 4,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('keeps non-breakout TrendLine short setups in watch mode during local replay even when displacement is moderate', async () => {
      const signal = makeDeterministicQualityShortSignal();
      signal.timestamp = Date.UTC(2026, 0, 1, 10, 0);
      signal.additionalIndicators = {
        ...signal.additionalIndicators,
        trendlineTiming: {
          entryTiming: 'ready_follow_through',
        },
      };
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 3,
          hardBlockReasons: expect.arrayContaining(['short_session_risk']),
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('keeps TrendLine approvals in watch mode when derivatives oi is not confirming during local replay', async () => {
      const signal = makeDeterministicQualityShortSignal();
      signal.additionalIndicators = {
        ...signal.additionalIndicators,
        baseContext: {
          ...signal.additionalIndicators.baseContext,
          derivatives: {
            source: 'coinalyze',
            symbol: 'BTCUSDT',
            timestamp: signal.timestamp,
            intervals: {},
            summary: {
              pressure: 'neutral',
              directionAligned: null,
              riskFlags: ['oi_not_confirming'],
            },
          },
        },
      };
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 3,
          hardBlockReasons: expect.arrayContaining(['oi_not_confirming']),
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('rejects AdaptiveMomentumRibbon entries outside the rebuilt pocket', async () => {
      const signal = makeAdaptiveMomentumRibbonSignal();
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: true,
          deterministicQuality: 5,
          riskAnnotations: [],
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          retestPrice: null,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(result.rejectReason).toContain(
        'rule=adaptive_momentum_ribbon_long_breadth_poc; decision=rejected',
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('keeps invalidated AdaptiveMomentumRibbon signals in watch mode during local replay', async () => {
      const signal = makeAdaptiveMomentumRibbonSignal({
        additionalIndicators: {
          amr: {
            invalidated: 1,
          },
        },
      });
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 2,
          approvalBlockReasons: ['invalidated'],
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 2,
          needRetest: true,
          retestPrice: 100.7,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('keeps conflicted AdaptiveMomentumRibbon long setups below approval threshold during local replay', async () => {
      const signal = makeAdaptiveMomentumRibbonSignal({
        prices: {
          currentPrice: 99.8,
          takeProfitPrice: 101.8,
        },
        indicators: {
          maFast: [99.8, 99.7, 99.6],
          maSlow: [100, 100, 100],
          btcMaFast: [49.8, 49.7, 49.6],
          btcMaSlow: [50, 50, 50],
        },
        additionalIndicators: {
          baseContext: {
            relative: {
              targetVsBtc: {
                alphaVsBtc1h: 0.4,
                alphaVsBtc4h: 4.2,
                alphaVsBtc24h: 8,
                ratioTrend: 'up',
              },
            },
          },
          amr: {
            signalOsc: 0.34,
            kcMidline: 100.1,
            kcUpper: 100.8,
            kcLower: 99.2,
            invalidationLevel: 99.3,
          },
        },
      });
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 3,
          riskAnnotations: [],
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          retestPrice: 100.1,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('keeps strong inside-channel AdaptiveMomentumRibbon longs in watch mode during local replay', async () => {
      const signal = makeAdaptiveMomentumRibbonSignal({
        prices: {
          currentPrice: 100.5,
          takeProfitPrice: 103.2,
          stopLossPrice: 99.8,
        },
        additionalIndicators: {
          baseContext: {
            relative: {
              targetVsBtc: {
                alphaVsBtc1h: 0.4,
                alphaVsBtc4h: 0.8,
                alphaVsBtc24h: 1.2,
                ratioTrend: 'flat',
              },
            },
          },
          amr: {
            signalOsc: 0.88,
            kcMidline: 100.2,
            kcUpper: 101.1,
            kcLower: 99.5,
            invalidationLevel: 99.9,
          },
        },
      });
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 3,
          riskAnnotations: [],
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          retestPrice: 101.1,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('keeps moderate above-upper AdaptiveMomentumRibbon longs in watch mode during local replay', async () => {
      const signal = makeAdaptiveMomentumRibbonSignal({
        prices: {
          currentPrice: 100.78,
          takeProfitPrice: 103.4,
          stopLossPrice: 99.92,
        },
        additionalIndicators: {
          baseContext: {
            relative: {
              targetVsBtc: {
                alphaVsBtc1h: 0.4,
                alphaVsBtc4h: 4.2,
                alphaVsBtc24h: 8,
                ratioTrend: 'up',
              },
            },
          },
          amr: {
            signalOsc: 0.72,
            kcMidline: 100.2,
            kcUpper: 100.7,
            kcLower: 99.6,
            invalidationLevel: 99.92,
          },
        },
      });
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 3,
          riskAnnotations: [],
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          retestPrice: 100.7,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('keeps strong AdaptiveMomentumRibbon short entries in local watch mode without AI provider calls', async () => {
      const signal = makeAdaptiveMomentumRibbonSignal({
        direction: 'SHORT',
        prices: {
          currentPrice: 98.9,
          takeProfitPrice: 96.6,
          stopLossPrice: 99.9,
        },
        indicators: {
          maFast: [100.2, 99.8, 99.3],
          maSlow: [100.1, 100.0, 99.8],
          btcMaFast: [50.2, 49.9, 49.4],
          btcMaSlow: [50.1, 50.0, 49.8],
        },
        additionalIndicators: {
          baseContext: {
            relative: {
              targetVsBtc: {
                alphaVsBtc1h: -3.4,
                alphaVsBtc4h: -2.4,
                alphaVsBtc24h: -8,
                ratioTrend: 'down',
              },
            },
          },
          amr: {
            entryLong: 0,
            entryShort: 1,
            invalidated: 0,
            activeBuy: 0,
            activeSell: 1,
            signalOsc: -1.6,
            kcMidline: 99.5,
            kcUpper: 100.1,
            kcLower: 99.0,
            invalidationLevel: 99.8,
          },
        },
      });
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 3,
          approvalBlockReasons: ['short_off_hours'],
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          needRetest: true,
          retestPrice: 99,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('replays confirmed VolumeDivergence entries locally without AI provider calls', async () => {
      const signal = makeVolumeDivergenceSignal();
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 4,
          structuralHardBlockReasons: [],
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 4,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
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
          approvalAllowedNow: false,
          deterministicQuality: 4,
          volumeDivergenceRatio: 110 / 60,
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 4,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('promotes semi-aligned VolumeDivergence long q3 confirmations during local replay when reclaim and candle quality are strong', async () => {
      const signal = makeVolumeDivergenceSignal({
        indicators: {
          maFast: [100, 101, 102],
          maSlow: [100, 100, 101],
          btcMaFast: [50, 49.8, 49.6],
          btcMaSlow: [50, 50.1, 50.2],
        },
        additionalIndicators: {
          volumeDivergenceSetup: {
            atrPct: 0.9,
            divergenceAmplitudeAtrRatio: 1.6,
            reclaimPct: 145,
            confirmationCandleQuality: 0.82,
            confirmationDistancePct: 0.7,
          },
          volumeDivergenceSignalTiming: {
            entryTiming: 'confirmation_ready',
            barsSinceDetection: 4,
          },
          divergence: {
            currentPivot: {
              volumeNorm: 110,
            },
            previousPivot: {
              volumeNorm: 90,
            },
          },
        },
      });
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          coinBiasAligned: true,
          btcBiasAligned: false,
          volumeDivergenceRatio: 110 / 90,
          divergenceAmplitudeAtrRatio: 1.6,
          reclaimPct: 145,
          confirmationCandleQuality: 0.82,
          approvalAllowedNow: false,
          deterministicQuality: 4,
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 4,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
        }),
      );
      expect(chatOpenAICtorMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('keeps late fully-aligned VolumeDivergence long confirmations in watch mode during local replay when follow-through is weak', async () => {
      const signal = makeVolumeDivergenceSignal({
        additionalIndicators: {
          volumeDivergenceSetup: {
            atrPct: 0.72,
            divergenceAmplitudeAtrRatio: 0.85,
            reclaimPct: 165,
            confirmationCandleQuality: 0.82,
            confirmationDistancePct: 0.9,
          },
          volumeDivergenceSignalTiming: {
            entryTiming: 'confirmation_ready',
            barsSinceDetection: 5,
          },
          divergence: {
            currentPivot: {
              volumeNorm: 118,
            },
            previousPivot: {
              volumeNorm: 82,
            },
          },
        },
      });
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          coinBiasAligned: true,
          btcBiasAligned: true,
          confirmationDistancePct: 0.9,
          barsSinceDetection: 5,
          reclaimPct: 165,
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

    it('keeps stale double-conflict VolumeDivergence long confirmations in watch mode during local replay even when setup is otherwise tidy', async () => {
      const signal = makeVolumeDivergenceSignal({
        indicators: {
          maFast: [99, 99.2, 99.4],
          maSlow: [100, 100.1, 100.2],
          btcMaFast: [49, 49.2, 49.4],
          btcMaSlow: [50, 50.1, 50.2],
        },
        additionalIndicators: {
          volumeDivergenceSetup: {
            atrPct: 0.7,
            divergenceAmplitudeAtrRatio: 1,
            reclaimPct: 170,
            confirmationCandleQuality: 0.84,
            confirmationDistancePct: 0.8,
          },
          volumeDivergenceSignalTiming: {
            entryTiming: 'confirmation_ready',
            barsSinceDetection: 5,
          },
          divergence: {
            currentPivot: {
              volumeNorm: 120,
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
          coinBiasAligned: false,
          btcBiasAligned: false,
          barsSinceDetection: 5,
          confirmationDistancePct: 0.8,
          divergenceAmplitudeAtrRatio: 1,
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

    it('keeps late overextended double-conflict VolumeDivergence long confirmations in watch mode during local replay', async () => {
      const signal = makeVolumeDivergenceSignal({
        indicators: {
          maFast: [99, 99.2, 99.4],
          maSlow: [100, 100.1, 100.2],
          btcMaFast: [49, 49.2, 49.4],
          btcMaSlow: [50, 50.1, 50.2],
        },
        additionalIndicators: {
          volumeDivergenceSetup: {
            atrPct: 1.15,
            divergenceAmplitudeAtrRatio: 0.72,
            reclaimPct: 132,
            confirmationCandleQuality: 0.74,
            confirmationDistancePct: 1.9,
          },
          volumeDivergenceSignalTiming: {
            entryTiming: 'confirmation_ready',
            barsSinceDetection: 6,
          },
        },
      });
      const payload = buildAiPayload(signal);

      expect(getDeterministicAiGateContext(payload)).toEqual(
        expect.objectContaining({
          coinBiasAligned: false,
          btcBiasAligned: false,
          confirmationDistancePct: 1.9,
          barsSinceDetection: 6,
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

    it('keeps mature oversized-amplitude double-conflict VolumeDivergence long confirmations in watch mode during local replay', async () => {
      const signal = makeVolumeDivergenceSignal({
        indicators: {
          maFast: [99, 99.2, 99.4],
          maSlow: [100, 100.1, 100.2],
          btcMaFast: [49, 49.2, 49.4],
          btcMaSlow: [50, 50.1, 50.2],
        },
        additionalIndicators: {
          deltaAtPivot: -20,
          volumeDivergenceSetup: {
            atrPct: 0.7,
            divergenceAmplitudeAtrRatio: 2.6,
            reclaimPct: 165,
            confirmationCandleQuality: 0.84,
            confirmationDistancePct: 0.7,
          },
          volumeDivergenceSignalTiming: {
            entryTiming: 'confirmation_ready',
            barsSinceDetection: 3,
          },
          divergence: {
            currentPivot: {
              volumeNorm: 132,
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
          divergenceAmplitudeAtrRatio: 2.6,
          reclaimPct: 165,
          confirmationDistancePct: 0.7,
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
          approvalAllowedNow: false,
        }),
      );

      const result = await runAiPromptLocal(signal, { payload });

      expect(result).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 4,
          needRetest: true,
          retestPrice: 100,
          takeProfitPrice: null,
          stopLossPrice: null,
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

    it('uses the user-selected default model when no override is provided', async () => {
      resetAiRuntimeCache();
      getUserSettingsMock.mockResolvedValueOnce({
        userName: 'root',
        BYBIT_API_KEY: '',
        BYBIT_API_SECRET: '',
        COINALYZE_API_KEY: '',
        AI_API_KEY: 'key_123',
        AI_API_ENDPOINT: 'https://api.openai.com/v1',
        AI_MODEL: 'gpt-5.2',
        AI_RESPONSE_LANGUAGE: 'en',
        TG_BOT_TOKEN: 'tg-token',
        TG_CHAT_ID: 'tg-chat-id',
      });
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

      expect(chatOpenAICtorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: 'gpt-5.2',
        }),
      );
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
        COINALYZE_API_KEY: '',
        AI_API_KEY: 'key_123',
        AI_API_ENDPOINT: 'https://openrouter.ai/api/v1',
        AI_MODEL: 'openai/gpt-5-mini',
        AI_RESPONSE_LANGUAGE: 'en',
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
            baseURL: 'https://openrouter.ai/api/v1',
          }),
        }),
      );
      expect(invokeMock).toHaveBeenCalledTimes(1);

      const messages = invokeMock.mock.calls[0]?.[0] as any[];
      expect(messages).toHaveLength(3);
      expect(messages[0]).toBeInstanceOf(MockSystemMessage);
      expect(messages[1]).toBeInstanceOf(MockSystemMessage);
      expect(messages[1].content).toContain(
        'Write all user-visible text fields in English',
      );
      expect(messages[2]).toBeInstanceOf(MockHumanMessage);
      expect(messages[2].content.content[0].text).toContain(
        'Analyze the already computed internal signal for ETHUSDT',
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
      expect(logSpy).toHaveBeenCalledWith('Raw AI response:', 'no json here');
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
