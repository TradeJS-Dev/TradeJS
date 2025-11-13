import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';
import { ChatOpenAI } from '@langchain/openai';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { PRELOAD_DAYS } from '@constants';
import { connectors } from '@src/connectors';
import { Signal, Analysis } from '@types';
import { setData, getData, redisKeys, delKey } from '@utils/redis';
import { toJson } from '@utils/toJson';
import { getTimestamp } from '@utils/timestamp';
import { delay } from '@utils/async';
import { getSupportResistanceLevels } from '@utils/supportResistance';

const { APP_URL, TG_BOT_TOKEN: token, TG_CHAT_ID: chatId } = process.env;

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
  const { symbol, direction } = signal;
  const messages = new Array<BaseMessage>();

  const model = new ChatOpenAI({
    temperature: 0.2,
    modelName: 'anthropic/claude-sonnet-4.5',
    // modelName: 'x-ai/grok-4-fast',
    openAIApiKey: process.env.OPENAI_API_KEY,
    configuration: {
      baseURL: process.env.OPENAI_API_ENDPOINT || 'https://api.openai.com/v1',
    },
  });

  const PRELOAD_START = getTimestamp(PRELOAD_DAYS);
  const PRELOAD_END = getTimestamp();

  const connector = connectors.ByBit({
    userName: 'root',
  });

  const data15 = await connector.kline({
    symbol,
    start: PRELOAD_START,
    end: PRELOAD_END,
    interval: '15',
    silent: true,
  });

  const data60 = await connector.kline({
    symbol,
    start: PRELOAD_START,
    end: PRELOAD_END,
    interval: '60',
    silent: true,
  });

  const { supportLevels, resistanceLevels } =
    getSupportResistanceLevels(data15);

  messages.push(
    new SystemMessage(
      `
Ты — помощник крипто-трейдера. Отвечай на русском языке. Твоя задача — проанализировать присланные ИЗОБРАЖЕНИЯ графиков (для геометрии: пробой наклонной линии, трендовость) и ЧИСЛОВЫЕ ДАННЫЕ свечей (для всех ценовых расчётов).
ВЕРНИ СТРОГО ОДИН JSON-ОБЪЕКТ БЕЗ ПРЕАМБУЛ И ТЕКСТА ВОКРУГ. Никаких комментариев вне JSON, никаких Markdown. Только валидный JSON без завершающей запятой. Числа — десятичные, максимум 8 знаков после запятой.

Формат ответа:
{
  "isBreakout": boolean,
  "isTrendLine": boolean,
  "isShouldTrade": boolean,
  "needRetest": boolean,
  "quality": number,               // целое от 0 до 10
  "direction": "LONG" | "SHORT" | null,
  "entryPrice": number | null,     // БРАТЬ ТОЛЬКО ИЗ МАССИВОВ ДАННЫХ СВЕЧЕЙ
  "takeProfitPrice": number | null,// БРАТЬ ТОЛЬКО ИЗ МАССИВОВ ДАННЫХ СВЕЧЕЙ
  "stopLossPrice": number | null,  // БРАТЬ ТОЛЬКО ИЗ МАССИВОВ ДАННЫХ СВЕЧЕЙ
  "riskRewardRatio": number | null,// (takeProfitPrice - entryPrice) / (entryPrice - stopLossPrice) для LONG;
                                   // (entryPrice - takeProfitPrice) / (stopLossPrice - entryPrice) для SHORT.
  "comment": string                // до 1024 символов, без переносов строк внутри JSON
}

Правила интерпретации:
- Пробой наклонной линии ("isBreakout") и факт корректной трендовой линии ("isTrendLine") определяй ПО ИЗОБРАЖЕНИЮ.
- Любые ЧИСЛЕННЫЕ уровни (entryPrice/takeProfitPrice/stopLossPrice) и вычисления (riskRewardRatio) определяй ТОЛЬКО ПО ПРИСЛАННЫМ МАССИВАМ СВЕЧЕЙ. НЕ считывай цены с картинки.
- Горизонтальные красные пунктирные линии на изображениях — сопротивления, зелёные — поддержки. Используй их как визуальные подсказки, но ЦЕНЫ всё равно бери из данных свечей.
- Если визуальные подсказки противоречат данным, для факта пробоя/тренда доверяй изображению, а для значений цен и уровней — исключительно данным свечей.
- "quality" оцени от 0 до 10; если данных недостаточно или сетап слабый — ставь низкое значение и "isShouldTrade": false.
- "direction" выбери по сути сетапа (может отличаться от ожидаемого направления во входе; допустимо null).
- При пробое нисходящей наклонной трендовой линии вверх анализируй сетап в направлении LONG.
- При пробое восходящей наклонной трендовой линии вниз анализируй сетап в направлении SHORT.
- Если корректные уровни/цены вычислить невозможно — верни null в соответствующих полях и "isShouldTrade": false с пояснением в "comment".
- Округляй цены до количества знаков, привычного для инструмента, НО не более 6 знаков после запятой.

Верни только JSON-объект, без лишних символов.
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
          text: `
Проанализируй графики и данные монеты ${symbol} (на 15m и 60m таймфреймах) как ${direction} сетап сделки
и верни результат в указанном JSON-формате.
Данные последних 40 свечей на 15m графике:
${toJson(data15.slice(-40))}

Данные последних 40 свечей на 60m графике:
${toJson(data60.slice(-40))}

Данные свечей это массив, где каждый элемент (свеча) имеет поля:
  - **open**: number;
  - **high**: number;
  - **low**: number;
  - **close**: number;
  - **volume**: number;
  - **timestamp**: number;
  - **turnover**: number;

Линии поддержки:
${toJson(supportLevels)}

Линии сопротивления:
${toJson(resistanceLevels)}
`,
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
      '--disable-gpu',
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
      needRetest,
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
    if (typeof needRetest === 'boolean') {
      flags.push(
        !needRetest
          ? '✅ Можно входить в сделку'
          : '❌ Нужно дождаться ретеста',
      );
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
  const { symbol, signalId, interval } = signal;

  const analysis = (await getData(
    redisKeys.analysis(symbol, signalId),
  )) as Analysis;

  const caption = formatMessage(signal, analysis);

  const imageUrl = `${APP_URL}/api/files/screenshot/${symbol}_${signalId}_${interval}`;

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

  const data = await res.json();

  console.log('tg response:', data);
};
