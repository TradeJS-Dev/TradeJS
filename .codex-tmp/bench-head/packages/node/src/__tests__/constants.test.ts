describe('node/constants', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalKlineConcurrencyLimit = process.env.KLINE_CONCURRENCY_LIMIT;
  const env = process.env as Record<string, string | undefined>;

  afterEach(() => {
    jest.resetModules();
    if (originalNodeEnv == null) {
      delete env.NODE_ENV;
    } else {
      env.NODE_ENV = originalNodeEnv;
    }

    if (originalKlineConcurrencyLimit == null) {
      delete env.KLINE_CONCURRENCY_LIMIT;
    } else {
      env.KLINE_CONCURRENCY_LIMIT = originalKlineConcurrencyLimit;
    }
  });

  it('uses production concurrency limits when NODE_ENV=production', () => {
    env.NODE_ENV = 'production';
    delete env.KLINE_CONCURRENCY_LIMIT;

    jest.isolateModules(() => {
      const constants = require('@tradejs/node/constants');

      expect(constants.KLINE_CONCURRENCY_LIMIT).toBe(1);
      expect(constants.SCREENSHOT_CONCURRENCY_LIMIT).toBe(1);
      expect(constants.TG_CONCURRENCY_LIMIT).toBe(3);
      expect(constants.AI_CONCURRENCY_LIMIT).toBe(3);
    });
  });

  it('uses default concurrency limits when NODE_ENV is not production', () => {
    env.NODE_ENV = 'development';
    delete env.KLINE_CONCURRENCY_LIMIT;

    jest.isolateModules(() => {
      const constants = require('@tradejs/node/constants');

      expect(constants.KLINE_CONCURRENCY_LIMIT).toBe(10);
      expect(constants.SCREENSHOT_CONCURRENCY_LIMIT).toBe(2);
      expect(constants.TG_CONCURRENCY_LIMIT).toBe(3);
      expect(constants.AI_CONCURRENCY_LIMIT).toBe(3);
    });
  });

  it('allows overriding KLINE_CONCURRENCY_LIMIT via env', () => {
    env.NODE_ENV = 'production';
    env.KLINE_CONCURRENCY_LIMIT = '1';

    jest.isolateModules(() => {
      const constants = require('@tradejs/node/constants');

      expect(constants.KLINE_CONCURRENCY_LIMIT).toBe(1);
      expect(constants.SCREENSHOT_CONCURRENCY_LIMIT).toBe(1);
      expect(constants.TG_CONCURRENCY_LIMIT).toBe(3);
      expect(constants.AI_CONCURRENCY_LIMIT).toBe(3);
    });
  });
});
