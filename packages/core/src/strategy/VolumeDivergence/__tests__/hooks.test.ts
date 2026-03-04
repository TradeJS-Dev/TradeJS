import { closeOppositePositionsBeforeOpen } from '@utils/closeOppositePositionsBeforeOpen';
import { volumeDivergenceBeforePlaceOrderHook } from '../hooks';

jest.mock('@utils/closeOppositePositionsBeforeOpen', () => ({
  closeOppositePositionsBeforeOpen: jest.fn(),
}));

const mockedCloseOppositePositionsBeforeOpen =
  closeOppositePositionsBeforeOpen as jest.MockedFunction<
    typeof closeOppositePositionsBeforeOpen
  >;

const makeHookParams = (config: Record<string, unknown>) =>
  ({
    connector: {} as any,
    entryContext: {
      strategy: 'VolumeDivergence',
      symbol: 'ETHUSDT',
      interval: '15',
      direction: 'LONG',
      timestamp: 1_700_000_000_000,
      prices: {
        currentPrice: 100,
        takeProfitPrice: 105,
        stopLossPrice: 95,
        riskRatio: 2,
      },
    },
    config,
    runtime: undefined,
    decision: {} as any,
    signal: undefined,
    strategyName: 'VolumeDivergence',
    userName: 'root',
    symbol: 'ETHUSDT',
    env: 'LIVE',
    isConfigFromBacktest: false,
  }) as any;

describe('volumeDivergenceBeforePlaceOrderHook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips closing opposite positions when CLOSE_OPPOSITE_POSITIONS is disabled', async () => {
    await volumeDivergenceBeforePlaceOrderHook(
      makeHookParams({ CLOSE_OPPOSITE_POSITIONS: false }),
    );

    expect(mockedCloseOppositePositionsBeforeOpen).not.toHaveBeenCalled();
  });

  it('closes opposite positions when CLOSE_OPPOSITE_POSITIONS is enabled', async () => {
    const params = makeHookParams({ CLOSE_OPPOSITE_POSITIONS: true });

    await volumeDivergenceBeforePlaceOrderHook(params);

    expect(mockedCloseOppositePositionsBeforeOpen).toHaveBeenCalledTimes(1);
    expect(mockedCloseOppositePositionsBeforeOpen).toHaveBeenCalledWith({
      connector: params.connector,
      entryContext: params.entryContext,
    });
  });
});
