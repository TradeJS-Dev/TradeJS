import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export {};

jest.mock('../strategy/manifests', () => ({
  ensureStrategyPluginsLoaded: jest.fn(async () => undefined),
}));

const flushMicrotasks = async (steps = 5) => {
  for (let index = 0; index < steps; index += 1) {
    await Promise.resolve();
  }
};

const createDeferred = () => {
  let resolve!: () => void;

  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve,
  };
};

describe('cli telegram notifications', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('sends each signal and its AI analysis before moving to the next signal', async () => {
    const progressTick = jest.fn();
    const logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    const getData = jest.fn(async () => ({
      direction: 'LONG',
      quality: 4,
    }));
    const sendOrder: string[] = [];
    const firstAnalysisSent = createDeferred();
    const sendSignal = jest.fn(async (signal: { symbol: string }) => {
      sendOrder.push(`signal:${signal.symbol}`);
    });
    const sendSignalAnalysis = jest.fn((signal: { symbol: string }) => {
      sendOrder.push(`analysis:${signal.symbol}`);

      if (signal.symbol === 'BTCUSDT') {
        return firstAnalysisSent.promise;
      }

      return Promise.resolve();
    });

    jest.doMock('progress', () => ({
      __esModule: true,
      default: jest.fn().mockImplementation(() => ({
        tick: progressTick,
      })),
    }));

    jest.doMock('chalk', () => ({
      __esModule: true,
      default: {
        yellow: (...values: unknown[]) => values.join(' '),
        gray: (value: string) => value,
      },
    }));

    jest.doMock('@tradejs/core/backtest', () => ({
      getFormatted: jest.fn(),
    }));

    jest.doMock('@tradejs/core/tickers', () => ({
      getTopTickers: jest.fn(),
    }));

    jest.doMock('@tradejs/core/time', () => ({
      getTimestamp: jest.fn(() => 0),
    }));

    jest.doMock('@tradejs/infra/files', () => ({
      getFiles: jest.fn(async () => []),
    }));

    jest.doMock('@tradejs/infra/logger', () => ({
      logger,
    }));

    jest.doMock('@tradejs/infra/redis', () => ({
      RedisWriteBlockedError: class RedisWriteBlockedError extends Error {},
      delKeyWithOptions: jest.fn(),
      getData,
      getKeys: jest.fn(async () => []),
      redisKeys: {
        analysis: (symbol: string, signalId: string) =>
          `analysis:${symbol}:${signalId}`,
      },
    }));

    jest.doMock('../ai', () => ({
      askAI: jest.fn(),
    }));

    jest.doMock('../screenshot', () => ({
      screenDashboard: jest.fn(),
    }));

    jest.doMock('../signals', () => ({
      sendSignal,
      sendSignalAnalysis,
      sendTextToTG: jest.fn(),
    }));

    jest.doMock('../tradejsConfig', () => ({
      getTradejsProjectCwd: jest.fn(() => '/tmp/tradejs'),
    }));

    const { sendToTG } = require('../cli');

    const signals = [
      { signalId: 'sig-1', symbol: 'BTCUSDT' },
      { signalId: 'sig-2', symbol: 'ETHUSDT' },
    ];

    const pendingSend = sendToTG(signals, '15', 'root');

    await flushMicrotasks();

    expect(sendOrder).toEqual(['signal:BTCUSDT', 'analysis:BTCUSDT']);
    expect(sendSignal).toHaveBeenCalledTimes(1);
    expect(sendSignalAnalysis).toHaveBeenCalledTimes(1);

    firstAnalysisSent.resolve();
    await pendingSend;

    expect(sendOrder).toEqual([
      'signal:BTCUSDT',
      'analysis:BTCUSDT',
      'signal:ETHUSDT',
      'analysis:ETHUSDT',
    ]);
    expect(progressTick).toHaveBeenCalledTimes(2);
  });

  it('does not send skipped signals to Telegram', async () => {
    const progressTick = jest.fn();
    const logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    const getData = jest.fn(async () => null);
    const sendSignal = jest.fn(async () => undefined);
    const sendSignalAnalysis = jest.fn(async () => undefined);

    jest.doMock('progress', () => ({
      __esModule: true,
      default: jest.fn().mockImplementation(() => ({
        tick: progressTick,
      })),
    }));

    jest.doMock('chalk', () => ({
      __esModule: true,
      default: {
        yellow: (...values: unknown[]) => values.join(' '),
        gray: (value: string) => value,
      },
    }));

    jest.doMock('@tradejs/core/backtest', () => ({
      getFormatted: jest.fn(),
    }));

    jest.doMock('@tradejs/core/tickers', () => ({
      getTopTickers: jest.fn(),
    }));

    jest.doMock('@tradejs/core/time', () => ({
      getTimestamp: jest.fn(() => 0),
    }));

    jest.doMock('@tradejs/infra/files', () => ({
      getFiles: jest.fn(async () => []),
    }));

    jest.doMock('@tradejs/infra/logger', () => ({
      logger,
    }));

    jest.doMock('@tradejs/infra/redis', () => ({
      RedisWriteBlockedError: class RedisWriteBlockedError extends Error {},
      delKeyWithOptions: jest.fn(),
      getData,
      getKeys: jest.fn(async () => []),
      redisKeys: {
        analysis: (symbol: string, signalId: string) =>
          `analysis:${symbol}:${signalId}`,
      },
    }));

    jest.doMock('../ai', () => ({
      askAI: jest.fn(),
    }));

    jest.doMock('../screenshot', () => ({
      screenDashboard: jest.fn(),
    }));

    jest.doMock('../signals', () => ({
      sendSignal,
      sendSignalAnalysis,
      sendTextToTG: jest.fn(),
    }));

    jest.doMock('../tradejsConfig', () => ({
      getTradejsProjectCwd: jest.fn(() => '/tmp/tradejs'),
    }));

    const { sendToTG } = require('../cli');

    await sendToTG(
      [
        { signalId: 'sig-1', symbol: 'BTCUSDT', orderStatus: 'skipped' },
        { signalId: 'sig-2', symbol: 'ETHUSDT', orderStatus: 'completed' },
      ],
      '15',
      'root',
    );

    expect(sendSignal).toHaveBeenCalledTimes(1);
    expect(sendSignal).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'ETHUSDT' }),
      '15',
      null,
      { userName: 'root' },
    );
    expect(sendSignalAnalysis).not.toHaveBeenCalled();
    expect(progressTick).toHaveBeenCalledTimes(1);
  });

  it('formats and sends runtime close notifications as text messages', async () => {
    const progressTick = jest.fn();
    const logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    const sendTextToTG = jest.fn(async () => undefined);

    jest.doMock('progress', () => ({
      __esModule: true,
      default: jest.fn().mockImplementation(() => ({
        tick: progressTick,
      })),
    }));

    jest.doMock('chalk', () => ({
      __esModule: true,
      default: {
        yellow: (...values: unknown[]) => values.join(' '),
        gray: (value: string) => value,
      },
    }));

    jest.doMock('@tradejs/core/backtest', () => ({
      getFormatted: jest.fn(),
    }));

    jest.doMock('@tradejs/core/tickers', () => ({
      getTopTickers: jest.fn(),
    }));

    jest.doMock('@tradejs/core/time', () => ({
      getTimestamp: jest.fn(() => 0),
    }));

    jest.doMock('@tradejs/infra/files', () => ({
      getFiles: jest.fn(async () => []),
    }));

    jest.doMock('@tradejs/infra/logger', () => ({
      logger,
    }));

    jest.doMock('@tradejs/infra/redis', () => ({
      RedisWriteBlockedError: class RedisWriteBlockedError extends Error {},
      delKeyWithOptions: jest.fn(),
      getData: jest.fn(),
      getKeys: jest.fn(async () => []),
      redisKeys: {
        runtimeTrade: (userName: string, orderId: string) =>
          `users:${userName}:runtime:trade-records:${orderId}`,
      },
    }));

    jest.doMock('../ai', () => ({
      askAI: jest.fn(),
    }));

    jest.doMock('../screenshot', () => ({
      screenDashboard: jest.fn(),
    }));

    jest.doMock('../signals', () => ({
      sendSignal: jest.fn(),
      sendSignalAnalysis: jest.fn(),
      sendTextToTG,
    }));

    jest.doMock('../tradejsConfig', () => ({
      getTradejsProjectCwd: jest.fn(() => '/tmp/tradejs'),
    }));

    const {
      formatRuntimeCloseNotification,
      sendRuntimeCloseNotificationsToTG,
    } = require('../cli');
    const event = {
      userName: 'root',
      strategy: 'TrendLine',
      openedByStrategy: 'TrendLine',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      code: 'CLOSE_BY_SIGNAL',
      orderId: 'ord-1',
      signalId: 'sig-1',
      qty: 1,
      entryPrice: 100,
      entryTimestamp: 1_700_000_000_000,
      exitPrice: 101,
      exitTimestamp: 1_700_000_123_000,
      closedPnl: 1,
      exitType: 'exit',
    };

    const message = formatRuntimeCloseNotification(event, 'root');
    expect(message).toContain('Symbol: <b>ETHUSDT</b>');
    expect(message).toContain('Strategy: <b>TrendLine</b>');
    expect(message).toContain('Opened by journal: <b>TrendLine</b>');
    expect(message).toContain('Ownership: <b>matched</b>');
    expect(message).not.toContain('<b>Runtime journal</b>');
    expect(message).not.toContain('trade: <code>');
    expect(message).not.toContain('orderId: <code>');
    expect(message).not.toContain('signalId: <code>');

    await sendRuntimeCloseNotificationsToTG([event], 'root');

    expect(sendTextToTG).toHaveBeenCalledWith(message, { userName: 'root' });
    expect(progressTick).toHaveBeenCalledTimes(1);
  });

  it('requests LLM only for deliverable gate-mode signals before TG send', async () => {
    const logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    const getData = jest.fn().mockImplementation(async (key: string) => {
      if (key === 'users:root:strategies:TrendShift:config') {
        return { AI_MODE: 'gate', MIN_AI_QUALITY: 5 };
      }
      return null;
    });
    const askAI = jest.fn(async () => ({
      direction: 'SHORT',
      quality: 2,
      comment: 'llm rejected',
    }));
    const sendSignal = jest.fn(async () => undefined);
    const sendSignalAnalysis = jest.fn(async () => undefined);

    jest.doMock('progress', () => ({
      __esModule: true,
      default: jest.fn().mockImplementation(() => ({
        tick: jest.fn(),
      })),
    }));
    jest.doMock('chalk', () => ({
      __esModule: true,
      default: {
        yellow: (...values: unknown[]) => values.join(' '),
        gray: (value: string) => value,
      },
    }));
    jest.doMock('@tradejs/core/backtest', () => ({ getFormatted: jest.fn() }));
    jest.doMock('@tradejs/core/tickers', () => ({ getTopTickers: jest.fn() }));
    jest.doMock('@tradejs/core/time', () => ({
      getTimestamp: jest.fn(() => 0),
    }));
    jest.doMock('@tradejs/infra/files', () => ({ getFiles: jest.fn() }));
    jest.doMock('@tradejs/infra/logger', () => ({ logger }));
    jest.doMock('@tradejs/infra/redis', () => ({
      RedisWriteBlockedError: class RedisWriteBlockedError extends Error {},
      delKeyWithOptions: jest.fn(),
      getData,
      getKeys: jest.fn(async () => []),
      redisKeys: {
        analysis: (symbol: string, signalId: string) =>
          `analysis:${symbol}:${signalId}`,
      },
    }));
    jest.doMock('../ai', () => ({ askAI }));
    jest.doMock('../screenshot', () => ({ screenDashboard: jest.fn() }));
    jest.doMock('../signals', () => ({
      sendSignal,
      sendSignalAnalysis,
      sendTextToTG: jest.fn(),
    }));
    jest.doMock('../tradejsConfig', () => ({
      getTradejsProjectCwd: jest.fn(() => '/tmp/tradejs'),
    }));

    const { sendToTG } = require('../cli');

    await sendToTG(
      [
        {
          signalId: 'sig-1',
          symbol: 'BTCUSDT',
          strategy: 'TrendShift',
          direction: 'LONG',
          interval: '15',
          timestamp: 1,
          figures: {},
          prices: {
            currentPrice: 1,
            takeProfitPrice: 2,
            stopLossPrice: 0.5,
            riskRatio: 2,
          },
          indicators: {},
          aiAnalysis: {
            direction: 'LONG',
            quality: 5,
            comment: 'gate approved',
          },
        },
      ] as any,
      '15',
      'root',
    );

    expect(askAI).toHaveBeenCalledTimes(1);
    expect(sendSignal).toHaveBeenCalledTimes(1);
    const analysis = (sendSignal.mock.calls[0] as unknown[] | undefined)?.[2];
    expect(analysis).toMatchObject({
      gateDecision: 'approved',
      llmDecision: 'rejected',
      gateContradictsLlm: true,
    });
    expect(sendSignalAnalysis).toHaveBeenCalledTimes(1);
  });

  it('sends a gate-mode signal when LLM commentary fails', async () => {
    const logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    const getData = jest.fn().mockImplementation(async (key: string) => {
      if (key === 'users:root:strategies:TrendShift:config') {
        return { AI_MODE: 'gate', MIN_AI_QUALITY: 4 };
      }
      return null;
    });
    const askAI = jest.fn(async () => {
      throw new Error('AI provider returned an empty chat completion');
    });
    const sendSignal = jest.fn(async () => undefined);
    const sendSignalAnalysis = jest.fn(async () => undefined);

    jest.doMock('progress', () => ({
      __esModule: true,
      default: jest.fn().mockImplementation(() => ({
        tick: jest.fn(),
      })),
    }));
    jest.doMock('chalk', () => ({
      __esModule: true,
      default: {
        yellow: (...values: unknown[]) => values.join(' '),
        gray: (value: string) => value,
      },
    }));
    jest.doMock('@tradejs/core/backtest', () => ({ getFormatted: jest.fn() }));
    jest.doMock('@tradejs/core/tickers', () => ({ getTopTickers: jest.fn() }));
    jest.doMock('@tradejs/core/time', () => ({
      getTimestamp: jest.fn(() => 0),
    }));
    jest.doMock('@tradejs/infra/files', () => ({ getFiles: jest.fn() }));
    jest.doMock('@tradejs/infra/logger', () => ({ logger }));
    jest.doMock('@tradejs/infra/redis', () => ({
      RedisWriteBlockedError: class RedisWriteBlockedError extends Error {},
      delKeyWithOptions: jest.fn(),
      getData,
      getKeys: jest.fn(async () => []),
      redisKeys: {
        analysis: (symbol: string, signalId: string) =>
          `analysis:${symbol}:${signalId}`,
      },
    }));
    jest.doMock('../ai', () => ({ askAI }));
    jest.doMock('../screenshot', () => ({ screenDashboard: jest.fn() }));
    jest.doMock('../signals', () => ({
      sendSignal,
      sendSignalAnalysis,
      sendTextToTG: jest.fn(),
    }));
    jest.doMock('../tradejsConfig', () => ({
      getTradejsProjectCwd: jest.fn(() => '/tmp/tradejs'),
    }));

    const { sendToTG } = require('../cli');
    const gateAnalysis = {
      direction: 'LONG',
      quality: 5,
      comment: 'gate approved',
    };

    await sendToTG(
      [
        {
          signalId: 'sig-1',
          symbol: 'GWEIUSDT',
          strategy: 'TrendShift',
          direction: 'LONG',
          interval: '15',
          timestamp: 1,
          figures: {},
          prices: {
            currentPrice: 1,
            takeProfitPrice: 2,
            stopLossPrice: 0.5,
            riskRatio: 2,
          },
          indicators: {},
          aiAnalysis: gateAnalysis,
        },
      ] as any,
      '15',
      'root',
    );

    expect(sendSignal).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'GWEIUSDT' }),
      '15',
      {
        gateAnalysis,
        gateDecision: 'approved',
      },
      { userName: 'root' },
    );
    expect(sendSignalAnalysis).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'LLM commentary failed: %s (%s)',
      'GWEIUSDT',
      'AI provider returned an empty chat completion',
    );
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.stringContaining('Signal notification failed'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('treats retest-required gate or LLM analyses as rejected for comparison metadata', async () => {
    const logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    const getData = jest.fn().mockImplementation(async (key: string) => {
      if (key === 'users:root:strategies:TrendShift:config') {
        return { AI_MODE: 'gate', MIN_AI_QUALITY: 5 };
      }
      return null;
    });
    const askAI = jest.fn(async () => ({
      direction: 'LONG',
      quality: 5,
      needRetest: true,
      comment: 'llm pending',
    }));
    const sendSignal = jest.fn(async () => undefined);
    const sendSignalAnalysis = jest.fn(async () => undefined);

    jest.doMock('progress', () => ({
      __esModule: true,
      default: jest.fn().mockImplementation(() => ({
        tick: jest.fn(),
      })),
    }));
    jest.doMock('chalk', () => ({
      __esModule: true,
      default: {
        yellow: (...values: unknown[]) => values.join(' '),
        gray: (value: string) => value,
      },
    }));
    jest.doMock('@tradejs/core/backtest', () => ({ getFormatted: jest.fn() }));
    jest.doMock('@tradejs/core/tickers', () => ({ getTopTickers: jest.fn() }));
    jest.doMock('@tradejs/core/time', () => ({
      getTimestamp: jest.fn(() => 0),
    }));
    jest.doMock('@tradejs/infra/files', () => ({ getFiles: jest.fn() }));
    jest.doMock('@tradejs/infra/logger', () => ({ logger }));
    jest.doMock('@tradejs/infra/redis', () => ({
      RedisWriteBlockedError: class RedisWriteBlockedError extends Error {},
      delKeyWithOptions: jest.fn(),
      getData,
      getKeys: jest.fn(async () => []),
      redisKeys: {
        analysis: (symbol: string, signalId: string) =>
          `analysis:${symbol}:${signalId}`,
      },
    }));
    jest.doMock('../ai', () => ({ askAI }));
    jest.doMock('../screenshot', () => ({ screenDashboard: jest.fn() }));
    jest.doMock('../signals', () => ({
      sendSignal,
      sendSignalAnalysis,
      sendTextToTG: jest.fn(),
    }));
    jest.doMock('../tradejsConfig', () => ({
      getTradejsProjectCwd: jest.fn(() => '/tmp/tradejs'),
    }));

    const { sendToTG } = require('../cli');

    await sendToTG(
      [
        {
          signalId: 'sig-1',
          symbol: 'LRCUSDT',
          strategy: 'TrendShift',
          direction: 'LONG',
          interval: '15',
          timestamp: 1,
          figures: {},
          prices: {
            currentPrice: 1,
            takeProfitPrice: 2,
            stopLossPrice: 0.5,
            riskRatio: 2,
          },
          indicators: {},
          aiAnalysis: {
            direction: 'LONG',
            quality: 5,
            needRetest: true,
            comment: 'gate pending',
          },
        },
      ] as any,
      '15',
      'root',
    );

    const analysis = (sendSignal.mock.calls[0] as unknown[] | undefined)?.[2];
    expect(analysis).toMatchObject({
      gateDecision: 'rejected',
      llmDecision: 'rejected',
      gateContradictsLlm: false,
    });
  });

  it('does not request LLM for non-gate mode signals', async () => {
    const logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    const getData = jest.fn().mockImplementation(async (key: string) => {
      if (key === 'users:root:strategies:TrendShift:config') {
        return { AI_MODE: 'llm', MIN_AI_QUALITY: 5 };
      }
      return null;
    });
    const askAI = jest.fn(async () => ({
      direction: 'LONG',
      quality: 5,
      comment: 'llm approved',
    }));
    const sendSignal = jest.fn(async () => undefined);
    const sendSignalAnalysis = jest.fn(async () => undefined);

    jest.doMock('progress', () => ({
      __esModule: true,
      default: jest.fn().mockImplementation(() => ({
        tick: jest.fn(),
      })),
    }));
    jest.doMock('chalk', () => ({
      __esModule: true,
      default: {
        yellow: (...values: unknown[]) => values.join(' '),
        gray: (value: string) => value,
      },
    }));
    jest.doMock('@tradejs/core/backtest', () => ({ getFormatted: jest.fn() }));
    jest.doMock('@tradejs/core/tickers', () => ({ getTopTickers: jest.fn() }));
    jest.doMock('@tradejs/core/time', () => ({
      getTimestamp: jest.fn(() => 0),
    }));
    jest.doMock('@tradejs/infra/files', () => ({ getFiles: jest.fn() }));
    jest.doMock('@tradejs/infra/logger', () => ({ logger }));
    jest.doMock('@tradejs/infra/redis', () => ({
      RedisWriteBlockedError: class RedisWriteBlockedError extends Error {},
      delKeyWithOptions: jest.fn(),
      getData,
      getKeys: jest.fn(async () => []),
      redisKeys: {
        analysis: (symbol: string, signalId: string) =>
          `analysis:${symbol}:${signalId}`,
      },
    }));
    jest.doMock('../ai', () => ({ askAI }));
    jest.doMock('../screenshot', () => ({ screenDashboard: jest.fn() }));
    jest.doMock('../signals', () => ({
      sendSignal,
      sendSignalAnalysis,
      sendTextToTG: jest.fn(),
    }));
    jest.doMock('../tradejsConfig', () => ({
      getTradejsProjectCwd: jest.fn(() => '/tmp/tradejs'),
    }));

    const { sendToTG } = require('../cli');

    await sendToTG(
      [
        {
          signalId: 'sig-1',
          symbol: 'BTCUSDT',
          strategy: 'TrendShift',
          direction: 'LONG',
          interval: '15',
          timestamp: 1,
          figures: {},
          prices: {
            currentPrice: 1,
            takeProfitPrice: 2,
            stopLossPrice: 0.5,
            riskRatio: 2,
          },
          indicators: {},
          aiAnalysis: {
            direction: 'LONG',
            quality: 5,
            comment: 'local analysis',
          },
        },
      ] as any,
      '15',
      'root',
    );

    expect(askAI).not.toHaveBeenCalled();
    expect(sendSignal).toHaveBeenCalledTimes(1);
  });

  it('does not request LLM in gate mode when gate analysis is missing', async () => {
    const logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    const getData = jest.fn().mockImplementation(async (key: string) => {
      if (key === 'users:root:strategies:TrendShift:config') {
        return { AI_MODE: 'gate', MIN_AI_QUALITY: 5 };
      }
      return null;
    });
    const askAI = jest.fn(async () => ({
      direction: 'LONG',
      quality: 5,
      comment: 'llm approved',
    }));
    const sendSignal = jest.fn(async () => undefined);
    const sendSignalAnalysis = jest.fn(async () => undefined);

    jest.doMock('progress', () => ({
      __esModule: true,
      default: jest.fn().mockImplementation(() => ({
        tick: jest.fn(),
      })),
    }));
    jest.doMock('chalk', () => ({
      __esModule: true,
      default: {
        yellow: (...values: unknown[]) => values.join(' '),
        gray: (value: string) => value,
      },
    }));
    jest.doMock('@tradejs/core/backtest', () => ({ getFormatted: jest.fn() }));
    jest.doMock('@tradejs/core/tickers', () => ({ getTopTickers: jest.fn() }));
    jest.doMock('@tradejs/core/time', () => ({
      getTimestamp: jest.fn(() => 0),
    }));
    jest.doMock('@tradejs/infra/files', () => ({ getFiles: jest.fn() }));
    jest.doMock('@tradejs/infra/logger', () => ({ logger }));
    jest.doMock('@tradejs/infra/redis', () => ({
      RedisWriteBlockedError: class RedisWriteBlockedError extends Error {},
      delKeyWithOptions: jest.fn(),
      getData,
      getKeys: jest.fn(async () => []),
      redisKeys: {
        analysis: (symbol: string, signalId: string) =>
          `analysis:${symbol}:${signalId}`,
      },
    }));
    jest.doMock('../ai', () => ({ askAI }));
    jest.doMock('../screenshot', () => ({ screenDashboard: jest.fn() }));
    jest.doMock('../signals', () => ({
      sendSignal,
      sendSignalAnalysis,
      sendTextToTG: jest.fn(),
    }));
    jest.doMock('../tradejsConfig', () => ({
      getTradejsProjectCwd: jest.fn(() => '/tmp/tradejs'),
    }));

    const { sendToTG } = require('../cli');

    await sendToTG(
      [
        {
          signalId: 'sig-1',
          symbol: 'BTCUSDT',
          strategy: 'TrendShift',
          direction: 'LONG',
          interval: '15',
          timestamp: 1,
          figures: {},
          prices: {
            currentPrice: 1,
            takeProfitPrice: 2,
            stopLossPrice: 0.5,
            riskRatio: 2,
          },
          indicators: {},
        },
      ] as any,
      '15',
      'root',
    );

    expect(askAI).not.toHaveBeenCalled();
    expect(sendSignal).toHaveBeenCalledTimes(1);
  });
});

describe('cli update kline coverage filtering', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('skips symbols whose Timescale cache already covers the requested window', async () => {
    const getDataEdgesForSymbols = jest.fn(async () => {
      const edges = new Map<string, { min?: number; max?: number }>();
      edges.set('BTCUSDT', { min: 500, max: 2_000 });
      edges.set('ETHUSDT', { min: 500, max: 2_000 });
      edges.set('SOLUSDT', { min: 500, max: 1_499 });
      return edges;
    });
    const logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };

    jest.doMock('progress', () => ({
      __esModule: true,
      default: jest.fn().mockImplementation(() => ({
        tick: jest.fn(),
      })),
    }));

    jest.doMock('chalk', () => ({
      __esModule: true,
      default: {
        yellow: (...values: unknown[]) => values.join(' '),
        gray: (value: string) => value,
      },
    }));

    jest.doMock('@tradejs/core/async', () => ({
      runWithConcurrency: async <T>(
        items: T[],
        _concurrency: number,
        worker: (item: T, index: number) => Promise<void>,
      ) => {
        for (let index = 0; index < items.length; index += 1) {
          await worker(items[index], index);
        }
      },
    }));

    jest.doMock('@tradejs/core/backtest', () => ({
      getFormatted: jest.fn(),
    }));

    jest.doMock('@tradejs/core/constants', () => ({
      PRELOAD_DAYS: 30,
    }));

    jest.doMock('@tradejs/core/tickers', () => ({
      getTopTickers: jest.fn(),
    }));

    jest.doMock('@tradejs/core/time', () => ({
      getTimestamp: jest.fn(() => 2_000),
    }));

    jest.doMock('@tradejs/infra/files', () => ({
      getFiles: jest.fn(async () => []),
    }));

    jest.doMock('@tradejs/infra/logger', () => ({
      logger,
    }));

    jest.doMock('@tradejs/infra/redis', () => ({
      RedisWriteBlockedError: class RedisWriteBlockedError extends Error {},
      delKeyWithOptions: jest.fn(),
      getData: jest.fn(),
      getKeys: jest.fn(async () => []),
      redisKeys: {},
    }));

    jest.doMock('@tradejs/infra/timescale/candles', () => ({
      getDataEdgesForSymbols,
    }));

    jest.doMock('../ai', () => ({
      askAI: jest.fn(),
    }));

    jest.doMock('../screenshot', () => ({
      screenDashboard: jest.fn(),
    }));

    jest.doMock('../signals', () => ({
      sendSignal: jest.fn(),
      sendSignalAnalysis: jest.fn(),
      sendTextToTG: jest.fn(),
    }));

    jest.doMock('../tradejsConfig', () => ({
      getTradejsProjectCwd: jest.fn(() => '/tmp/tradejs'),
    }));

    const { update } = require('../cli');
    const connector = {
      kline: jest.fn(async () => []),
    };

    await update(connector, '5', ['ETHUSDT', 'SOLUSDT'], undefined, {
      connectorLabel: 'ByBit',
      preloadStart: 1_000,
      preloadEnd: 2_000,
      skipCovered: true,
    });

    expect(getDataEdgesForSymbols).toHaveBeenCalledWith(
      'ByBit',
      ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
      5,
    );
    expect(connector.kline).toHaveBeenCalledTimes(1);
    expect(connector.kline).toHaveBeenCalledWith({
      symbol: 'SOLUSDT',
      start: 1_000,
      end: 2_000,
      interval: '5',
      silent: true,
      warmOnly: true,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        'preloadStart=1970-01-01T00:00:01.000Z, preloadEnd=1970-01-01T00:00:02.000Z',
      ),
    );
  });
});

describe('cli cleanFiles', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('ignores ENOENT races while cleaning files', async () => {
    const logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    const tick = jest.fn();
    const getFiles = jest.fn(async () => ['gone.jsonl', 'alive.jsonl']);
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tradejs-clean-files-'),
    );
    const exportDir = path.join(projectRoot, 'data/ai/export');

    await fs.mkdir(exportDir, { recursive: true });
    await fs.writeFile(path.join(exportDir, 'alive.jsonl'), 'ok');

    jest.doMock('progress', () => ({
      __esModule: true,
      default: jest.fn().mockImplementation(() => ({
        tick,
      })),
    }));

    jest.doMock('chalk', () => ({
      __esModule: true,
      default: {
        yellow: (...values: unknown[]) => values.join(' '),
        gray: (value: string) => value,
      },
    }));

    jest.doMock('@tradejs/core/backtest', () => ({
      getFormatted: jest.fn(),
    }));

    jest.doMock('@tradejs/core/tickers', () => ({
      getTopTickers: jest.fn(),
    }));

    jest.doMock('@tradejs/core/time', () => ({
      getTimestamp: jest.fn(() => 0),
    }));

    jest.doMock('@tradejs/infra/files', () => ({
      getFiles,
    }));

    jest.doMock('@tradejs/infra/logger', () => ({
      logger,
    }));

    jest.doMock('@tradejs/infra/redis', () => ({
      RedisWriteBlockedError: class RedisWriteBlockedError extends Error {},
      delKeyWithOptions: jest.fn(),
      getData: jest.fn(),
      getKeys: jest.fn(async () => []),
      redisKeys: {},
    }));

    jest.doMock('../ai', () => ({
      askAI: jest.fn(),
    }));

    jest.doMock('../screenshot', () => ({
      screenDashboard: jest.fn(),
    }));

    jest.doMock('../signals', () => ({
      sendSignal: jest.fn(),
      sendSignalAnalysis: jest.fn(),
      sendTextToTG: jest.fn(),
    }));

    jest.doMock('../tradejsConfig', () => ({
      getTradejsProjectCwd: jest.fn(() => projectRoot),
    }));

    const { cleanFiles } = require('../cli');

    try {
      await expect(cleanFiles('data/ai/export')).resolves.toBeUndefined();

      expect(getFiles).toHaveBeenCalledWith('data/ai/export', projectRoot);
      await expect(
        fs.access(path.join(exportDir, 'alive.jsonl')),
      ).rejects.toThrow();
      expect(tick).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  });
});
