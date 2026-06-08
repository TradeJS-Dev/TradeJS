import {
  createStrategyIndicatorsState,
  releaseStrategyIndicatorsReplayCache,
} from '../indicators';
import { createIndicators } from '../../../indicators';

jest.mock('../../../indicators', () => ({
  ...jest.requireActual('../../../indicators'),
  createIndicators: jest.fn(),
}));

describe('strategy indicators state latestNumber', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    releaseStrategyIndicatorsReplayCache('test');
  });

  afterEach(() => {
    releaseStrategyIndicatorsReplayCache('test');
  });

  it('defers backtest controller initialization until indicators are read', () => {
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
      env: 'BACKTEST',
      data: [candle as any],
      btcData: [btcCandle as any],
    });

    expect(state.isInitialized()).toBe(false);
    expect(createIndicators).not.toHaveBeenCalled();

    expect(state.snapshot()).toEqual({ correlation: [0.1, 0.2] });

    expect(state.isInitialized()).toBe(true);
    expect(createIndicators).toHaveBeenCalledTimes(1);
    expect(createIndicators).toHaveBeenCalledWith(
      [candle],
      [btcCandle],
      expect.any(Object),
    );
    expect(next).not.toHaveBeenCalled();
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

  it('shares a backtest replay controller across states with the same key', () => {
    const next = jest.fn(() => ({ maFast: 10 }));
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
    const first = createStrategyIndicatorsState({
      env: 'BACKTEST',
      data: [],
      btcData: [],
      sharedReplayKey: 'test:shared',
    });
    const second = createStrategyIndicatorsState({
      env: 'BACKTEST',
      data: [],
      btcData: [],
      sharedReplayKey: 'test:shared',
    });

    first.onBar(candle as any, btcCandle as any);
    second.onBar(candle as any, btcCandle as any);

    expect(createIndicators).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(first.snapshot()).toEqual({ correlation: [0.1, 0.2] });
    expect(second.latestNumber('correlation' as any)).toBe(0.2);
  });

  it('shares a parity replay controller across states with the same key', () => {
    const next = jest.fn(() => ({ maFast: 10 }));
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
    const first = createStrategyIndicatorsState({
      env: 'PARITY',
      data: [],
      btcData: [],
      sharedReplayKey: 'test:shared-parity',
    });
    const second = createStrategyIndicatorsState({
      env: 'PARITY',
      data: [],
      btcData: [],
      sharedReplayKey: 'test:shared-parity',
    });

    first.onBar(candle as any, btcCandle as any);
    second.onBar(candle as any, btcCandle as any);

    expect(createIndicators).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('replays only history before an explicit current candle in next()', () => {
    const next = jest.fn(() => ({ maFast: 10 }));
    const result = jest.fn(() => ({ correlation: [0.1, 0.2] }));
    const latestNumber = jest.fn(() => 0.2);
    const latestSnapshot = jest.fn(() => ({ maFast: 10 }));

    (createIndicators as jest.Mock).mockReturnValue({
      next,
      result,
      latestNumber,
      latestSnapshot,
    });

    const previous = {
      timestamp: 1,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
      turnover: 1,
    };
    const current = { ...previous, timestamp: 2, close: 2 };
    const previousBtc = { ...previous, close: 101 };
    const currentBtc = { ...current, close: 102 };
    const state = createStrategyIndicatorsState({
      env: 'BACKTEST',
      data: [previous as any, current as any],
      btcData: [previousBtc as any, currentBtc as any],
    });

    expect(state.next(current as any, currentBtc as any)).toEqual({
      maFast: 10,
    });

    expect(createIndicators).toHaveBeenCalledWith(
      [previous],
      [previousBtc],
      expect.any(Object),
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(current, currentBtc);
  });

  it('passes the current ETH reference candle by timestamp when available', () => {
    const next = jest.fn(() => ({ maFast: 10 }));
    const result = jest.fn(() => ({ correlation: [0.1, 0.2] }));
    const latestNumber = jest.fn(() => 0.2);
    const latestSnapshot = jest.fn(() => ({ maFast: 20 }));

    (createIndicators as jest.Mock).mockReturnValue({
      next,
      result,
      latestNumber,
      latestSnapshot,
    });

    const previous = {
      timestamp: 1,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
      turnover: 1,
    };
    const current = { ...previous, timestamp: 2, close: 2 };
    const previousBtc = { ...previous, close: 101 };
    const currentBtc = { ...current, close: 102 };
    const previousEth = { ...previous, close: 1_001 };
    const currentEth = { ...current, close: 1_002 };
    const ethData = [currentEth as any, previousEth as any];
    const state = createStrategyIndicatorsState({
      env: 'BACKTEST',
      data: [previous as any, current as any],
      btcData: [previousBtc as any, currentBtc as any],
      ethData,
    });

    expect(state.next(current as any, currentBtc as any)).toEqual({
      maFast: 10,
    });

    expect(createIndicators).toHaveBeenCalledWith(
      [previous],
      [previousBtc],
      expect.objectContaining({
        ethData: [previousEth],
      }),
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(current, currentBtc, currentEth);
  });

  it('returns the current snapshot without replaying when snapshot already synced current candle', () => {
    const next = jest.fn(() => ({ maFast: 10 }));
    const result = jest.fn(() => ({ correlation: [0.1, 0.2] }));
    const latestNumber = jest.fn(() => 0.2);
    const latestSnapshot = jest.fn(() => ({ maFast: 20 }));

    (createIndicators as jest.Mock).mockReturnValue({
      next,
      result,
      latestNumber,
      latestSnapshot,
    });

    const previous = {
      timestamp: 1,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
      turnover: 1,
    };
    const current = { ...previous, timestamp: 2, close: 2 };
    const previousBtc = { ...previous, close: 101 };
    const currentBtc = { ...current, close: 102 };
    const state = createStrategyIndicatorsState({
      env: 'BACKTEST',
      data: [previous as any, current as any],
      btcData: [previousBtc as any, currentBtc as any],
    });

    expect(state.snapshot()).toEqual({ correlation: [0.1, 0.2] });
    expect(state.next(current as any, currentBtc as any)).toEqual({
      maFast: 20,
    });

    expect(createIndicators).toHaveBeenCalledWith(
      [previous, current],
      [previousBtc, currentBtc],
      expect.any(Object),
    );
    expect(next).not.toHaveBeenCalled();
    expect(latestSnapshot).toHaveBeenCalledTimes(1);
  });

  it('shares the current snapshot after a shared replay snapshot sync', () => {
    const next = jest.fn(() => ({ maFast: 10 }));
    const result = jest.fn(() => ({ correlation: [0.1, 0.2] }));
    const latestNumber = jest.fn(() => 0.2);
    const latestSnapshot = jest.fn(() => ({ maFast: 20 }));

    (createIndicators as jest.Mock).mockReturnValue({
      next,
      result,
      latestNumber,
      latestSnapshot,
    });

    const current = {
      timestamp: 2,
      open: 1,
      high: 1,
      low: 1,
      close: 2,
      volume: 1,
      turnover: 1,
    };
    const currentBtc = { ...current, close: 102 };
    const first = createStrategyIndicatorsState({
      env: 'BACKTEST',
      data: [current as any],
      btcData: [currentBtc as any],
      sharedReplayKey: 'test:shared-current',
    });
    const second = createStrategyIndicatorsState({
      env: 'BACKTEST',
      data: [current as any],
      btcData: [currentBtc as any],
      sharedReplayKey: 'test:shared-current',
    });

    expect(first.snapshot()).toEqual({ correlation: [0.1, 0.2] });
    expect(second.next(current as any, currentBtc as any)).toEqual({
      maFast: 20,
    });

    expect(createIndicators).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    expect(latestSnapshot).toHaveBeenCalledTimes(1);
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
    expect(next).not.toHaveBeenCalled();
    expect(latestNumber).toHaveBeenCalledTimes(2);
    expect(result).not.toHaveBeenCalled();
  });
});
