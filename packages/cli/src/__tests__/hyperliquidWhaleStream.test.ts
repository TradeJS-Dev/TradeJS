import {
  parseHyperliquidTradesMessage,
  parseHyperliquidUserFillsMessage,
} from '../lib/hyperliquidWhaleStream';

describe('hyperliquidWhaleStream', () => {
  it('accepts only trade channel payloads', () => {
    expect(
      parseHyperliquidTradesMessage(
        JSON.stringify({
          channel: 'trades',
          data: [{ coin: 'BTC', tid: 1, users: ['a', 'b'] }],
        }),
      ),
    ).toEqual([{ coin: 'BTC', tid: 1, users: ['a', 'b'] }]);
    expect(
      parseHyperliquidTradesMessage(
        JSON.stringify({ channel: 'subscriptionResponse', data: {} }),
      ),
    ).toEqual([]);
    expect(parseHyperliquidTradesMessage('{broken')).toEqual([]);
  });

  it('parses position-aware userFills payloads', () => {
    expect(
      parseHyperliquidUserFillsMessage(
        JSON.stringify({
          channel: 'userFills',
          data: {
            user: '0x1111111111111111111111111111111111111111',
            isSnapshot: false,
            fills: [
              {
                coin: 'BTC',
                tid: 1,
                side: 'B',
                startPosition: '0',
              },
            ],
          },
        }),
      ),
    ).toMatchObject({
      address: '0x1111111111111111111111111111111111111111',
      isSnapshot: false,
      fills: [{ startPosition: '0' }],
    });
    expect(parseHyperliquidUserFillsMessage('{broken')).toBeNull();
  });
});
