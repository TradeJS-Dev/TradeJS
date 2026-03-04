import { createCloseOppositeBeforePlaceOrderHook } from '@utils/strategyHooks';
import { closeOppositePositionsBeforeOpen } from '@utils/closeOppositePositionsBeforeOpen';

jest.mock('@utils/closeOppositePositionsBeforeOpen', () => ({
  closeOppositePositionsBeforeOpen: jest.fn(),
}));

const mockedCloseOppositePositionsBeforeOpen =
  closeOppositePositionsBeforeOpen as jest.MockedFunction<
    typeof closeOppositePositionsBeforeOpen
  >;

describe('createCloseOppositeBeforePlaceOrderHook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does nothing when feature flag resolver returns false', async () => {
    const hook = createCloseOppositeBeforePlaceOrderHook({
      isEnabled: () => false,
    });

    await hook({
      connector: {} as any,
      entryContext: {
        strategy: 'TrendLine',
        symbol: 'ETHUSDT',
        interval: '15',
        direction: 'LONG',
        timestamp: 1_700_000_000_000,
        prices: {
          currentPrice: 100,
          takeProfitPrice: 110,
          stopLossPrice: 95,
          riskRatio: 2,
        },
      } as any,
      config: {} as any,
      runtime: undefined,
      decision: {} as any,
      signal: undefined,
      strategyName: 'TrendLine',
      userName: 'root',
      symbol: 'ETHUSDT',
      env: 'LIVE',
      isConfigFromBacktest: false,
    });

    expect(mockedCloseOppositePositionsBeforeOpen).not.toHaveBeenCalled();
  });

  it('closes opposite positions when feature flag resolver returns true', async () => {
    const hook = createCloseOppositeBeforePlaceOrderHook({
      isEnabled: () => true,
    });

    const connector = {} as any;
    const entryContext = {
      strategy: 'TrendLine',
      symbol: 'ETHUSDT',
      interval: '15',
      direction: 'LONG',
      timestamp: 1_700_000_000_000,
      prices: {
        currentPrice: 100,
        takeProfitPrice: 110,
        stopLossPrice: 95,
        riskRatio: 2,
      },
    } as any;

    await hook({
      connector,
      entryContext,
      config: {} as any,
      runtime: undefined,
      decision: {} as any,
      signal: undefined,
      strategyName: 'TrendLine',
      userName: 'root',
      symbol: 'ETHUSDT',
      env: 'LIVE',
      isConfigFromBacktest: false,
    });

    expect(mockedCloseOppositePositionsBeforeOpen).toHaveBeenCalledTimes(1);
    expect(mockedCloseOppositePositionsBeforeOpen).toHaveBeenCalledWith({
      connector,
      entryContext,
    });
  });
});
