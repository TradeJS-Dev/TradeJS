import { AIChatMessage, AIChatHistory, Filters } from '@types';

interface SendMessageProps {
  message: AIChatMessage;
  filters: Filters;
}

const API_PATH = '/api/ai';

const handleResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Request to AI API failed');
  }

  return response.json();
};

export const getHistory = async (symbol: string): Promise<AIChatHistory> => {
  if (!symbol) {
    return [];
  }

  const response = await fetch(
    `${API_PATH}?symbol=${encodeURIComponent(symbol)}`,
    {
      method: 'GET',
      cache: 'no-store',
    },
  );

  const data = await handleResponse<{ history?: AIChatHistory }>(response);

  return data.history ?? [];
};

export const sendMessage = async ({
  message,
  filters,
}: SendMessageProps): Promise<AIChatMessage> => {
  const response = await fetch(API_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, filters }),
  });

  const data = await handleResponse<{ message: AIChatMessage }>(response);

  return data.message;
};
