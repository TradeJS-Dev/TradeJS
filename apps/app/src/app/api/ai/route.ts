import { NextRequest, NextResponse } from 'next/server';
import { TTL_1M } from '@tradejs/core/constants';
import { toJson } from '@tradejs/core/data';
import {
  getAiResponseLanguagePromptName,
  normalizeAiResponseLanguage,
} from '@tradejs/core/aiLanguages';
import { invokeAiChat, type AiChatMessage } from '@tradejs/node/ai';
import {
  AIChatHistory,
  AIChatMessage,
  ConnectorCreator,
  Filters,
} from '@tradejs/types';
import { getData, redisKeys, setData } from '@tradejs/infra/redis';
import { logger } from '@tradejs/infra/logger';
import { getUserSettings } from '@tradejs/infra/userSettings';
import { resolveConnectorCreatorByProvider } from '#app/lib/connectorCreator';
import { getCurrentUserName } from '#app/lib/currentUser';

export const dynamic = 'force-dynamic';

const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

const normalizeChatSymbolKey = (symbol: string): string => {
  const normalized = symbol
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);

  if (!normalized) {
    throw new Error('Invalid AI chat symbol');
  }

  return normalized;
};

const getHistoryKey = (userName: string, symbol: string) =>
  redisKeys.aiChatHistory(userName, normalizeChatSymbolKey(symbol));

const getHistory = async (
  userName: string,
  symbol: string,
): Promise<AIChatHistory> => {
  return (await getData(getHistoryKey(userName, symbol), [])) as AIChatHistory;
};

const appendMessagesToHistory = async (
  userName: string,
  symbol: string,
  messages: AIChatHistory,
): Promise<void> => {
  const history = await getHistory(userName, symbol);
  await setData(getHistoryKey(userName, symbol), [...history, ...messages], {
    expire: TTL_1M,
  });
};

const buildMessages = (
  filters: Filters,
  historyEntry: AIChatMessage,
  historyData: unknown,
  responseLanguage: string,
) => {
  const messages: AiChatMessage[] = [];

  messages.push({
    role: 'system',
    content: `You are a crypto trader assistant. Reply in ${getAiResponseLanguagePromptName(
      responseLanguage,
    )}.`,
  });

  messages.push({
    role: 'system',
    content: `Here is the market data for ${filters.symbol}: ${toJson(historyData)}`,
  });

  if (historyEntry.command === '/line') {
    messages.push({ role: 'user', content: historyEntry.text });
  }

  if (historyEntry.command === 'prompt') {
    messages.push({ role: 'user', content: historyEntry.text });
  }

  return messages;
};

export const GET = async (request: NextRequest) => {
  try {
    const userName = await getCurrentUserName();
    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const symbol = request.nextUrl.searchParams.get('symbol');

    if (!symbol) {
      return NextResponse.json(
        { error: 'Missing required parameter: symbol' },
        { status: 400 },
      );
    }

    try {
      normalizeChatSymbolKey(symbol);
    } catch {
      return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 });
    }

    const history = await getHistory(userName, symbol);
    return NextResponse.json({ history });
  } catch (error) {
    logger.log('error', `AI history error: %o`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};

export const POST = async (request: NextRequest) => {
  try {
    const userName = await getCurrentUserName();
    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { message, filters } = body as {
      message?: AIChatMessage;
      filters?: Filters;
    };

    if (!message || !filters) {
      return NextResponse.json(
        { error: 'Missing required fields: message, filters' },
        { status: 400 },
      );
    }

    try {
      normalizeChatSymbolKey(filters.symbol);
    } catch {
      return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 });
    }

    await appendMessagesToHistory(userName, filters.symbol, [message]);

    const connectorCreator = await resolveConnectorCreatorByProvider(
      'bybit',
      projectRoot,
    );
    if (!connectorCreator) {
      throw new Error('No connector available for provider');
    }

    const byBitConnector = await (connectorCreator as ConnectorCreator)({
      userName,
    });

    const data = await byBitConnector.kline({
      ...filters,
      interval: '60',
    });

    const settings = await getUserSettings(userName);
    const chatMessages = buildMessages(
      filters,
      message,
      data.slice(-100),
      normalizeAiResponseLanguage(settings.AI_RESPONSE_LANGUAGE),
    );

    const response = await invokeAiChat({
      messages: chatMessages,
      userName,
      temperature: 0.7,
    });

    const responseMessage: AIChatMessage = {
      from: 'ai',
      text: response.content as string,
    };

    await appendMessagesToHistory(userName, filters.symbol, [responseMessage]);

    return NextResponse.json({ message: responseMessage });
  } catch (error) {
    logger.log('error', `AI message error: %o`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
