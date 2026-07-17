describe('constants/index', () => {
  it('exports browser-safe static constants', () => {
    jest.isolateModules(() => {
      const constants = require('../index');

      expect(constants.FEE_PERCENT).toBe(0.001);
      expect(constants.BACKTEST_BASE_SLIPPAGE_BPS).toBe(10);
      expect(constants.BACKTEST_SPREAD_SLIPPAGE_MULTIPLIER).toBe(1);
      expect(constants.BACKTEST_MARKET_IMPACT_BPS).toBe(0);
      expect(constants.BACKTEST_DELAY_RISK_LOOKBACK_CANDLES).toBe(5);
      expect(constants.BACKTEST_DELAY_RISK_MULTIPLIER).toBe(0);
      expect(constants.BACKTEST_DELAY_RISK_MAX_BPS).toBe(0);
      expect(constants.BACKTEST_EXPECTED_DELAY_MS).toBe(0);
      expect(constants.BACKTEST_LOWER_TIMEFRAME_EXECUTION_ENABLED).toBe(false);
      expect(constants.BACKTEST_EXECUTION_INTERVAL).toBe('5');
      expect(constants.BACKTEST_EXECUTION_DELAY_MS).toBe(5 * 60_000);
      expect(constants.INITIAL_BACKTEST_AMOUNT).toBe(100);
      expect(constants.TTL_1D).toBe(86_400);
      expect(constants.TTL_3D).toBe(259_200);
      expect(constants.TTL_10D).toBe(864_000);
      expect(constants.TESTS_TOP_LIMIT).toBe(50);
      expect(constants.TESTS_LIMIT).toBe(100_000);
      expect(constants.DERIVATIVES_CONTEXT_REFERENCE_SYMBOLS).toEqual([
        'BTCUSDT',
        'ETHUSDT',
        'BNBUSDT',
        'SOLUSDT',
        'TRXUSDT',
        'XRPUSDT',
      ]);
      expect(
        constants.resolveDerivativesContextReferenceSymbols('bnb,adausdt, BNB'),
      ).toEqual(['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT']);
      expect(constants.KLINE_CONCURRENCY_LIMIT).toBeUndefined();
      expect(constants.SCREENSHOT_CONCURRENCY_LIMIT).toBeUndefined();
    });
  });
});
