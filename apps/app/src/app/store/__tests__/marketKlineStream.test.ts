import {
  buildDashboardKlineTopic,
  parseMarketKlineMessage,
} from '../marketKlineStream';

describe('dashboard market kline stream', () => {
  it('builds a topic and parses candle messages', () => {
    const topic = buildDashboardKlineTopic({
      provider: 'bybit',
      universe: 'crypto',
      symbol: 'btcusdt',
      interval: '15',
    });
    expect(topic).toBe('bybit:crypto:BTCUSDT:15');
    expect(
      parseMarketKlineMessage(
        JSON.stringify({
          type: 'kline',
          topic,
          event: { candle: { timestamp: 1 } },
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        type: 'kline',
        topic,
      }),
    );
  });

  it('rejects invalid messages', () => {
    expect(parseMarketKlineMessage('bad')).toBeNull();
    expect(
      parseMarketKlineMessage(JSON.stringify({ type: 'other' })),
    ).toBeNull();
  });
});
