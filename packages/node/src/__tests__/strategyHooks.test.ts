import { createCloseOppositeBeforePlaceOrderHook } from '@tradejs/node/strategies';
import { closeOppositePositionsBeforeOpen } from '../closeOppositePositionsBeforeOpen';

jest.mock('../closeOppositePositionsBeforeOpen', () => ({
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
      ctx: {
        connector,
        strategyName: 'TrendLine',
        userName: 'root',
        symbol: 'ETHUSDT',
        strategyConfig: {} as any,
        env: 'LIVE',
        isConfigFromBacktest: false,
      },
      market: {} as any,
      decision: {} as any,
      entry: {
        context: entryContext,
        orderPlan: {} as any,
        signal: undefined,
        runtime: {
          raw: undefined,
          resolved: {} as any,
        },
      },
      policy: {
        aiQuality: undefined,
        makeOrdersEnabled: true,
        minAiQuality: 4,
      },
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
      ctx: {
        connector,
        strategyName: 'TrendLine',
        userName: 'root',
        symbol: 'ETHUSDT',
        strategyConfig: {} as any,
        env: 'LIVE',
        isConfigFromBacktest: false,
      },
      market: {} as any,
      decision: {} as any,
      entry: {
        context: entryContext,
        orderPlan: {} as any,
        signal: undefined,
        runtime: {
          raw: undefined,
          resolved: {} as any,
        },
      },
      policy: {
        aiQuality: undefined,
        makeOrdersEnabled: true,
        minAiQuality: 4,
      },
    });

    expect(mockedCloseOppositePositionsBeforeOpen).toHaveBeenCalledTimes(1);
    expect(mockedCloseOppositePositionsBeforeOpen).toHaveBeenCalledWith({
      connector,
      entryContext,
    });
  });
});
