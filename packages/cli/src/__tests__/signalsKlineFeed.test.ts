import { createSignalsKlineFeed } from '../lib/signals/klineFeed';

describe('signals websocket kline feed', () => {
  it('publishes live updates, persists confirmed candles and reports missing symbols', async () => {
    let onEvent: ((event: any) => Promise<void> | void) | undefined;
    const setSubscriptions = jest.fn();
    const close = jest.fn(async () => undefined);
    const publish = jest.fn(async () => 1);
    const persist = jest.fn(async () => undefined);
    const feed = await createSignalsKlineFeed({
      config: { userName: 'root', universe: 'crypto' },
      interval: '15',
      universe: 'crypto',
      publish,
      persist,
      streamFactory: jest.fn(async (options) => {
        onEvent = options.onEvent;
        return { setSubscriptions, close };
      }),
    });

    feed.setSubscriptions(['BTCUSDT', 'ETHUSDT']);
    expect(setSubscriptions).toHaveBeenCalledWith(['BTCUSDT', 'ETHUSDT'], '15');

    await onEvent?.({
      symbol: 'BTCUSDT',
      interval: '15',
      candle: {
        dt: 'x',
        timestamp: 900_000,
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 3,
        turnover: 4,
      },
      confirm: false,
      receivedAt: 1,
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();

    await onEvent?.({
      symbol: 'BTCUSDT',
      interval: '15',
      candle: {
        dt: 'x',
        timestamp: 900_000,
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 3,
        turnover: 4,
      },
      confirm: true,
      receivedAt: 2,
    });
    expect(
      await feed.waitForClosed({
        symbols: ['BTCUSDT', 'ETHUSDT'],
        timestamp: 900_000,
        timeoutMs: 0,
      }),
    ).toEqual(['ETHUSDT']);
    await feed.flush();
    expect(persist).toHaveBeenCalledWith([
      expect.objectContaining({ symbol: 'BTCUSDT' }),
    ]);

    await feed.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
