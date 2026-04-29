const mockGetHistory = jest.fn();
const mockSendMessage = jest.fn();

jest.mock('@actions/ai', () => ({
  getHistory: (...args: unknown[]) => mockGetHistory(...args),
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

import { useAiChatStore } from '../ai';

describe('ai chat store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAiChatStore.setState({ chats: {} });
  });

  it('loads history into a normalized per-symbol cache entry', async () => {
    mockGetHistory.mockResolvedValue([{ from: 'ai', text: 'hello' }]);

    await useAiChatStore.getState().loadHistory(' btc/usdt ');

    expect(mockGetHistory).toHaveBeenCalledWith(' btc/usdt ');
    expect(useAiChatStore.getState().getChat('BTC/USDT')).toEqual({
      loading: false,
      sending: false,
      loaded: true,
      error: null,
      messages: [{ from: 'ai', text: 'hello' }],
    });
  });

  it('appends user and ai prompt messages to the same chat entry', async () => {
    mockSendMessage.mockResolvedValue({ from: 'ai', text: 'answer' });

    await useAiChatStore
      .getState()
      .sendPrompt({ symbol: 'BTCUSDT' } as any, 'Что происходит?');

    expect(useAiChatStore.getState().getChat('btcusdt').messages).toEqual([
      {
        from: 'user',
        text: 'Что происходит?',
        command: 'prompt',
      },
      {
        from: 'ai',
        text: 'answer',
      },
    ]);
  });
});
