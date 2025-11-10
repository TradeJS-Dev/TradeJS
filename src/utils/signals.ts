import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';
import { delay } from '@utils/async';
import { setData, getData, redisKeys, delKey } from '@utils/redis';
import { Signal, Analysis } from '@types';
import { ChatOpenAI } from '@langchain/openai';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';

const APP_URL = process.env.APP_URL;
const token = process.env.TG_BOT_TOKEN;
const chatId = process.env.TG_CHAT_ID;

const getScreenshotPath = ({ symbol, signalId, interval }: Signal) => {
  return path.join(
    process.cwd(),
    'data/screenshots',
    `${symbol}_${signalId}_${interval}.png`,
  ) as `${string}.png`;
};

const getScreenshotBase64 = async (signal: Signal) => {
  const screenshotPath = getScreenshotPath(signal);

  const fileBuffer = await fs.readFile(screenshotPath);
  const base64Image = fileBuffer.toString('base64');
  const dataUrl = `data:image/png;base64,${base64Image}`;

  return dataUrl;
};

const parseAIResponse = (input: string | object): object => {
  try {
    // если уже объект — просто вернуть
    if (typeof input === 'object' && input !== null) return input;

    // ищем первый JSON-блок в строке
    const match = (input as string).match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON block not found');

    // пробуем распарсить найденный блок
    return JSON.parse(match[0]);
  } catch (err) {
    console.error('❌ Ошибка парсинга AI-ответа:', err);
    console.log('🔍 Исходный текст:', input);
    return {};
  }
};

export const askAI = async (signal: Signal) => {
  const { symbol } = signal;
  const messages = new Array<BaseMessage>();

  const model = new ChatOpenAI({
    temperature: 0.9,
    modelName: 'anthropic/claude-sonnet-4.5',
    // modelName: 'x-ai/grok-4-fast',
    openAIApiKey: process.env.OPENAI_API_KEY,
    configuration: {
      baseURL: process.env.OPENAI_API_ENDPOINT || 'https://api.openai.com/v1',
    },
  });

  messages.push(
    new SystemMessage(
      `
        Ты — помощник крипто-трейдера. Отвечай на русском языке.
        Проанализируй график и оцени перспективность сделки.

        Ответ должен быть строго в JSON-формате следующей структуры:

        {
          "isBreakout": boolean,
          "isTrendLine": boolean,
          "isShouldTrade": boolean,
          "quality": number,
          "direction": "LONG" | "SHORT" | null,
          "entryPrice": number | null,
          "takeProfitPrice": number | null,
          "stopLossPrice": number | null,
          "riskRewardRatio": number | null,
          "comment": string
        }

        Пояснения к полям:
        - **isBreakout** — виден ли пробой наклонной линии?
        - **isTrendLine** — действительно ли желтая линия построена по экстремумам и является линией  тренда?
        - **isShouldTrade** — стоит ли входить в сделку?
        - **quality** — качество сетапа от 0 до 10 (0 — не стоит входить, 10 — идеальный вход)
        - **direction** — направление сделки ('LONG', 'SHORT' или null)
        - **entryPrice** — цена входа или null
        - **takeProfitPrice** — цена тейк-профита или null
        - **stopLossPrice** — цена стоп-лосса или null
        - **riskRewardRatio** — соотношение риск/прибыль или null
        - **comment** — текстовый анализ (до 1024 символов)

        Цены бери на правой оси Y главного графика. Текущая цена отображается белым шрифтом на зеленом или красном фоне.
        Горизонтальные красные пунктирные линии – это линии сопротивления.
        Горизонтальные зеленые пунктирные линии – это линии поддержки.
      `,
    ),
  );

  const image15m = getScreenshotBase64(signal);
  const image60m = getScreenshotBase64({ ...signal, interval: '60' });

  messages.push(
    new HumanMessage({
      content: [
        {
          type: 'text',
          text: `Проанализируй графики монеты ${symbol} (на 15m и 60m таймфреймах) и верни результат в указанном JSON-формате.`,
        },
        {
          type: 'image_url',
          image_url: image15m,
        },
        {
          type: 'image_url',
          image_url: image60m,
        },
      ],
    }),
  );

  const response = await model.invoke(messages);

  const content = parseAIResponse(response.content) as Analysis;

  await setData(redisKeys.analysis(symbol, signal.signalId), content);

  if (!content.isBreakout || !content.isShouldTrade) {
    await delKey(redisKeys.signal(symbol, signal.signalId));
  }

  console.log(symbol, formatMessage(signal, content));
};

export const screenDashboard = async (signal: Signal) => {
  const { symbol, signalId, interval } = signal;

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH!,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=medium',
    ],
  });

  const page = await browser.newPage();

  await page.setViewport({
    width: 1400,
    height: 960,
    deviceScaleFactor: 2,
  });

  await page.goto(
    `${APP_URL}/routes/dashboard/${symbol}/${interval}/?signalId=${signalId}&autoZoom=true`,
  );

  await delay(10_000);

  await page.screenshot({
    path: getScreenshotPath(signal),
  });

  await page.close();

  await browser.close();
};

const escapeHtml = (s?: string | null) => {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

const fmtNum = (n?: number | null, digits = 6) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const useDigits = Math.abs(n) >= 1000 ? 0 : digits;
  return n.toFixed(useDigits);
};

export const formatMessage = (
  { symbol }: Signal,
  analysis: Partial<Analysis> | null | undefined,
): string => {
  try {
    if (!analysis || Object.keys(analysis).length === 0) {
      return `<b>⚠️ Анализ недоступен для ${symbol}</b>\nПопробуйте обновить график или повторить запрос позже.`;
    }

    const {
      direction,
      isBreakout,
      isTrendLine,
      isShouldTrade,
      quality,
      riskRewardRatio,
      entryPrice,
      takeProfitPrice,
      stopLossPrice,
      comment,
    } = analysis;

    const emojiDir =
      direction === 'LONG'
        ? '🟢 LONG'
        : direction === 'SHORT'
          ? '🔴 SHORT'
          : '⚪️ NO TRADE';

    const lines: string[] = [];

    lines.push(`<b>${emojiDir} ${symbol}</b>`);

    const flags: string[] = [];
    if (typeof isBreakout === 'boolean') {
      flags.push(isBreakout ? '✅ Пробой' : '❌ Без пробоя');
    }
    if (typeof isTrendLine === 'boolean') {
      flags.push(isTrendLine ? '📈 Тренд подтверждён' : '⚠️ Не тренд');
    }
    if (flags.length) lines.push(flags.join(' · '));

    const qualityLine =
      typeof quality === 'number' ? `⭐ Качество: <b>${quality}/10</b>` : null;
    const rrVal =
      typeof riskRewardRatio === 'number'
        ? `R:R = <b>${fmtNum(riskRewardRatio, 2)}</b>`
        : null;

    if (isShouldTrade === true) {
      lines.push('💰 Возможна сделка');

      if (qualityLine || rrVal) {
        lines.push([qualityLine, rrVal].filter(Boolean).join(' · '));
      }

      const prices = [
        fmtNum(entryPrice) && `Вход: <b>${fmtNum(entryPrice)}</b>`,
        fmtNum(takeProfitPrice) && `TP: <b>${fmtNum(takeProfitPrice)}</b>`,
        fmtNum(stopLossPrice) && `SL: <b>${fmtNum(stopLossPrice)}</b>`,
      ]
        .filter(Boolean)
        .join(' · ');
      if (prices) {
        lines.push(prices);
      }
    }

    if (isShouldTrade === false) {
      lines.push('🚫 Не входить');
      if (qualityLine || rrVal) {
        lines.push([qualityLine, rrVal].filter(Boolean).join(' · '));
      }
    }

    if (typeof isShouldTrade !== 'boolean' && (qualityLine || rrVal)) {
      lines.push([qualityLine, rrVal].filter(Boolean).join(' · '));
    }

    const safeComment = escapeHtml(comment)?.trim();
    if (safeComment) lines.push(`📝 ${safeComment}`);

    return lines.filter(Boolean).join('\n').trim();
  } catch (err) {
    return `<b>⚠️ Ошибка форматирования сообщения</b>\nДетали: ${(err as Error).message || String(err)}`;
  }
};

export const sendSignal = async (signal: Signal) => {
  const { symbol, signalId, direction, interval } = signal;

  const analysis = (await getData(
    redisKeys.analysis(symbol, signalId),
  )) as Analysis;

  const caption = formatMessage(signal, analysis);

  const imageUrl = `${APP_URL}/api/files/screenshot/${symbol}/${signalId}/${interval}`;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: imageUrl,
      caption,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Dashboard',
              url: `${APP_URL}/routes/dashboard/${symbol}/${interval}/?signalId=${signalId}`,
            },
          ],
        ],
      },
      parse_mode: 'HTML',
    }),
  });

  await res.json();
};
