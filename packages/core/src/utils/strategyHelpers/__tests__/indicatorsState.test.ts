import { createStrategyIndicatorsState } from '../indicators';
import { createIndicators } from '../../../indicators';

jest.mock('../../../indicators', () => ({
  createIndicators: jest.fn(),
}));

describe('strategy indicators state latestNumber', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates latestNumber to the indicators controller without building snapshot', () => {
    const next = jest.fn();
    const result = jest.fn(() => ({ correlation: [0.1, 0.2] }));
    const latestNumber = jest.fn(() => 0.2);

    (createIndicators as jest.Mock).mockReturnValue({
      next,
      result,
      latestNumber,
    });

    const state = createStrategyIndicatorsState({
      env: 'BACKTEST',
      data: [],
      btcData: [],
    });

    expect(state.latestNumber('correlation' as any)).toBe(0.2);
    expect(latestNumber).toHaveBeenCalledWith('correlation');
    expect(result).not.toHaveBeenCalled();
  });

  it('initializes live controller once and reuses latestNumber for repeated reads', () => {
    const next = jest.fn();
    const result = jest.fn(() => ({ correlation: [0.1, 0.2] }));
    const latestNumber = jest.fn(() => 0.2);

    (createIndicators as jest.Mock).mockReturnValue({
      next,
      result,
      latestNumber,
    });

    const candle = {
      timestamp: 1,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
      turnover: 1,
    };
    const btcCandle = { ...candle, close: 2 };
    const state = createStrategyIndicatorsState({
      env: 'RUNTIME',
      data: [candle as any],
      btcData: [btcCandle as any],
    });

    expect(state.latestNumber('correlation' as any)).toBe(0.2);
    expect(state.latestNumber('correlation' as any)).toBe(0.2);

    expect(createIndicators).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(latestNumber).toHaveBeenCalledTimes(2);
    expect(result).not.toHaveBeenCalled();
  });
});
