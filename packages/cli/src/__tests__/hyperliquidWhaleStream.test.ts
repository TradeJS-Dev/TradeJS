import { parseHyperliquidTradesMessage } from '../lib/hyperliquidWhaleStream';

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
});
