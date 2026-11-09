import { prepareTickerProfiles } from '../lib/tickerProfiles';
const mockCandles = jest.fn(),
  mockWrite = jest.fn();
jest.mock('@tradejs/infra/timescale/candles', () => ({
  getKlineCandlesRange: (...args: unknown[]) => mockCandles(...args),
}));
jest.mock('@tradejs/infra/tickerProfiles', () => ({
  writeTickerProfiles: (...args: unknown[]) => mockWrite(...args),
}));
beforeEach(() => {
  mockCandles.mockReset().mockResolvedValue([]);
  mockWrite.mockReset().mockResolvedValue('sha');
});
it('prepares one immutable snapshot per month from cached closed hours with explicit membership', async () => {
  const result = await prepareTickerProfiles({
    projectRoot: '/project',
    provider: 'bybit',
    universeId: 'fixture',
    symbols: ['ETHUSDT', 'BTCUSDT'],
    start: Date.UTC(2026, 8, 15),
    end: Date.UTC(2026, 10, 1),
  });
  expect(result).toHaveLength(2);
  expect(mockCandles).toHaveBeenCalledTimes(4);
  expect(mockCandles.mock.calls[0]).toEqual([
    'bybit',
    'BTCUSDT',
    60,
    Date.UTC(2026, 8, 1) - 721 * 3_600_000,
    Date.UTC(2026, 8, 1) - 3_600_000,
  ]);
  expect(mockWrite.mock.calls[0][1]).toMatchObject({
    membership: 'frozen-list',
    profiles: expect.arrayContaining([
      expect.objectContaining({ symbol: 'BTCUSDT', moneyGroup: 'unknown' }),
    ]),
  });
});
it('refuses implicit reference membership or non-USDT input before reading history', async () => {
  await expect(
    prepareTickerProfiles({
      projectRoot: '/project',
      provider: 'bybit',
      universeId: 'fixture',
      symbols: ['SOLUSDT'],
      start: Date.UTC(2026, 8, 1),
      end: Date.UTC(2026, 9, 1),
    }),
  ).rejects.toThrow('include BTCUSDT');
  expect(mockCandles).not.toHaveBeenCalled();
});
