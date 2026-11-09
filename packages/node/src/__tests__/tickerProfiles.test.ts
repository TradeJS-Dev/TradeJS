import { buildTickerProfileSnapshot } from '@tradejs/core/tickerProfiles';
import {
  loadTickerProfileContext,
  resetTickerProfileCache,
  withTickerProfile,
  enrichSignalWithTickerProfile,
} from '../strategyHelpers/tickerProfiles';
import type { Signal } from '@tradejs/types';
const mockRead = jest.fn();
jest.mock('@tradejs/infra/tickerProfiles', () => ({
  readTickerProfiles: (...args: unknown[]) => mockRead(...args),
}));
jest.mock('../tradejsConfig', () => ({
  getTradejsProjectCwd: () => '/project',
}));
jest.mock('../strategy/manifests', () => ({
  getStrategyManifest: () => undefined,
}));
const asOf = Date.UTC(2026, 9, 1);
const snapshot = buildTickerProfileSnapshot({
  asOf,
  provider: 'bybit',
  universeId: 'usdt',
  membership: 'frozen-list',
  candlesBySymbol: { BTCUSDT: [] },
});
beforeEach(() => {
  mockRead.mockReset();
  resetTickerProfileCache();
  delete process.env.TICKER_PROFILES_PROVIDER;
  delete process.env.TICKER_PROFILES_UNIVERSE;
});
afterEach(() => {
  delete process.env.TICKER_PROFILES_PROVIDER;
  delete process.env.TICKER_PROFILES_UNIVERSE;
});
it('shares one read across signals, isolates universe identity, and never uses an earlier month', async () => {
  mockRead.mockResolvedValue({ snapshotId: 'fixture', snapshot });
  const input = {
    projectRoot: '/project',
    provider: 'bybit',
    universeId: 'usdt',
    symbol: 'BTCUSDT',
    timestamp: asOf + 1000,
  };
  const results = await Promise.all([
    loadTickerProfileContext(input),
    loadTickerProfileContext({ ...input, timestamp: asOf + 2000 }),
  ]);
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(results[0]).toBe(results[1]);
  mockRead.mockResolvedValue(null);
  expect(
    await loadTickerProfileContext({
      ...input,
      timestamp: Date.UTC(2026, 10, 1),
    }),
  ).toBeUndefined();
  expect(mockRead).toHaveBeenCalledTimes(2);
});
it('does no storage work when not configured and preserves old signal shape', async () => {
  const s: Signal = {
    signalId: 's',
    symbol: 'BTCUSDT',
    strategy: 'Fixture',
    interval: '15',
    direction: 'LONG',
    timestamp: asOf,
    figures: {},
    indicators: {},
    prices: {
      currentPrice: 1,
      stopLossPrice: 0.5,
      takeProfitPrice: 2,
      riskRatio: 2,
    },
  };
  const before = JSON.stringify(s);
  await enrichSignalWithTickerProfile(s);
  expect(JSON.stringify(s)).toBe(before);
  expect(mockRead).not.toHaveBeenCalled();
  process.env.TICKER_PROFILES_PROVIDER = 'bybit';
  process.env.TICKER_PROFILES_UNIVERSE = 'usdt';
  mockRead.mockResolvedValue({ snapshotId: 'fixture', snapshot });
  await enrichSignalWithTickerProfile(s);
  expect(s.additionalIndicators?.tickerProfile.snapshotId).toBe('fixture');
  expect(s.additionalIndicators).not.toHaveProperty('baseContext');
});
it('rejects a mismatched persisted universe instead of using another profile', async () => {
  mockRead.mockResolvedValue({ snapshotId: 'fixture', snapshot });
  await expect(
    loadTickerProfileContext({
      projectRoot: '/project',
      provider: 'bybit',
      universeId: 'other',
      symbol: 'BTCUSDT',
      timestamp: asOf,
    }),
  ).rejects.toThrow('mismatch');
});

it('attaches a profile without evaluating lazy context fields or mutating the shared base', () => {
  const readZones = jest.fn(() => ({ count: 3 }));
  const base = {
    get zones() {
      return readZones();
    },
  };
  const profile = {
    ...snapshot.profiles[0],
    definition: snapshot.definition,
    provider: 'bybit',
    universeId: 'usdt',
    snapshotId: 'sha',
  };
  const enriched = withTickerProfile(base, profile);
  expect(readZones).not.toHaveBeenCalled();
  expect(base).not.toHaveProperty('tickerProfile');
  expect(enriched.tickerProfile).toBe(profile);
  expect(enriched.zones).toEqual({ count: 3 });
  expect(readZones).toHaveBeenCalledTimes(1);
});
