/** @jest-environment node */
const mockSettings = jest.fn();
jest.mock('@tradejs/infra/userSettings', () => ({
  getUserSettings: (...args: unknown[]) => mockSettings(...args),
}));
import {
  resolveBacktestJev,
  resolveBacktestAiExportEnabled,
} from '../lib/backtest/jevOptions';

describe('backtest Jev opt-in', () => {
  beforeEach(() => {
    mockSettings.mockReset();
    mockSettings.mockResolvedValue({
      JEV_API_KEY: 'test-key',
      JEV_API_ENDPOINT: 'https://openrouter.ai/api/alpha/decisions',
      JEV_MODEL: 'typesafe/jev-1.13',
    });
  });
  it('does not read credentials without --jev', async () => {
    expect(await resolveBacktestJev({}, 'root', '/tmp')).toBeUndefined();
    expect(mockSettings).not.toHaveBeenCalled();
    await expect(
      resolveBacktestJev({ jevRecorded: true }, 'root', '/tmp'),
    ).rejects.toThrow('require --jev');
  });
  it('keeps AI export independent of Jev', () => {
    expect(resolveBacktestAiExportEnabled({ jev: true })).toBe(false);
    expect(resolveBacktestAiExportEnabled({ ai: true })).toBe(true);
    expect(resolveBacktestAiExportEnabled({ ai: true, jev: true })).toBe(true);
  });
  it('freezes the provider and defaults to enrichment', async () => {
    expect(await resolveBacktestJev({ jev: true }, 'root', '/tmp')).toEqual({
      source: 'provider',
      mode: 'observe',
      recordsDir: 'data/ai/jev',
      provider: {
        endpoint: 'https://openrouter.ai/api/alpha/decisions',
        model: 'typesafe/jev-1.13',
      },
    });
  });
  it('replays recordings without requiring a provider key', async () => {
    mockSettings.mockResolvedValue({ JEV_API_KEY: '' });
    expect(
      await resolveBacktestJev(
        { jev: true, jevRecorded: true },
        'root',
        '/tmp',
      ),
    ).toMatchObject({ source: 'recorded', mode: 'observe' });
    await expect(
      resolveBacktestJev({ jev: true }, 'root', '/tmp'),
    ).rejects.toThrow('API key');
  });
  it('rejects ambiguous local and recorded sources', async () => {
    await expect(
      resolveBacktestJev(
        { jev: true, jevRecorded: true, jevModelFile: 'model.json' },
        'root',
        '/tmp',
      ),
    ).rejects.toThrow('Choose');
  });
});
