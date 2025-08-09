'use server';

import { ChatOpenAI } from '@langchain/openai';
import {
  HumanMessage,
  SystemMessage,
  BaseMessage,
} from '@langchain/core/messages';
import { connectors } from '@src/connectors';
import { AIChatMessage, AIChatHistory, Filters } from '@types';
import { toJson } from '@utils/toJson';
import { getData, setData } from '@utils/data';

interface sendMessageProps {
  message: AIChatMessage;
  filters: Filters;
}

export const getHistory = async (symbol: string): Promise<AIChatHistory> => {
  const history = await getData('data/chats', symbol);
  return history;
};

export const saveMessagesToHistory = async (
  symbol: string,
  messages: AIChatHistory,
): Promise<void> => {
  const history = await getHistory(symbol);

  await setData('data/chats', symbol, [...history, ...messages]);
};

export const sendMessage = async ({
  message,
  filters,
}: sendMessageProps): Promise<AIChatMessage> => {
  await saveMessagesToHistory(filters.symbol, [message]);

  const byBitConnector = connectors.ByBit({
    key: '',
    secret: '',
  });

  const data = await byBitConnector.kline({
    ...filters,
    interval: '60',
  });

  const model = new ChatOpenAI({
    temperature: 0.7,
    modelName: 'gpt-4o',
    openAIApiKey: process.env.OPENAI_API_KEY,
    configuration: {
      baseURL: process.env.OPENAI_API_ENDPOINT || 'https://api.openai.com/v1',
    },
  });

  const messages = new Array<BaseMessage>();

  messages.push(
    new SystemMessage(
      'Ты – помощник крипто трейдера. Отвечай на русском языке',
    ),
  );

  messages.push(
    new SystemMessage(
      `Вот данные по монете ${filters.symbol}: ${toJson(data.slice(-100))}`,
    ),
  );

  if (message.command === '/line') {
    messages.push(new HumanMessage(message.text));
  }

  if (message.command === 'prompt') {
    messages.push(new HumanMessage(message.text));
  }

  const response = await model.invoke(messages);

  const responseMessage = {
    from: 'ai',
    text: response.content,
  } as AIChatMessage;

  await saveMessagesToHistory(filters.symbol, [responseMessage]);

  return responseMessage;
};
