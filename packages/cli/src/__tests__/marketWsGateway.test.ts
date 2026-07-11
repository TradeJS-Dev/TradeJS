import {
  applySubscriptionCommand,
  parseSubscriptionCommand,
} from '../lib/marketData/marketWsGateway';

describe('market websocket gateway subscriptions', () => {
  it('validates and applies subscribe/unsubscribe commands', () => {
    const subscribe = parseSubscriptionCommand(
      JSON.stringify({
        op: 'subscribe',
        topics: ['bybit:crypto:BTCUSDT:15', '../invalid'],
      }),
    );
    expect(subscribe).toEqual({
      op: 'subscribe',
      topics: ['bybit:crypto:BTCUSDT:15'],
    });
    const subscribed = applySubscriptionCommand(new Set(), subscribe!);
    expect([...subscribed]).toEqual(['bybit:crypto:BTCUSDT:15']);
    const unsubscribed = applySubscriptionCommand(subscribed, {
      op: 'unsubscribe',
      topics: ['bybit:crypto:BTCUSDT:15'],
    });
    expect(unsubscribed.size).toBe(0);
  });

  it('rejects malformed commands', () => {
    expect(parseSubscriptionCommand('bad')).toBeNull();
    expect(
      parseSubscriptionCommand(JSON.stringify({ op: 'subscribe', topics: [] })),
    ).toBeNull();
  });
});
