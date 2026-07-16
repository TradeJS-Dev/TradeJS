const getDataMock = jest.fn();
const setDataMock = jest.fn();
const hashMock = jest.fn();

jest.mock('bcryptjs', () => ({
  hash: (...args: unknown[]) => hashMock(...args),
}));

jest.mock('@tradejs/infra/redis', () => ({
  getData: (...args: unknown[]) => getDataMock(...args),
  setData: (...args: unknown[]) => setDataMock(...args),
  redisKeys: {
    user: (userName: string) => `user:${userName}`,
    backtestConfig: (userName: string, configId: string) =>
      `backtest:${userName}:${configId}`,
  },
}));

import {
  FIRST_BACKTEST_CONFIG,
  initializeInstallation,
  isInstallationRequired,
} from '../installation';

describe('TradeJS installation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hashMock.mockResolvedValue('password-hash');
  });

  it('requires installation while root has no password', async () => {
    getDataMock.mockResolvedValue({ userName: 'root' });

    await expect(isInstallationRequired()).resolves.toBe(true);
  });

  it('creates root and the first backtest config', async () => {
    getDataMock.mockResolvedValue(null);

    await expect(initializeInstallation('Password123!')).resolves.toBe(true);

    expect(hashMock).toHaveBeenCalledWith('Password123!', 10);
    expect(setDataMock).toHaveBeenNthCalledWith(
      1,
      'user:root',
      expect.objectContaining({
        userName: 'root',
        passwordHash: 'password-hash',
      }),
      { expire: 0 },
    );
    expect(setDataMock).toHaveBeenNthCalledWith(
      2,
      'backtest:root:MaStrategy:base',
      FIRST_BACKTEST_CONFIG,
      { expire: 0 },
    );
  });

  it('does not overwrite an installed root account', async () => {
    getDataMock.mockResolvedValue({
      userName: 'root',
      passwordHash: 'existing-hash',
    });

    await expect(initializeInstallation('Password123!')).resolves.toBe(false);
    expect(hashMock).not.toHaveBeenCalled();
    expect(setDataMock).not.toHaveBeenCalled();
  });
});
