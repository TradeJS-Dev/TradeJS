describe('constants/index', () => {
  it('exports browser-safe static constants', () => {
    jest.isolateModules(() => {
      const constants = require('@constants');

      expect(constants.FEE_PERCENT).toBe(0.005);
      expect(constants.TTL_1D).toBe(86_400);
      expect(constants.TESTS_TOP_LIMIT).toBe(50);
      expect(constants.TESTS_LIMIT).toBe(100_000);
      expect(constants.KLINE_CONCURRENCY_LIMIT).toBeUndefined();
      expect(constants.SCREENSHOT_CONCURRENCY_LIMIT).toBeUndefined();
    });
  });
});
