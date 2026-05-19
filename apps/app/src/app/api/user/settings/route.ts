import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { normalizeAiResponseLanguage } from '@tradejs/infra/aiLanguages';
import { normalizeAiEndpoint } from '@tradejs/infra/aiEndpoints';
import { normalizeAiModel } from '@tradejs/infra/aiModels';
import {
  getUserRecord,
  getUserSettings,
  updateUserRecord,
  type UserRecord,
  type UserSettings,
} from '@tradejs/infra/userSettings';
import { getCurrentUserName } from '#app/lib/currentUser';

export const dynamic = 'force-dynamic';

type UpdateBody =
  | {
      section: 'bybit';
      data?: {
        apiKey?: string;
        apiSecret?: string;
      };
    }
  | {
      section: 'coinalyze';
      data?: {
        apiKey?: string;
      };
    }
  | {
      section: 'ai';
      data?: {
        apiKey?: string;
        apiEndpoint?: string;
        model?: string;
        responseLanguage?: string;
      };
    }
  | {
      section: 'telegram';
      data?: {
        botToken?: string;
        chatId?: string;
      };
    }
  | {
      section: 'password';
      data?: {
        password?: string;
        confirmPassword?: string;
      };
    };

const cleanText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const cleanOptionalText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const maskSecret = (value: string) => {
  const trimmed = cleanText(value);
  if (!trimmed) {
    return '';
  }

  return `${'*'.repeat(12)}${trimmed.slice(-4) || trimmed}`;
};

const toResponse = (settings: UserSettings) => ({
  userName: settings.userName,
  settings: {
    bybit: {
      apiKey: maskSecret(settings.BYBIT_API_KEY),
      apiSecret: maskSecret(settings.BYBIT_API_SECRET),
    },
    coinalyze: {
      apiKey: maskSecret(settings.COINALYZE_API_KEY),
    },
    ai: {
      apiKey: maskSecret(settings.AI_API_KEY),
      apiEndpoint: settings.AI_API_ENDPOINT,
      model: settings.AI_MODEL,
      responseLanguage: settings.AI_RESPONSE_LANGUAGE,
    },
    telegram: {
      botToken: maskSecret(settings.TG_BOT_TOKEN),
      chatId: settings.TG_CHAT_ID,
    },
  },
});

const hasKeys = (patch: Partial<UserRecord>) => Object.keys(patch).length > 0;

const removeLegacyPasswordlessToken = async (userName: string) => {
  const record = await getUserRecord(userName);
  if (!record || !Object.hasOwn(record, 'token')) {
    return;
  }

  await updateUserRecord(userName, { token: undefined });
};

export const GET = async () => {
  const userName = await getCurrentUserName();
  if (!userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await removeLegacyPasswordlessToken(userName);
  const settings = await getUserSettings(userName);
  return NextResponse.json(toResponse(settings));
};

export const PATCH = async (request: Request) => {
  const userName = await getCurrentUserName();
  if (!userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await removeLegacyPasswordlessToken(userName);
  const body = (await request.json()) as UpdateBody | null;
  if (!body || typeof body !== 'object' || !('section' in body)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  if (body.section === 'password') {
    const password = String(body.data?.password || '');
    const confirmPassword = String(body.data?.confirmPassword || '');

    if (!password) {
      return NextResponse.json(
        { error: 'Password is required' },
        { status: 400 },
      );
    }

    if (password !== confirmPassword) {
      return NextResponse.json(
        { error: 'Password confirmation does not match' },
        { status: 400 },
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await updateUserRecord(userName, { passwordHash });
    const settings = await getUserSettings(userName);
    return NextResponse.json(toResponse(settings));
  }

  if (body.section === 'bybit') {
    const patch: Partial<UserRecord> = {};
    const apiKey = cleanOptionalText(body.data?.apiKey);
    const apiSecret = cleanOptionalText(body.data?.apiSecret);

    if (apiKey) {
      patch.BYBIT_API_KEY = apiKey;
    }

    if (apiSecret) {
      patch.BYBIT_API_SECRET = apiSecret;
    }

    if (hasKeys(patch)) {
      await updateUserRecord(userName, patch);
    }
  }

  if (body.section === 'coinalyze') {
    const apiKey = cleanOptionalText(body.data?.apiKey);

    if (apiKey) {
      await updateUserRecord(userName, { COINALYZE_API_KEY: apiKey });
    }
  }

  if (body.section === 'ai') {
    const currentSettings = await getUserSettings(userName);
    const patch: Partial<UserRecord> = {};
    const apiKey = cleanOptionalText(body.data?.apiKey);
    const apiEndpoint = normalizeAiEndpoint(body.data?.apiEndpoint);
    const effectiveEndpoint = apiEndpoint || currentSettings.AI_API_ENDPOINT;
    const responseLanguage = normalizeAiResponseLanguage(
      body.data?.responseLanguage,
    );

    if (apiKey) {
      patch.AI_API_KEY = apiKey;
    }

    if (body.data && 'apiEndpoint' in body.data && !apiEndpoint) {
      return NextResponse.json(
        { error: 'Invalid AI API endpoint URL' },
        { status: 400 },
      );
    }

    if (apiEndpoint) {
      patch.AI_API_ENDPOINT = apiEndpoint;
    }

    if (
      body.data &&
      ('apiEndpoint' in body.data || 'model' in body.data) &&
      effectiveEndpoint
    ) {
      patch.AI_MODEL = normalizeAiModel(body.data?.model, effectiveEndpoint);
    }

    if (body.data && 'responseLanguage' in body.data) {
      patch.AI_RESPONSE_LANGUAGE = responseLanguage;
    }

    if (hasKeys(patch)) {
      await updateUserRecord(userName, patch);
    }
  }

  if (body.section === 'telegram') {
    const patch: Partial<UserRecord> = {};
    const botToken = cleanOptionalText(body.data?.botToken);

    if (botToken) {
      patch.TG_BOT_TOKEN = botToken;
    }

    if (body.data && 'chatId' in body.data) {
      patch.TG_CHAT_ID = cleanText(body.data.chatId);
    }

    if (hasKeys(patch)) {
      await updateUserRecord(userName, patch);
    }
  }

  const settings = await getUserSettings(userName);
  return NextResponse.json(toResponse(settings));
};
