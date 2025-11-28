import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';
import { ChatOpenAI } from '@langchain/openai';
import {
  MIN_TRENDLINE_MOVE_PERCENT,
  TP_MAX_PERCENT,
  TP_MIN_PERCENT,
  SL_PERCENT,
} from '@constants';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { Signal, Analysis, TrendLine } from '@types';
import { setData, getData, redisKeys, delKey } from '@utils/redis';
import { delay } from '@utils/async';
import { formatNumber } from '@utils/math';

const { APP_URL, TG_BOT_TOKEN: token, TG_CHAT_ID: chatId } = process.env;

const getImageUrl = ({ symbol, signalId, interval }: Signal) =>
  `${APP_URL}/api/files/screenshot/${symbol}_${signalId}_${interval}`;

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
    // modelName: 'anthropic/claude-opus-4.5',
    modelName: 'anthropic/claude-sonnet-4.5',
    // modelName: 'x-ai/grok-4-fast',
    openAIApiKey: process.env.OPENAI_API_KEY,
    configuration: {
      baseURL: process.env.OPENAI_API_ENDPOINT || 'https://api.openai.com/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://aleksnick01inv.fvds.ru',
        'X-Title': 'Inv',
      },
    },
  });

  messages.push(
    new SystemMessage(
      `
Ты — помощник крипто-трейдера.
Анализируй ТОЛЬКО присланные изображения (геометрия, пробой, тренд, корреляция с BTC).

Отвечай строго ОДНИМ JSON-объектом без текста вокруг:

{
  "isTrendLine": boolean,
  "isTrendLineFromExtremum": boolean,
  "isWellTradedLevel": boolean,
  "needRetest": boolean,

  "direction": "LONG" | "SHORT" | null,
  "currentTrend": "UP" | "DOWN" | null,
  "btcTrend": "UP" | "DOWN" | null,
  "isBitcoinCorrelation": boolean,

  "comment": string
}

=== ОПРЕДЕЛЕНИЯ ПОЛЕЙ ===

- "isTrendLine" — является ли оранжевая линия на графике корректной трендовой линией:
  true ТОЛЬКО если линия:
  • для нисходящей — проходит по локальным максимумам,
    для восходящей — по локальным минимумам;
  • соединяет как минимум три заметных экстремума;
  • между точками цена в основном остаётся
    ниже линии (для сопротивления) или выше линии (для поддержки).

  Если линия:
  – проходит через середину свечей,
  – не опирается на вершины/впадины,
  – пересекает много тел свечей,
  – игнорирует более очевидные экстремумы рядом,
  считай её построенной по случайным точкам и ставь "isTrendLine": false.

- "isTrendLineFromExtremum" — начинается ли линия от значимого экстремума:
  true ТОЛЬКО если старт линии визуально совпадает
  с самой яркой вершиной или впадиной участка;
  если линия начинается «из середины движения» — false.

- "isWellTradedLevel" — является ли уровень наторгованным:
  цена в этой зоне неоднократно задерживалась,
  было множество касаний или боковое движение;
  1–2 быстрых касания без удержания цены ≠ наторговка.

- "needRetest" — нужен ли ретест после пробоя:
  цена откатывается к пробитой линии,
  касается её тенью и затем возобновляет движение в сторону пробоя.

- "direction" — направление сделки по сетапу:
  "LONG" при пробое вверх,
  "SHORT" при пробое вниз,
  иначе null.

- "currentTrend" — общее направление движения монеты:
  "UP", если структура движения в целом восходящая,
  "DOWN", если структура в целом нисходящая,
  иначе null.

- "btcTrend" — то же самое, но для BTC-графика снизу.

- "isBitcoinCorrelation" — true, если импульсы и откаты монеты
  на 60m в основном совпадают с BTC по направлению и времени;
  отдельные совпадения ≠ корреляция.

- "comment" — краткое пояснение решения (до 1024 символов, без переносов строк).

=== БАЗОВЫЕ ТЕРМИНЫ ===

Значимый экстремум:
— локальный максимум или минимум,
— заметно выделяется среди соседних колебаний,
— от него был выраженный импульс.

Касание трендовой:
— тень свечи касается или слегка пробивает линию,
— после касания есть реакция (отскок или замедление),
— простое прохождение рядом без реакции ≠ касание.

Пробой:
— свеча закрылась телом за линией.

Ретест:
— возврат цены к пробитой линии с последующим продолжением движения.

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
Проанализируй графики и данные монеты ${symbol} (на 15m и 60m таймфреймах) как ${direction} сетап краткосрочной сделки
и верни результат в указанном JSON-формате.
`,
        },
        {
          type: 'image_url',
          image_url: APP_URL?.startsWith('https')
            ? getImageUrl(signal)
            : image15m,
        },
        {
          type: 'image_url',
          image_url: APP_URL?.startsWith('https')
            ? getImageUrl({ ...signal, interval: '60' })
            : image60m,
        },
      ],
    }),
  );

  const response = await model.invoke(messages);

  const content = parseAIResponse(response.content) as Analysis;

  if (
    !content.isTrendLine ||
    !['LONG', 'SHORT'].includes(content.direction ?? '')
  ) {
    await delKey(redisKeys.signal(symbol, signal.signalId));
  }

  await setData(redisKeys.analysis(symbol, signal.signalId), content);
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

  try {
    const page = await browser.newPage();

    try {
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
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
};

export const formatMessage = (
  signal: Signal,
  analysis: Partial<Analysis> | null | undefined,
): string => {
  const { symbol, currentPrice, takeProfitPrice, stopLossPrice, riskRatio } =
    signal;

  try {
    if (!analysis || Object.keys(analysis).length === 0) {
      return `<b>⚠️ Анализ недоступен для ${symbol}</b>\nПопробуйте обновить график или повторить запрос позже.`;
    }

    const {
      direction,
      currentTrend,
      isTrendLine,
      isWellTradedLevel,
      isTrendLineFromExtremum,
      isBitcoinCorrelation,
      needRetest,
    } = analysis;

    const lines: string[] = [];
    let score = 0;

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
      if (!['LONG', 'SHORT'].includes(direction ?? '')) {
        lines.push(`<b>⚠️ Сетап для ${symbol} не получился</b>`);
        return;
      }

      if (direction !== signal.direction) {
        lines.push(
          `<b>⚠️ Сетап для ${symbol} не соответствует трендовой линии</b>`,
        );
        return;
      }

      if (!['UP', 'DOWN'].includes(currentTrend ?? '')) {
        lines.push(
          `<b>⚠️ Не получилось определить текущий тренд для ${symbol}</b>`,
        );
        return;
      }

      const emojiDir =
        direction === 'LONG'
          ? '🟩 LONG'
          : direction === 'SHORT'
            ? '🟥 SHORT'
            : '⬜️ NO TRADE';

      lines.push(`<b>${emojiDir} ${symbol}</b>`);
      lines.push('');

      if (typeof isTrendLine === 'boolean' && isTrendLine) {
        lines.push('✅ Линия построена корректно');
        score++;
      } else {
        lines.push('❌ Линия не трендовая');

        return;
      }

      if (typeof needRetest === 'boolean' && !needRetest) {
        lines.push('✅ Ретест пройден');
        score++;
      } else {
        lines.push('❌ Нужно дождаться ретеста');
      }

      if (
        typeof isTrendLineFromExtremum === 'boolean' &&
        isTrendLineFromExtremum
      ) {
        lines.push('✅ Основа – экстремум');
        score++;
      } else {
        lines.push('❌ Основа не явный экстремум');
      }

      if (typeof isWellTradedLevel === 'boolean' && isWellTradedLevel) {
        lines.push('✅ Наторгованный уровень');
        score++;
      } else {
        lines.push('❌ Уровень не наторгован');
      }

      if (typeof isBitcoinCorrelation === 'boolean' && !isBitcoinCorrelation) {
        lines.push('✅ Не следует за BTC');
        score++;
      } else {
        lines.push('❌ Повторяет BTC');
      }

      if (
        (direction === 'LONG' && currentTrend === 'UP') ||
        (direction === 'SHORT' && currentTrend === 'DOWN')
      ) {
        lines.push('✅ Направление сетапа соответствует тренду');
        score++;
      } else {
        lines.push('❌ Ceтап против тренда');
      }

      lines.push('');

      const emojiScore = score >= 5 ? '🟢' : score >= 4 ? '🟡' : '🔴';

      lines.push(`${emojiScore} Качество сетапа <b>${score}</b> / 6`);

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

const escapeHtml = (s?: string | null) => {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

export const sendSignal = async (signal: Signal) => {
  const { symbol, signalId, interval } = signal;

  const analysis = (await getData(
    redisKeys.analysis(symbol, signalId),
  )) as Analysis;

  const message = formatMessage(signal, analysis);
  const safeComment = escapeHtml(analysis?.comment)?.trim();

  const markup = {
    inline_keyboard: [
      [
        {
          text: 'Dashboard',
          url: `${APP_URL}/routes/dashboard/${symbol}/${interval}/?signalId=${signalId}`,
        },
      ],
    ],
  };

  if (!APP_URL?.startsWith('https')) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `${message}\n\n📝 ${safeComment}`,
        parse_mode: 'HTML',
      }),
    });

    return;
  }

  const imageUrl = getImageUrl(signal);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: imageUrl,
      caption: message,
      reply_markup: markup,
      parse_mode: 'HTML',
    }),
  });

  const data = await res.json();

  if (!data?.ok) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: JSON.stringify(data),
        parse_mode: 'HTML',
      }),
    });
  }

  if (safeComment) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `📝 ${safeComment}`,
        parse_mode: 'HTML',
      }),
    });
  }

  console.log('tg sendPhoto:', data?.ok ? 'sent' : JSON.stringify(data));
};

type Targets = {
  takeProfitPrice: number;
  stopLossPrice: number;
  riskRatio: number;
};

export const calcTargetsFromTrendLine = (
  trendLine: TrendLine,
  entryPrice: number,
): Targets | null => {
  const { direction, points } = trendLine;
  const [start, end] = points;

  const basePrice = start.value;
  const breakPrice = end.value;

  if (direction === 'LONG' && entryPrice < breakPrice) {
    return null;
  }

  if (direction === 'SHORT' && entryPrice > breakPrice) {
    return null;
  }

  const movePercent = Math.abs((breakPrice - basePrice) / basePrice) * 100;

  if (movePercent < MIN_TRENDLINE_MOVE_PERCENT) {
    return null;
  }

  const rawTakeProfit = breakPrice + (basePrice - breakPrice) * (2 / 3);

  const minTpMove = entryPrice * (TP_MIN_PERCENT / 100);
  const maxTpMove = entryPrice * (TP_MAX_PERCENT / 100);

  let tpDistance =
    direction === 'LONG'
      ? rawTakeProfit - entryPrice
      : entryPrice - rawTakeProfit;

  if (tpDistance <= 0) {
    tpDistance = minTpMove;
  }

  tpDistance = Math.max(minTpMove, Math.min(tpDistance, maxTpMove));

  const takeProfitPrice =
    direction === 'LONG' ? entryPrice + tpDistance : entryPrice - tpDistance;

  const stopLossPrice =
    direction === 'LONG'
      ? breakPrice * (1 - SL_PERCENT / 100)
      : breakPrice * (1 + SL_PERCENT / 100);

  let riskRatio: number;

  if (direction === 'LONG') {
    const reward = takeProfitPrice - entryPrice;
    const risk = entryPrice - stopLossPrice;
    riskRatio = risk > 0 ? reward / risk : 0;
  } else {
    const reward = entryPrice - takeProfitPrice;
    const risk = stopLossPrice - entryPrice;
    riskRatio = risk > 0 ? reward / risk : 0;
  }

  if (riskRatio <= 1) {
    return null;
  }

  return {
    takeProfitPrice,
    stopLossPrice,
    riskRatio,
  };
};
