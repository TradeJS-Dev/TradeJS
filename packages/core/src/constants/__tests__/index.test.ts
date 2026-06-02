describe('constants/index', () => {
  it('exports browser-safe static constants', () => {
    jest.isolateModules(() => {
      const constants = require('../index');

      expect(constants.FEE_PERCENT).toBe(0.002);
      expect(constants.BACKTEST_SLIPPAGE_PERCENT).toBe(0.002);
      expect(constants.INITIAL_BACKTEST_AMOUNT).toBe(100);
      expect(constants.TTL_1D).toBe(86_400);
      expect(constants.TTL_3D).toBe(259_200);
      expect(constants.TTL_10D).toBe(864_000);
      expect(constants.TESTS_TOP_LIMIT).toBe(50);
      expect(constants.TESTS_LIMIT).toBe(100_000);
      expect(constants.KLINE_CONCURRENCY_LIMIT).toBeUndefined();
      expect(constants.SCREENSHOT_CONCURRENCY_LIMIT).toBeUndefined();
    });
  });
});
