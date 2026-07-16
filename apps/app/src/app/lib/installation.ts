import bcrypt from 'bcryptjs';
import { getData, redisKeys, setData } from '@tradejs/infra/redis';
import type { StrategyConfigGrid } from '@tradejs/types';

export const INSTALL_USER_NAME = 'root';
export const FIRST_BACKTEST_CONFIG_ID = 'MaStrategy:base';

export const FIRST_BACKTEST_CONFIG: StrategyConfigGrid = {
  INTERVAL: ['15'],
  MAX_LOSS_VALUE: [10],
  MA_FAST: [21],
  MA_SLOW: [55],
  LONG: [
    {
      enable: true,
      direction: 'LONG',
      TP: 2,
      SL: 1,
      minRiskRatio: 1.2,
    },
  ],
  SHORT: [
    {
      enable: true,
      direction: 'SHORT',
      TP: 2,
      SL: 1,
      minRiskRatio: 1.2,
    },
  ],
};

export const getPasswordHash = (user: unknown): string | null => {
  if (!user) return null;
  if (typeof user === 'string') return user;
  if (typeof user !== 'object') return null;

  const record = user as Record<string, unknown>;
  const direct = record.passwordHash ?? record.password;
  if (typeof direct === 'string') return direct;

  const nested = record.password as Record<string, unknown> | undefined;
  const nestedHash = nested?.hash;
  if (typeof nestedHash === 'string') return nestedHash;

  const alt = record.hash;
  return typeof alt === 'string' ? alt : null;
};

export const isInstallationRequired = async () => {
  const user = await getData(redisKeys.user(INSTALL_USER_NAME), null);
  return !getPasswordHash(user);
};

export const initializeInstallation = async (password: string) => {
  const existing = (await getData(
    redisKeys.user(INSTALL_USER_NAME),
    null,
  )) as Record<string, unknown> | null;

  if (getPasswordHash(existing)) {
    return false;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await setData(
    redisKeys.user(INSTALL_USER_NAME),
    {
      ...(existing ?? {}),
      passwordHash,
      userName: INSTALL_USER_NAME,
      updatedAt: new Date().toISOString(),
    },
    { expire: 0 },
  );
  await setData(
    redisKeys.backtestConfig(INSTALL_USER_NAME, FIRST_BACKTEST_CONFIG_ID),
    FIRST_BACKTEST_CONFIG,
    { expire: 0 },
  );

  return true;
};
