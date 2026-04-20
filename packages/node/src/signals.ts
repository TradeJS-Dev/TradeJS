import { Signal, Interval, SignalAnalysis } from '@tradejs/types';
import { delay } from '@tradejs/core/async';
import { formatNumber } from '@tradejs/core/math';
import { logger } from '@tradejs/infra/logger';
import { getUserSettings } from '@tradejs/infra/userSettings';
import { getScreenshotBuffer, getScreenshotFilename } from './screenshot';

const escapeHtml = (s?: string | null) => {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

const { APP_URL } = process.env;
const TG_REQUEST_ATTEMPTS = 3;
const TG_REQUEST_RETRY_DELAY_MS = 2_000;

const getErrorFields = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  const fields: Array<[string, unknown]> = [
    ['name', record.name],
    ['code', record.code],
    ['errno', record.errno],
    ['type', record.type],
    ['syscall', record.syscall],
    ['hostname', record.hostname],
    ['host', record.host],
    ['address', record.address],
    ['port', record.port],
  ];

  return fields
    .filter(([, fieldValue]) => fieldValue != null && String(fieldValue).trim())
    .map(([key, fieldValue]) => `${key}=${String(fieldValue)}`);
};

const describeErrorValue = (value: unknown): string => {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    const message = value.message?.trim() || '';
    const fields = getErrorFields(value);
    return [message, ...fields].filter(Boolean).join(' ');
  }

  if (typeof value === 'object') {
    const fields = getErrorFields(value);
    if (fields.length) {
      return fields.join(' ');
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
};

const normalizeQuality = (value?: number) =>
  typeof value === 'number'
    ? Math.max(1, Math.min(5, Math.round(value)))
    : null;

const formatOrderSkipReason = (reason?: string | null) => {
  if (!reason) return '';

  if (reason.startsWith('AI_QUALITY_BELOW_MIN')) {
    return 'AI_QUALITY_BELOW_MIN';
  }

  if (reason.startsWith('ML_THRESHOLD_NOT_MET')) {
    return 'ML_THRESHOLD_NOT_MET';
  }

  if (reason === 'ML_RESULT_UNAVAILABLE') {
    return 'ML_RESULT_UNAVAILABLE';
  }

  return reason;
};

const getLastNumber = (value: unknown): number | undefined => {
  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    return typeof last === 'number' ? last : undefined;
  }

  return typeof value === 'number' ? value : undefined;
};

const getAiQualityLine = (analysis?: Partial<SignalAnalysis> | null) => {
  const quality = normalizeQuality(analysis?.quality);
  if (!quality) return null;

  const approvedCurrentDirection =
    analysis?.direction != null && analysis.direction !== null;

  if (quality >= 4 && approvedCurrentDirection) {
    return `🟢 AI Quality: ${quality}/5`;
  }

  if (quality === 3 && approvedCurrentDirection) {
    return `🟡 AI Quality: ${quality}/5`;
  }

  return `🔴 AI Quality: ${quality}/5`;
};

const getTelegramErrorReason = (data: unknown): string => {
  if (data && typeof data === 'object') {
    const record = data as {
      description?: unknown;
      error_code?: unknown;
    };
    const description =
      typeof record.description === 'string' ? record.description : '';
    const errorCode =
      typeof record.error_code === 'number' ? record.error_code : undefined;

    if (description && errorCode != null) {
      return `${errorCode}: ${description}`;
    }

    if (description) {
      return description;
    }
  }

  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
};

const getErrorMessage = (error: unknown): string => {
  const maybeError = error as Error & { cause?: unknown };
  const message = describeErrorValue(error) || String(error);

  if (maybeError?.cause == null) {
    return message;
  }

  const cause = describeErrorValue(maybeError.cause);

  if (!cause) {
    return message;
  }

  return `${message}; cause: ${cause}`;
};

const parseTelegramResponse = async (response: Response) => {
  const fallback = {
    ok: response.ok,
    error_code: response.status,
    description: response.statusText,
  };

  try {
    return await response.json();
  } catch {
    try {
      const text = await response.text();
      return text
        ? {
            ...fallback,
            description: text,
          }
        : fallback;
    } catch {
      return fallback;
    }
  }
};

const getTelegramSettings = async (userName = 'root') => {
  const settings = await getUserSettings(userName);
  const token = settings.TG_BOT_TOKEN;
  const chatId = settings.TG_CHAT_ID;

  if (!token || !chatId) {
    throw new Error(`Telegram settings are incomplete for user ${userName}`);
  }

  return { token, chatId };
};

const requestTelegram = async ({
  method,
  token,
  init,
}: {
  method: 'sendMessage' | 'sendPhoto';
  token: string;
  init: RequestInit;
}) => {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= TG_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/${method}`,
        {
          ...init,
        },
      );

      return await parseTelegramResponse(res);
    } catch (error) {
      lastError = error as Error;
      logger.error(
        'tg %s network failed: attempt=%d (%s)',
        method,
        attempt,
        getErrorMessage(error),
      );

      if (attempt < TG_REQUEST_ATTEMPTS) {
        await delay(TG_REQUEST_RETRY_DELAY_MS);
      }
    }
  }

  throw lastError || new Error(`Telegram ${method} request failed`);
};

const sendTelegramMessage = async ({
  message,
  markup,
  token,
  chatId,
}: {
  message: string;
  markup?: Record<string, unknown>;
  token: string;
  chatId: string;
}) => {
  const data = await requestTelegram({
    method: 'sendMessage',
    token,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        reply_markup: markup,
        parse_mode: 'HTML',
      }),
    },
  });
  logger.info(
    'tg sendMessage: %s',
    data?.ok ? 'sent' : getTelegramErrorReason(data),
  );

  return data;
};

export const sendTextToTG = async (
  message: string,
  options: {
    userName?: string;
    markup?: Record<string, unknown>;
  } = {},
) => {
  const { token, chatId } = await getTelegramSettings(options.userName);
  return sendTelegramMessage({
    message,
    markup: options.markup,
    token,
    chatId,
  });
};

export const formatMessage = (
  signal: Signal,
  analysis?: Partial<SignalAnalysis> | null,
): string => {
  const {
    symbol,
    direction,
    strategy,
    orderStatus,
    orderSkipReason,
    isConfigFromBacktest,
    ml,
    prices: { currentPrice, takeProfitPrice, stopLossPrice, riskRatio },
    indicators,
    additionalIndicators,
  } = signal;

  try {
    const lines: string[] = [];
    const distance = additionalIndicators?.distance as number | undefined;
    const touches = additionalIndicators?.touches as number | undefined;
    const correlation = getLastNumber(indicators.correlation);
    const atrPct = getLastNumber(indicators.atrPct);
    const spread = getLastNumber(indicators.spread);

    const formatPrices = () => {
      const tpPercent =
        Math.abs(
          ((takeProfitPrice - currentPrice) / currentPrice) * 100,
        ).toFixed(2) + '%';

      const slPercent =
        Math.abs(((stopLossPrice - currentPrice) / currentPrice) * 100).toFixed(
          2,
        ) + '%';

      const prices = [
        `Price: <b>${formatNumber(currentPrice)}</b>`,
        `TP: <b>${formatNumber(takeProfitPrice)}</b> (${tpPercent})`,
        `SL: <b>${formatNumber(stopLossPrice)}</b> (${slPercent})`,
        `R:R = <b>${riskRatio.toFixed(2)}</b>`,
      ]
        .filter(Boolean)
        .join('\n');

      return prices;
    };

    const checkAnalys = () => {
      const emojiDir =
        direction === 'LONG'
          ? '🟩 LONG'
          : direction === 'SHORT'
            ? '🟥 SHORT'
            : '⬜️ NO TRADE';

      lines.push(`<b>${emojiDir} ${symbol}</b>`);
      lines.push(`Strategy: ${strategy}`);

      lines.push('');

      if (orderStatus) {
        let orderStatusText = '⚪️ Order skipped';
        if (orderStatus === 'completed') {
          orderStatusText = '🟢 Order completed';
        } else if (orderStatus === 'failed') {
          orderStatusText = '🔴 Order failed';
        } else if (orderStatus === 'canceled') {
          // Legacy value for historical signals.
          orderStatusText = '⚪️ Order skipped';
        }
        lines.push(orderStatusText);
        if (
          (orderStatus === 'skipped' || orderStatus === 'canceled') &&
          orderSkipReason
        ) {
          lines.push(
            `Skip reason: <b>${escapeHtml(formatOrderSkipReason(orderSkipReason))}</b>`,
          );
        }
      }

      if (isConfigFromBacktest) {
        lines.push('🟢 Using config from backtest');
      } else {
        lines.push('🟡 Using base config');
      }

      if (ml) {
        lines.push(
          `${ml.passed ? '🟢 ML: PASS' : '🔴 ML: FAIL'} (${ml.probability.toFixed(3)} / ${ml.threshold.toFixed(2)})`,
        );
      }

      const aiQualityLine = getAiQualityLine(analysis);
      if (aiQualityLine) {
        lines.push(aiQualityLine);
      }

      lines.push('');

      if (correlation) {
        lines.push(`BTC correlation: ${correlation}`);
      }

      const prices = formatPrices();

      if (prices) {
        lines.push('');
        lines.push(prices);
      }
    };

    checkAnalys();

    return lines.join('\n').trim();
  } catch (err) {
    return `<b>⚠️ Ошибка форматирования сообщения для ${symbol}</b>\nДетали: ${(err as Error).message || String(err)}`;
  }
};

export const sendSignal = async (
  signal: Signal,
  imgInterval: Interval,
  analysis?: Partial<SignalAnalysis> | null,
  options: {
    userName?: string;
  } = {},
) => {
  const { symbol, signalId, interval } = signal;
  const { token, chatId } = await getTelegramSettings(options.userName);

  const message = formatMessage(signal, analysis);

  const publicAppUrl = APP_URL?.startsWith('https') ? APP_URL : null;
  const dashboardUrl = publicAppUrl
    ? `${APP_URL}/routes/dashboard/bybit/${symbol}/${interval}/?signalId=${signalId}`
    : null;
  const actionButtons = [
    dashboardUrl ? { text: 'Dashboard', url: dashboardUrl } : null,
  ].filter(Boolean) as Array<{ text: string; url: string }>;
  const markup = actionButtons.length
    ? {
        inline_keyboard: [actionButtons],
      }
    : undefined;

  let screenshotBytes: ArrayBuffer | null = null;

  try {
    const screenshot = await getScreenshotBuffer({
      ...signal,
      interval: imgInterval,
    });
    screenshotBytes = screenshot.buffer.slice(
      screenshot.byteOffset,
      screenshot.byteOffset + screenshot.byteLength,
    ) as ArrayBuffer;
  } catch (error) {
    logger.error(
      'tg screenshot unavailable: %s (%s)',
      symbol,
      (error as Error)?.message || String(error),
    );
    await sendTelegramMessage({ message, markup, token, chatId });
    return;
  }

  const photoBody = new FormData();

  photoBody.set('chat_id', String(chatId || ''));
  photoBody.set(
    'photo',
    new Blob([screenshotBytes], { type: 'image/png' }),
    getScreenshotFilename({ ...signal, interval: imgInterval }),
  );
  photoBody.set('caption', message);
  photoBody.set('parse_mode', 'HTML');

  if (markup) {
    photoBody.set('reply_markup', JSON.stringify(markup));
  }

  let data: any;

  try {
    data = await requestTelegram({
      method: 'sendPhoto',
      token,
      init: {
        method: 'POST',
        body: photoBody,
      },
    });
  } catch (error) {
    const reason = getErrorMessage(error);
    logger.error('tg sendPhoto request failed: %s', reason);
    await sendTelegramMessage({
      message: `${message}\n\n⚠️ <b>Photo delivery failed</b>\nReason: <code>${escapeHtml(reason)}</code>`,
      markup,
      token,
      chatId,
    });
    return;
  }

  if (!data?.ok) {
    const reason = getTelegramErrorReason(data);
    logger.error('tg sendPhoto failed: %s', JSON.stringify(data));
    await sendTelegramMessage({
      message: `${message}\n\n⚠️ <b>Photo delivery failed</b>\nReason: <code>${escapeHtml(reason)}</code>`,
      markup,
      token,
      chatId,
    });
    return;
  }

  logger.info('tg sendPhoto: sent');
};

export const formatAnalysisMessage = (
  signal: Signal,
  analysis: Partial<SignalAnalysis>,
): string => {
  const lines: string[] = [];
  const blocks: string[] = [];
  const quality = normalizeQuality(analysis.quality);

  lines.push(`<b>AI analysis ${signal.symbol}</b>`);
  lines.push(`Signal direction: <b>${signal.direction}</b>`);
  lines.push(`AI direction: <b>${analysis.direction ?? 'NO TRADE'}</b>`);

  if (quality) {
    lines.push(`Quality: <b>${quality}/5</b>`);
  }

  if (typeof analysis.needRetest === 'boolean') {
    lines.push(`Need retest: <b>${analysis.needRetest ? 'YES' : 'NO'}</b>`);
  }

  if (typeof analysis.retestPrice === 'number') {
    lines.push(`Retest price: <b>${formatNumber(analysis.retestPrice)}</b>`);
  }

  if (typeof analysis.takeProfitPrice === 'number') {
    lines.push(`AI TP: <b>${formatNumber(analysis.takeProfitPrice)}</b>`);
  }

  if (typeof analysis.stopLossPrice === 'number') {
    lines.push(`AI SL: <b>${formatNumber(analysis.stopLossPrice)}</b>`);
  }

  const pushBlock = (title: string, value?: string) => {
    if (!value) return;
    const clean = value.trim();
    if (!clean) return;
    blocks.push(`<b>${title}:</b>\n${escapeHtml(clean)}`);
  };

  pushBlock('Setup', analysis.setup);
  pushBlock('Confirmations', analysis.confirmations);
  pushBlock('BTC', analysis.btcContext);
  pushBlock('Retest', analysis.retestPlan);
  pushBlock('Risk/Levels', analysis.riskLevels);
  pushBlock('Why Quality', analysis.qualityReason);
  pushBlock('Trigger/Invalidation', analysis.triggerInvalidation);

  if (blocks.length > 0) {
    lines.push('');
    lines.push(blocks.join('\n\n'));
  }

  return lines.join('\n');
};

export const sendSignalAnalysis = async (
  signal: Signal,
  analysis: Partial<SignalAnalysis>,
  options: {
    userName?: string;
  } = {},
) => {
  const { token, chatId } = await getTelegramSettings(options.userName);
  const message = formatAnalysisMessage(signal, analysis);

  const data = await requestTelegram({
    method: 'sendMessage',
    token,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    },
  });
  logger.info(
    'tg sendMessage (analysis): %s',
    data?.ok ? 'sent' : getTelegramErrorReason(data),
  );
};
