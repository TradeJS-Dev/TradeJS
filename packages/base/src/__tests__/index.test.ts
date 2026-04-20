describe('basePreset', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('wires shared beforePlaceOrder and afterCoreDecision hooks', () => {
    const getBuiltInStrategyDefaultConfig = jest.fn();
    const createCloseOppositeBeforePlaceOrderHook = jest.fn(
      () => 'before-place-order-hook',
    );
    const createCloseAllPositionsOnGlobalProfitHook = jest.fn(
      () => 'on-bar-hook',
    );
    const createMoveStopToBreakEvenAfterCoreDecisionHook = jest.fn(
      () => 'break-even-after-core-decision-hook',
    );

    jest.isolateModules(() => {
      jest.doMock('@tradejs/strategies', () => ({
        getBuiltInStrategyDefaultConfig,
      }));

      jest.doMock('@tradejs/node/strategies', () => ({
        createCloseOppositeBeforePlaceOrderHook,
        createCloseAllPositionsOnGlobalProfitHook,
        createMoveStopToBreakEvenAfterCoreDecisionHook,
      }));

      const { basePreset } = require('../index');

      expect(createCloseOppositeBeforePlaceOrderHook).toHaveBeenCalledTimes(1);
      expect(createCloseAllPositionsOnGlobalProfitHook).toHaveBeenCalledTimes(
        1,
      );
      expect(
        createMoveStopToBreakEvenAfterCoreDecisionHook,
      ).toHaveBeenCalledTimes(1);
      expect(createCloseAllPositionsOnGlobalProfitHook).toHaveBeenCalledWith({
        getStrategyDefaultConfig: getBuiltInStrategyDefaultConfig,
      });
      expect(basePreset).toEqual({
        strategies: ['@tradejs/strategies'],
        indicators: ['@tradejs/indicators'],
        connectors: ['@tradejs/connectors'],
        hooks: {
          beforePlaceOrder: 'before-place-order-hook',
          onBar: 'on-bar-hook',
          afterCoreDecision: 'break-even-after-core-decision-hook',
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
