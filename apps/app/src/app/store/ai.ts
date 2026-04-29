import { create } from 'zustand';
import { getHistory, sendMessage } from '@actions/ai';
import { AIChatHistory, AIChatMessage, Filters } from '@tradejs/types';

type AiChatEntry = {
  loading: boolean;
  sending: boolean;
  loaded: boolean;
  error: string | null;
  messages: AIChatHistory;
};

interface AiChatState {
  chats: Record<string, AiChatEntry>;
  getChat: (symbol: string) => AiChatEntry;
  loadHistory: (symbol: string) => Promise<void>;
  sendPrompt: (filters: Filters, input: string) => Promise<void>;
  sendQuickCommand: (filters: Filters, command: string) => Promise<void>;
}

const EMPTY_CHAT: AiChatEntry = {
  loading: false,
  sending: false,
  loaded: false,
  error: null,
  messages: [],
};

const normalizeSymbolKey = (symbol: string) => symbol.trim().toUpperCase();

const getQuickMessage = (command: string): AIChatMessage | null => {
  if (command === '/line') {
    return {
      from: 'user',
      text: 'Какие наклонные линии можно построить на данном графике',
      command,
    };
  }

  return null;
};

const updateChat = (
  chats: Record<string, AiChatEntry>,
  symbol: string,
  patch: Partial<AiChatEntry>,
) => ({
  ...chats,
  [symbol]: {
    ...(chats[symbol] ?? EMPTY_CHAT),
    ...patch,
  },
});

export const useAiChatStore = create<AiChatState>((set, get) => ({
  chats: {},

  getChat: (symbol) => get().chats[normalizeSymbolKey(symbol)] ?? EMPTY_CHAT,

  loadHistory: async (symbol) => {
    const symbolKey = normalizeSymbolKey(symbol);
    if (!symbolKey) {
      return;
    }

    const existing = get().chats[symbolKey];
    if (existing?.loading) {
      return;
    }

    set((state) => ({
      chats: updateChat(state.chats, symbolKey, {
        loading: true,
        error: null,
      }),
    }));

    try {
      const history = await getHistory(symbol);
      set((state) => ({
        chats: updateChat(state.chats, symbolKey, {
          loading: false,
          loaded: true,
          messages: history,
        }),
      }));
    } catch (error) {
      set((state) => ({
        chats: updateChat(state.chats, symbolKey, {
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load chat',
        }),
      }));
    }
  },

  sendPrompt: async (filters, input) => {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }

    const message: AIChatMessage = {
      from: 'user',
      text: trimmed,
      command: 'prompt',
    };

    const symbolKey = normalizeSymbolKey(filters.symbol);

    set((state) => ({
      chats: updateChat(state.chats, symbolKey, {
        sending: true,
        error: null,
        loaded: true,
        messages: [...(state.chats[symbolKey]?.messages ?? []), message],
      }),
    }));

    try {
      const response = await sendMessage({ message, filters });
      set((state) => ({
        chats: updateChat(state.chats, symbolKey, {
          sending: false,
          messages: [...(state.chats[symbolKey]?.messages ?? []), response],
        }),
      }));
    } catch (error) {
      set((state) => ({
        chats: updateChat(state.chats, symbolKey, {
          sending: false,
          error:
            error instanceof Error ? error.message : 'Failed to send message',
        }),
      }));
    }
  },

  sendQuickCommand: async (filters, command) => {
    const message = getQuickMessage(command);
    if (!message) {
      return;
    }

    const symbolKey = normalizeSymbolKey(filters.symbol);

    set((state) => ({
      chats: updateChat(state.chats, symbolKey, {
        sending: true,
        error: null,
        loaded: true,
        messages: [...(state.chats[symbolKey]?.messages ?? []), message],
      }),
    }));

    try {
      const response = await sendMessage({ message, filters });
      set((state) => ({
        chats: updateChat(state.chats, symbolKey, {
          sending: false,
          messages: [...(state.chats[symbolKey]?.messages ?? []), response],
        }),
      }));
    } catch (error) {
      set((state) => ({
        chats: updateChat(state.chats, symbolKey, {
          sending: false,
          error:
            error instanceof Error ? error.message : 'Failed to send message',
        }),
      }));
    }
  },
}));
