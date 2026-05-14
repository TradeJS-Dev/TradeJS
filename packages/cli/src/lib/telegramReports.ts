import { sendDocumentToTG, sendTextToTG } from '@tradejs/node/cli';

export const TELEGRAM_REPORT_CHUNK_LIMIT = 3_900;

export type TelegramReportAttachment = {
  filename: string;
  content: string | Uint8Array;
  caption?: string;
};

const buildPartHeader = (index: number, total: number) =>
  `📩 <b>Part ${index}/${total}</b>`;

const splitLongLine = (line: string, limit: number): string[] => {
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += limit) {
    chunks.push(line.slice(index, index + limit));
  }
  return chunks;
};

export const splitTelegramReport = (
  message: string,
  limit = TELEGRAM_REPORT_CHUNK_LIMIT,
): string[] => {
  const normalizedLimit = Math.max(100, Math.floor(limit));
  if (message.length <= normalizedLimit) {
    return [message];
  }

  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (!current) {
      return;
    }
    chunks.push(current);
    current = '';
  };

  for (const line of message.split('\n')) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length <= normalizedLimit) {
      current = next;
      continue;
    }

    flush();

    if (line.length <= normalizedLimit) {
      current = line;
      continue;
    }

    chunks.push(...splitLongLine(line, normalizedLimit));
  }

  flush();
  return chunks;
};

export const sendTelegramReport = async (
  message: string,
  options: {
    userName?: string;
    markup?: Record<string, unknown>;
    attachments?: TelegramReportAttachment[];
  } = {},
) => {
  const chunks = splitTelegramReport(message);
  const sendAttachments = async () => {
    for (const attachment of options.attachments || []) {
      await sendDocumentToTG(attachment, {
        userName: options.userName,
      });
    }
  };

  if (chunks.length === 1) {
    await sendTextToTG(chunks[0], options);
    await sendAttachments();
    return chunks.length;
  }

  for (const [index, chunk] of chunks.entries()) {
    const header = buildPartHeader(index + 1, chunks.length);
    await sendTextToTG(`${header}\n\n${chunk}`, {
      userName: options.userName,
      markup: index === chunks.length - 1 ? options.markup : undefined,
    });
  }
  await sendAttachments();

  return chunks.length;
};
