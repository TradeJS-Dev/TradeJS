import { getData, redisKeys, setData } from './redis';

export interface UserRecord extends Record<string, unknown> {
  userName?: string;
  passwordHash?: string;
  BYBIT_API_KEY?: string;
  BYBIT_API_SECRET?: string;
  COINALYZE_API_KEY?: string;
  COINMARKETCAP_API_KEY?: string;
  AI_API_KEY?: string;
  AI_API_ENDPOINT?: string;
  AI_MODEL?: string;
  AI_RESPONSE_LANGUAGE?: string;
  TG_BOT_TOKEN?: string;
  TG_CHAT_ID?: string;
  updatedAt?: string;
}

export interface UserSettings {
  userName: string;
  BYBIT_API_KEY: string;
  BYBIT_API_SECRET: string;
  COINALYZE_API_KEY: string;
  COINMARKETCAP_API_KEY: string;
  AI_API_KEY: string;
  AI_API_ENDPOINT: string;
  AI_MODEL: string;
  AI_RESPONSE_LANGUAGE: string;
  TG_BOT_TOKEN: string;
  TG_CHAT_ID: string;
}

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const readUserString = (record: UserRecord | null, key: keyof UserRecord) =>
  readString(record?.[key]);

export const getUserRecord = async (
  userName: string,
): Promise<UserRecord | null> => {
  const user = await getData(redisKeys.user(userName), null);
  if (!user || typeof user !== 'object') {
    return null;
  }

  return user as UserRecord;
};

export const getUserSettings = async (
  userName: string,
): Promise<UserSettings> => {
  const record = await getUserRecord(userName);
  return {
    userName,
    BYBIT_API_KEY: readUserString(record, 'BYBIT_API_KEY'),
    BYBIT_API_SECRET: readUserString(record, 'BYBIT_API_SECRET'),
    COINALYZE_API_KEY: readUserString(record, 'COINALYZE_API_KEY'),
    COINMARKETCAP_API_KEY: readUserString(record, 'COINMARKETCAP_API_KEY'),
    AI_API_KEY: readUserString(record, 'AI_API_KEY'),
    AI_API_ENDPOINT: readUserString(record, 'AI_API_ENDPOINT'),
    AI_MODEL: readUserString(record, 'AI_MODEL'),
    AI_RESPONSE_LANGUAGE: readUserString(record, 'AI_RESPONSE_LANGUAGE'),
    TG_BOT_TOKEN: readUserString(record, 'TG_BOT_TOKEN'),
    TG_CHAT_ID: readUserString(record, 'TG_CHAT_ID'),
  };
};

export const updateUserRecord = async (
  userName: string,
  patch: Partial<UserRecord>,
): Promise<UserRecord> => {
  const existing = (await getUserRecord(userName)) ?? {};
  const merged: UserRecord = {
    ...existing,
    ...patch,
    userName,
    updatedAt: new Date().toISOString(),
  };
  const next = Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as UserRecord;

  await setData(redisKeys.user(userName), next, {
    expire: 0,
  });

  return next;
};
