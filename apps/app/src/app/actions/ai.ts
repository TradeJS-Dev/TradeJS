import { API } from '@tradejs/core/api';
import { AIChatMessage, AIChatHistory, Filters } from '@tradejs/types';

interface SendMessageProps {
  message: AIChatMessage;
  filters: Filters;
}

const API_PATH = '/api/ai';

export const getHistory = async (symbol: string): Promise<AIChatHistory> => {
  if (!symbol) {
    return [];
  }

  const data = await API.get<{ history?: AIChatHistory }>(
    `${API_PATH}?symbol=${encodeURIComponent(symbol)}`,
  );

  return data.history ?? [];
};

export const sendMessage = async ({
  message,
  filters,
}: SendMessageProps): Promise<AIChatMessage> => {
  const data = await API.post<{ message: AIChatMessage }>(API_PATH, {
    message,
    filters,
  });

  return data.message;
};
