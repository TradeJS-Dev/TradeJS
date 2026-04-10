import { NextRequest, NextResponse } from 'next/server';
import { ChatOpenAI } from '@langchain/openai';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { toJson } from '@tradejs/core/data';
import { getOpenRouterModelKwargs } from '@tradejs/node/ai';
import { getConnectorCreatorByProvider } from '@tradejs/node/connectors';
import {
  AIChatHistory,
  AIChatMessage,
  ConnectorCreator,
  Filters,
} from '@tradejs/types';
import { getFile, setFile } from '@tradejs/infra/files';
import { logger } from '@tradejs/infra/logger';
import { getUserSettings } from '@tradejs/infra/userSettings';
import { getCurrentUserName } from '@app/lib/currentUser';

export const dynamic = 'force-dynamic';

const HISTORY_DIR = 'data/chats';
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

const getHistory = async (symbol: string): Promise<AIChatHistory> => {
  const history = await getFile(HISTORY_DIR, symbol, [], projectRoot);
  return history;
};

const appendMessagesToHistory = async (
  symbol: string,
  messages: AIChatHistory,
): Promise<void> => {
  const history = await getHistory(symbol);
  await setFile(HISTORY_DIR, symbol, [...history, ...messages], {
    projectRoot,
  });
};

const buildMessages = (
  filters: Filters,
  historyEntry: AIChatMessage,
  historyData: unknown,
) => {
  const messages = new Array<BaseMessage>();

  messages.push(
    new SystemMessage(
      'Ты – помощник крипто-трейдера. Отвечай на русском языке',
    ),
  );

  messages.push(
    new SystemMessage(
      `Вот данные по монете ${filters.symbol}: ${toJson(historyData)}`,
    ),
  );

  if (historyEntry.command === '/line') {
    messages.push(new HumanMessage(historyEntry.text));
  }

  if (historyEntry.command === 'prompt') {
    messages.push(new HumanMessage(historyEntry.text));
  }

  return messages;
};

const invokeChatModel = async (messages: BaseMessage[], userName: string) => {
  const settings = await getUserSettings(userName);
  if (!settings.OPENAI_API_KEY || !settings.OPENAI_API_ENDPOINT) {
    throw new Error(`AI settings are incomplete for user ${userName}`);
  }

  const modelKwargs = getOpenRouterModelKwargs(settings.OPENAI_API_ENDPOINT);

  const model = new ChatOpenAI({
    temperature: 0.7,
    modelName: 'gpt-4o',
    apiKey: settings.OPENAI_API_KEY,
    ...(Object.keys(modelKwargs).length ? { modelKwargs } : {}),
    configuration: {
      baseURL: settings.OPENAI_API_ENDPOINT,
    },
  });

  return model.invoke(messages);
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

    const history = await getHistory(symbol);
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

    await appendMessagesToHistory(filters.symbol, [message]);

    const connectorCreator = await getConnectorCreatorByProvider(
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

    const chatMessages = buildMessages(filters, message, data.slice(-100));

    const response = await invokeChatModel(chatMessages, userName);

    const responseMessage: AIChatMessage = {
      from: 'ai',
      text: response.content as string,
    };

    await appendMessagesToHistory(filters.symbol, [responseMessage]);

    return NextResponse.json({ message: responseMessage });
  } catch (error) {
    logger.log('error', `AI message error: %o`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
