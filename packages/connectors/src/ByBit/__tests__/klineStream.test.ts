import { EventEmitter } from 'events';
import {
  buildBybitKlineTopic,
  createBybitKlineStreamWithClient,
  parseBybitKlineEvent,
} from '../klineStream';

class MockClient extends EventEmitter {
  subscribeV5 = jest.fn(() => [Promise.resolve()]);
  unsubscribeV5 = jest.fn(() => [Promise.resolve()]);
  closeAll = jest.fn();
}

describe('Bybit kline stream', () => {
  it('maps a confirmed kline update', () => {
    expect(
      parseBybitKlineEvent(
        {
          topic: 'kline.15.BTCUSDT',
          data: [
            {
              start: 900_000,
              open: '100',
              high: '110',
              low: '90',
              close: '105',
              volume: '12',
              turnover: '1234',
              confirm: true,
            },
          ],
        },
        999,
      ),
    ).toEqual([
      expect.objectContaining({
        symbol: 'BTCUSDT',
        interval: '15',
        confirm: true,
        receivedAt: 999,
        candle: expect.objectContaining({
          timestamp: 900_000,
          close: 105,
          volume: 12,
        }),
      }),
    ]);
  });

  it('rejects malformed OHLC data', () => {
    expect(
      parseBybitKlineEvent({
        topic: 'kline.15.BTCUSDT',
        data: [
          {
            start: 1,
            open: '100',
            high: '99',
            low: '90',
            close: '105',
            volume: '1',
            turnover: '1',
          },
        ],
      }),
    ).toEqual([]);
  });

  it('diffs subscriptions and closes the client', async () => {
    const client = new MockClient();
    const onEvent = jest.fn();
    const stream = createBybitKlineStreamWithClient({
      client: client as any,
      onEvent,
    });

    stream.setSubscriptions(['btcusdt', 'ETHUSDT'], '15');
    expect(client.subscribeV5).toHaveBeenCalledWith(
      [
        buildBybitKlineTopic('BTCUSDT', '15'),
        buildBybitKlineTopic('ETHUSDT', '15'),
      ],
      'linear',
    );

    stream.setSubscriptions(['ETHUSDT'], '15');
    expect(client.unsubscribeV5).toHaveBeenCalledWith(
      [buildBybitKlineTopic('BTCUSDT', '15')],
      'linear',
    );

    client.emit('update', {
      topic: 'kline.15.ETHUSDT',
      data: [
        {
          start: 900_000,
          open: '100',
          high: '110',
          low: '90',
          close: '105',
          volume: '12',
          turnover: '1234',
          confirm: true,
        },
      ],
    });
    await Promise.resolve();
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'ETHUSDT', confirm: true }),
    );

    await stream.close();
    expect(client.closeAll).toHaveBeenCalledTimes(1);
  });
});
