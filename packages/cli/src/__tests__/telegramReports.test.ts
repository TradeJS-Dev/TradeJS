type SendTextOptions = {
  userName?: string;
  markup?: Record<string, unknown>;
};

const mockSendTextToTG = jest.fn<Promise<null>, [string, SendTextOptions?]>(
  async () => null,
);
const mockSendDocumentToTG = jest.fn<Promise<null>, [unknown, unknown]>(
  async () => null,
);

jest.mock('@tradejs/node/cli', () => ({
  sendTextToTG: (message: string, options?: SendTextOptions) =>
    mockSendTextToTG(message, options),
  sendDocumentToTG: (document: unknown, options?: unknown) =>
    mockSendDocumentToTG(document, options),
}));

import {
  sendTelegramReport,
  splitTelegramReport,
} from '../lib/telegramReports';

describe('telegram report helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps short reports as a single message', () => {
    expect(splitTelegramReport('short report', 100)).toEqual(['short report']);
  });

  it('splits long reports on line boundaries', () => {
    const lines = [
      'a'.repeat(30),
      'b'.repeat(30),
      'c'.repeat(30),
      'd'.repeat(30),
    ];

    expect(splitTelegramReport(lines.join('\n'), 100)).toEqual([
      lines.slice(0, 3).join('\n'),
      lines[3],
    ]);
  });

  it('sends short reports without part headers', async () => {
    const sent = await sendTelegramReport(
      ['line-1', 'line-2', 'line-3'].join('\n'),
      {
        userName: 'root',
      },
    );

    expect(sent).toBe(1);
    expect(mockSendTextToTG).toHaveBeenCalledTimes(1);
    expect(mockSendTextToTG).toHaveBeenCalledWith('line-1\nline-2\nline-3', {
      userName: 'root',
    });
  });

  it('keeps markup only on the last split message', async () => {
    const longMessage = Array.from(
      { length: 800 },
      (_, index) => `line-${index}`,
    ).join('\n');
    const sent = await sendTelegramReport(longMessage, {
      userName: 'root',
      markup: { inline_keyboard: [] },
    });

    expect(sent).toBeGreaterThan(1);
    expect(mockSendTextToTG).toHaveBeenCalledTimes(sent);
    expect(mockSendTextToTG.mock.calls[0]?.[0]).toContain('📩 <b>Part 1/');
    expect(mockSendTextToTG.mock.calls[0]?.[1]).toEqual({
      userName: 'root',
      markup: undefined,
    });
    const lastCall =
      mockSendTextToTG.mock.calls[mockSendTextToTG.mock.calls.length - 1];
    expect(lastCall?.[1]).toEqual({
      userName: 'root',
      markup: { inline_keyboard: [] },
    });
  });

  it('sends attachments after the report text', async () => {
    await sendTelegramReport('report', {
      userName: 'root',
      attachments: [
        {
          filename: 'runtime-parity.json',
          content: '{"ok":true}',
        },
      ],
    });

    expect(mockSendTextToTG).toHaveBeenCalledTimes(1);
    expect(mockSendDocumentToTG).toHaveBeenCalledTimes(1);
    expect(mockSendDocumentToTG).toHaveBeenCalledWith(
      {
        filename: 'runtime-parity.json',
        content: '{"ok":true}',
      },
      {
        userName: 'root',
      },
    );
  });
});
