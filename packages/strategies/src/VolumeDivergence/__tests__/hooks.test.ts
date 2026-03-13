import { createCloseOppositeBeforePlaceOrderHook } from '@tradejs/core/strategies';

jest.mock('@tradejs/core/strategies', () => ({
  createCloseOppositeBeforePlaceOrderHook: jest.fn(() => 'hook'),
}));

describe('volumeDivergenceBeforePlaceOrderHook', () => {
  it('wires createCloseOppositeBeforePlaceOrderHook with CLOSE_OPPOSITE_POSITIONS predicate', async () => {
    const module = await import('../hooks');

    expect(module.volumeDivergenceBeforePlaceOrderHook).toBe('hook');
    expect(createCloseOppositeBeforePlaceOrderHook).toHaveBeenCalledTimes(1);

    const [params] = (createCloseOppositeBeforePlaceOrderHook as jest.Mock).mock
      .calls[0];

    expect(params.isEnabled({ CLOSE_OPPOSITE_POSITIONS: false })).toBe(false);
    expect(params.isEnabled({ CLOSE_OPPOSITE_POSITIONS: true })).toBe(true);
  });
});
