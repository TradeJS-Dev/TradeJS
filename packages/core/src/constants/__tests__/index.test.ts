describe('constants/index', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const env = process.env as Record<string, string | undefined>;

  afterEach(() => {
    jest.resetModules();
    if (originalNodeEnv == null) {
      delete env.NODE_ENV;
      return;
    }
    env.NODE_ENV = originalNodeEnv;
  });

  it('uses production concurrency limits when NODE_ENV=production', () => {
    env.NODE_ENV = 'production';

    jest.isolateModules(() => {
      const constants = require('@constants');

      expect(constants.KLINE_CONCURRENCY_LIMIT).toBe(5);
      expect(constants.SCREENSHOT_CONCURRENCY_LIMIT).toBe(1);
      expect(constants.FEE_PERCENT).toBe(0.005);
      expect(constants.TESTS_TOP_LIMIT).toBe(50);
    });
  });

  it('uses default concurrency limits when NODE_ENV is not production', () => {
    env.NODE_ENV = 'development';

    jest.isolateModules(() => {
      const constants = require('@constants');

      expect(constants.KLINE_CONCURRENCY_LIMIT).toBe(10);
      expect(constants.SCREENSHOT_CONCURRENCY_LIMIT).toBe(2);
      expect(constants.TTL_1D).toBe(86_400);
      expect(constants.TESTS_LIMIT).toBe(100_000);
    });
  });
});
