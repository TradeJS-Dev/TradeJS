const mockFetchArkhamOnchainWindow = jest.fn();
const mockResolveArkhamTokenId = jest.fn();
const mockUpsertOnchainFlowRows = jest.fn();
const mockWaitForDbReady = jest.fn();
const mockGetUserSettings = jest.fn();

jest.mock('@tradejs/connectors', () => ({
  fetchArkhamOnchainWindow: (...args: unknown[]) =>
    mockFetchArkhamOnchainWindow(...args),
  parseArkhamSymbolTokenIds: (value: unknown) =>
    String(value ?? '')
      .split(',')
      .filter(Boolean)
      .reduce((acc: Record<string, string>, item) => {
        const [symbol, tokenId] = item.split('=');
        if (symbol && tokenId)
          acc[symbol.trim().toUpperCase()] = tokenId.trim();
        return acc;
      }, {}),
  resolveArkhamTokenId: (...args: unknown[]) =>
    mockResolveArkhamTokenId(...args),
}));

jest.mock('@tradejs/infra/timescale', () => ({
  upsertOnchainFlowRows: (...args: unknown[]) =>
    mockUpsertOnchainFlowRows(...args),
  waitForDbReady: (...args: unknown[]) => mockWaitForDbReady(...args),
}));

jest.mock('@tradejs/infra/userSettings', () => ({
  getUserSettings: (...args: unknown[]) => mockGetUserSettings(...args),
}));

describe('onchainIngest script', () => {
  const originalArgv = process.argv;
  const originalEnv = process.env;
  const realDateNow = Date.now;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.argv = [...originalArgv];
    Date.now = jest.fn(() => Date.UTC(2026, 0, 1, 1, 0, 0));
    mockWaitForDbReady.mockResolvedValue(undefined);
    mockGetUserSettings.mockResolvedValue({
      ARKHAM_API_KEY: 'user-arkham-key',
    });
    mockResolveArkhamTokenId.mockReturnValue('ethereum');
    mockFetchArkhamOnchainWindow.mockResolvedValue([
      {
        symbol: 'ETHUSDT',
        interval: '1h',
        ts: new Date(Date.UTC(2026, 0, 1, 1, 0, 0)),
        cexDepositUsd: 100,
        cexWithdrawUsd: 200,
        source: 'arkham',
      },
    ]);
    mockUpsertOnchainFlowRows.mockResolvedValue(undefined);
  });

  afterAll(() => {
    process.argv = originalArgv;
    process.env = originalEnv;
    Date.now = realDateNow;
  });

  it('fetches Arkham windows and upserts onchain rows', async () => {
    process.argv = [
      'node',
      'onchainIngest.ts',
      '--symbols',
      'ETHUSDT',
      '--intervals',
      '1h',
      '--hours',
      '1',
      '--chains',
      'ethereum,bsc',
      '--tokenIds',
      'ETHUSDT=ethereum',
      '--smartEntities',
      'smart-a',
      '--whaleEntities',
      'whale-a',
      '--dexBases',
      'dex-a',
      '--usdGte',
      '100',
      '--maxWindows',
      '1',
    ];

    const { main } = await import('../scripts/onchainIngest');
    await main();

    expect(mockWaitForDbReady).toHaveBeenCalledTimes(1);
    expect(mockGetUserSettings).toHaveBeenCalledWith('root');
    expect(mockResolveArkhamTokenId).toHaveBeenCalledWith('ETHUSDT', {
      ETHUSDT: 'ethereum',
    });
    expect(mockFetchArkhamOnchainWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'ETHUSDT',
        tokenId: 'ethereum',
        apiKey: 'user-arkham-key',
        interval: '1h',
        fromMs: Date.UTC(2026, 0, 1, 0, 0, 0),
        toMs: Date.UTC(2026, 0, 1, 0, 59, 59, 999),
        chains: ['ethereum', 'bsc'],
        smartEntities: ['smart-a'],
        whaleEntities: ['whale-a'],
        dexBases: ['dex-a'],
        usdGte: 100,
      }),
    );
    expect(mockUpsertOnchainFlowRows).toHaveBeenCalledWith([
      expect.objectContaining({
        symbol: 'ETHUSDT',
        source: 'arkham',
      }),
    ]);
  });

  it('falls back to ARKHAM_API_KEY from env', async () => {
    process.env.ARKHAM_API_KEY = 'env-arkham-key';
    mockGetUserSettings.mockResolvedValue({
      ARKHAM_API_KEY: '',
    });
    process.argv = [
      'node',
      'onchainIngest.ts',
      '--symbols',
      'ETHUSDT',
      '--intervals',
      '1h',
      '--hours',
      '1',
      '--maxWindows',
      '1',
    ];

    const { main } = await import('../scripts/onchainIngest');
    await main();

    expect(mockFetchArkhamOnchainWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'env-arkham-key',
      }),
    );
  });

  it('throws when Arkham API key is missing', async () => {
    mockGetUserSettings.mockResolvedValue({
      ARKHAM_API_KEY: '',
    });
    process.argv = [
      'node',
      'onchainIngest.ts',
      '--symbols',
      'ETHUSDT',
      '--intervals',
      '1h',
    ];

    const { main } = await import('../scripts/onchainIngest');
    await expect(main()).rejects.toThrow('Missing ARKHAM_API_KEY');
  });
});
