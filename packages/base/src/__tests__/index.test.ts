describe('basePreset', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('wires shared beforePlaceOrder and onBar hooks', () => {
    const getBuiltInStrategyDefaultConfig = jest.fn();
    const createCloseOppositeBeforePlaceOrderHook = jest.fn(
      () => 'before-place-order-hook',
    );
    const createCloseAllPositionsOnGlobalProfitHook = jest.fn(
      () => 'close-all-on-bar-hook',
    );
    const createMoveStopToBreakEvenOnBarHook = jest.fn(
      () => 'break-even-on-bar-hook',
    );

    jest.isolateModules(() => {
      jest.doMock('@tradejs/strategies', () => ({
        getBuiltInStrategyDefaultConfig,
      }));

      jest.doMock('@tradejs/node/strategies', () => ({
        createCloseOppositeBeforePlaceOrderHook,
        createCloseAllPositionsOnGlobalProfitHook,
        createMoveStopToBreakEvenOnBarHook,
      }));

      const { basePreset } = require('../index');

      expect(createCloseOppositeBeforePlaceOrderHook).toHaveBeenCalledTimes(1);
      expect(createCloseAllPositionsOnGlobalProfitHook).toHaveBeenCalledTimes(
        1,
      );
      expect(createMoveStopToBreakEvenOnBarHook).toHaveBeenCalledTimes(1);
      expect(createCloseAllPositionsOnGlobalProfitHook).toHaveBeenCalledWith({
        getStrategyDefaultConfig: getBuiltInStrategyDefaultConfig,
      });
      expect(basePreset).toEqual({
        strategies: ['@tradejs/strategies'],
        indicators: ['@tradejs/indicators'],
        connectors: ['@tradejs/connectors'],
        hooks: {
          beforePlaceOrder: 'before-place-order-hook',
          onBar: ['close-all-on-bar-hook', 'break-even-on-bar-hook'],
        },
      });

      const [{ isEnabled }] = (createCloseOppositeBeforePlaceOrderHook.mock
        .calls[0] ?? []) as unknown as [
        { isEnabled: (config: Record<string, unknown>) => boolean },
      ];
      expect(isEnabled({ CLOSE_OPPOSITE_POSITIONS: false })).toBe(false);
      expect(isEnabled({ CLOSE_OPPOSITE_POSITIONS: true })).toBe(true);
    });
  });
});
