import { NextRequest, NextResponse } from 'next/server';
import { ChatOpenAI } from '@langchain/openai';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { connectors } from '@src/connectors';
import { AIChatHistory, AIChatMessage, Filters } from '@types';
import { getFile, setFile } from '@utils/files';
import { toJson } from '@utils/toJson';
import { logger } from '@utils/logger';

export const dynamic = 'force-dynamic';

const HISTORY_DIR = 'data/chats';

const getHistory = async (symbol: string): Promise<AIChatHistory> => {
  const history = await getFile(HISTORY_DIR, symbol);
  return history;
};

const appendMessagesToHistory = async (
  symbol: string,
  messages: AIChatHistory,
): Promise<void> => {
  const history = await getHistory(symbol);
  await setFile(HISTORY_DIR, symbol, [...history, ...messages]);
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

const invokeChatModel = async (messages: BaseMessage[]) => {
  const model = new ChatOpenAI({
    temperature: 0.7,
    modelName: 'gpt-4o',
    openAIApiKey: process.env.OPENAI_API_KEY,
    configuration: {
      baseURL: process.env.OPENAI_API_ENDPOINT || 'https://api.openai.com/v1',
    },
  });

  return model.invoke(messages);
};

export const GET = async (request: NextRequest) => {
  try {
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

    const byBitConnector = await connectors.ByBit({
      userName: 'root',
    });

    const data = await byBitConnector.kline({
      ...filters,
      interval: '60',
    });

    const chatMessages = buildMessages(filters, message, data.slice(-100));

    const response = await invokeChatModel(chatMessages);

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
