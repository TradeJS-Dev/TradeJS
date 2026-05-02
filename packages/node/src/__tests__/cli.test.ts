import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export {};

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
