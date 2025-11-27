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
  const { symbol, direction, trendLines } = signal;
  const messages = new Array<BaseMessage>();

  const model = new ChatOpenAI({
    temperature: 0.2,
    modelName: 'google/gemini-2.5-flash',
    // modelName: 'anthropic/claude-opus-4.5',
    // modelName: 'anthropic/claude-sonnet-4.5',
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

  messages.push(
    new SystemMessage(
      `
Ты — помощник крипто-трейдера. Анализируй ТОЛЬКО:
— присланные ИЗОБРАЖЕНИЯ (геометрия, пробой, тренд, корреляция с BTC),
— данные свечей (только для расчёта TakeProfit / StopLoss).

Отвечай строго ОДНИМ JSON-объектом без текста вокруг:

{
  "isBreakout": boolean,
  "isTrendLine": boolean,
  "isTrendLineFromExtremum": boolean,
  "isWellTradedLevel": boolean,
  "needRetest": boolean,

  "direction": "LONG" | "SHORT" | null,
  "currentTrend": "UP" | "DOWN" | null,
  "btcTrend": "UP" | "DOWN" | null,
  "isBitcoinCorrelation": boolean,

  "takeProfitPrice": number | null,
  "stopLossPrice": number | null,

  "comment": string
}

=== ОПРЕДЕЛЕНИЯ ПОЛЕЙ ===
- "isBreakout" — есть ли пробой наклонной линии (свеча закрылась телом за линией; один прокол тенью ≠ пробой).
- "isTrendLine" — корректна ли трендовая линия (касается нескольких значимых экстремумов, логична по структуре).
- "isTrendLineFromExtremum" — начинается ли линия от значимого экстремума.
- "isWellTradedLevel" — является ли текущий уровень наторгованным (цена там задерживалась).
- "needRetest" — после пробоя сейчас нужен ретест линии (если идёт откат к линии).

- "direction" — направление сделки по сетапу:
  "LONG" при пробое вверх, "SHORT" при пробое вниз, иначе null.
- "currentTrend" — общее направление цены монеты:
  "UP" если движение в целом вверх, "DOWN" если в целом вниз, иначе null.
- "btcTrend" — то же самое для BTC-графика снизу.
- "isBitcoinCorrelation" — true, если импульсы и откаты монеты на 60m графике в основном совпадают с BTC по времени и направлению; несколько случайных совпадений ≠ корреляция.

- "takeProfitPrice" — цель сделки:
  поставь её на сильной наторгованной зоне по направлению сделки,
  примерно на 2/3 пути от текущей цены (или зоны пробоя) к основанию трендовой линии,
  с небольшим безопасным запасом внутри этой зоны (не впритык к краю).

- "stopLossPrice" — защитный стоп:
  поставь его ПЕРЕД пробоем — за наторгованной зоной/консолидацией,
  от которой началось движение, приведшее к пробою линии,
  чуть дальше границы этой зоны в противоположную сторону от сделки,
  так, чтобы стоп стоял внутри логичной защитной области до пробоя.

- "comment" — краткое текстовое пояснение (до 1024 символов, без переносов строк).

=== КРАТКИЕ ТЕРМИНЫ ===
Значимый экстремум (используется в "isTrendLineFromExtremum"):
— локальный максимум/минимум, который явно выделяется,
— крупнее соседних колебаний,
— лучшая вершина/дно для основания наклонной линии,
— от него был заметный импульс.

Касание трендовой (для "isTrendLine"):
— тень свечи касается или слегка пробивает линию,
— есть реакция (отскок/замедление),
— просто «рядом» без реакции ≠ касание.

Наторгованный уровень (для "isWellTradedLevel"):
— зона, откуда прошел пробой цена неоднократно задерживалась,
— множество касаний или боковое движение вдоль уровня,
— 1–2 быстрых касания без задержки ≠ наторговка.

Пробой (для "isBreakout"):
— свеча закрылась телом за наклонной линией; прокол тенью без закрытия ≠ пробой.

Ретест (для "needRetest"):
— цена возвращается к пробитой линии,
— касается её тенью,
— затем снова движется в сторону пробоя.

ПРАВИЛА ДЛЯ ЦЕН:
- Все численные значения ("takeProfitPrice", "stopLossPrice") бери ТОЛЬКО из массивов свечей, не с изображений.
- При выборе "takeProfitPrice" и "stopLossPrice" стремись к тому, чтобы расстояние до цели
  примерно в 3 раза превышало расстояние до стопа (соотношение риск/прибыль ≈ 1:3),
  но не нарушай логику уровней и наторгованных зон.
- Округляй цены до формата инструмента (но не более 8 знаков).
- Если уровни определить нельзя — ставь null и кратко объясни причину в "comment".

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
Данные последних 100 свечей на 15m графике:
${toJson(data15.slice(-100))}

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

Дополнительно я передаю наклонные линии как ВСПОМОГАТЕЛЬНЫЙ КОНТЕКСТ
ИСКЛЮЧИТЕЛЬНО для более точного определения TakeProfit и StopLoss.

${toJson(trendLines)}

ВАЖНО:
- Эти линии НЕ используются для определения:
  — пробоя ("isBreakout"),
  — корректности трендовой ("isTrendLine", "isTrendLineFromExtremum"),
  — направления сделки ("direction").
- Они служат ТОЛЬКО ориентиром для логичного расположения TP и SL
  относительно структуры движения и наторгованных зон.

Формат данных наклонных линий (JSON):

{
  "lows": [...],
  "highs": [...]
}

Где:
- "lows" — массив восходящих наклонных линий (поддержки, построенные по минимумам).
- "highs" — массив нисходящих наклонных линий (сопротивления, построенные по максимумам).

Каждая линия имеет формат:

{
  "id": string,
  "points": [
    {
      "timestamp": number, // начало линии (мс)
      "value": number      // цена в этой точке
    },
    {
      "timestamp": number, // конец линии (мс)
      "value": number      // цена в этой точке
    }
  ]
}

Правила использования этих линий для TP / SL:
- Используй их только как ориентир:
  — где логично искать наторгованные зоны,
  — где находится основание/корень движения,
  — откуда начинался импульс к пробою.
- НЕ делай на их основе выводы о наличии пробоя или тренда.
- Если эти линии противоречат данным свечей — приоритет всегда у данных свечей.
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
    !content.isBreakout ||
    !content.isTrendLine ||
    !['LONG', 'SHORT'].includes(content.direction ?? '') ||
    content.needRetest
  ) {
    await delKey(redisKeys.signal(symbol, signal.signalId));
  }

  const lastCandle = data15.pop();

  if (!lastCandle) {
    return;
  }

  await setData(redisKeys.analysis(symbol, signal.signalId), {
    ...content,
    timestamp: lastCandle.timestamp,
    currentPrice: lastCandle.close,
  });
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

const escapeHtml = (s?: string | null) => {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

export const formatMessage = (
  { symbol, direction: signalDirection }: Signal,
  analysis: Partial<Analysis> | null | undefined,
): string => {
  try {
    if (!analysis || Object.keys(analysis).length === 0) {
      return `<b>⚠️ Анализ недоступен для ${symbol}</b>\nПопробуйте обновить график или повторить запрос позже.`;
    }

    const {
      direction,
      currentTrend,
      isBreakout,
      isTrendLine,
      isWellTradedLevel,
      isTrendLineFromExtremum,
      isBitcoinCorrelation,
      needRetest,
      currentPrice,
      takeProfitPrice,
      stopLossPrice,
      comment,
    } = analysis;

    const lines: string[] = [];
    let score = 1;

    const getPrices = () => {
      const current = currentPrice ? Number(currentPrice) : null;
      const tp = takeProfitPrice ? Number(takeProfitPrice) : null;
      const sl = stopLossPrice ? Number(stopLossPrice) : null;

      // Risk–Reward
      let rr: number | null = null;
      if (current && tp && sl) {
        const risk = current > sl ? current - sl : sl - current;
        const reward = tp > current ? tp - current : current - tp;

        if (risk > 0) {
          rr = reward / risk;
        }
      }

      const tpPercent =
        current && tp
          ? (((tp - current) / current) * 100).toFixed(2) + '%'
          : null;

      const slPercent =
        current && sl
          ? (((sl - current) / current) * 100).toFixed(2) + '%'
          : null;

      const prices = [
        current && `Price: <b>${formatNumber(current)}</b>`,
        tp && `TP: <b>${formatNumber(tp)}</b> (${tpPercent})`,
        sl && `SL: <b>${formatNumber(sl)}</b> (${slPercent})`,
        rr && `R:R = <b>${rr.toFixed(2)}</b>`,
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

      if (direction !== signalDirection) {
        lines.push(`<b>⚠️ Сетап для ${symbol} не соответствует трендовой линии</b>`);
        return;
      }

      if (!['UP', 'DOWN'].includes(currentTrend ?? '')) {
        lines.push(`<b>⚠️ Не получилось определить текущий тренд для ${symbol}</b>`);
        return;
      }

      const emojiDir =
        direction === 'LONG'
          ? '🟢 LONG'
          : direction === 'SHORT'
            ? '🔴 SHORT'
            : '⚪️ NO TRADE';

      lines.push(`<b>${emojiDir} ${symbol}</b>`);
      lines.push('');

      if (typeof isTrendLine === 'boolean' && isTrendLine) {
        lines.push('✅ Тренд подтверждён');
      } else {
        lines.push('❌ Не тренд');

        return;
      }

      if (typeof isBreakout === 'boolean' && isBreakout) {
        lines.push('✅ Пробой');
      } else {
        lines.push('❌ Без пробоя');

        return;
      }

      if (typeof needRetest === 'boolean' && !needRetest) {
        lines.push('✅ Ретест не нужен');
      } else {
        lines.push('❌ Нужно дождаться ретеста');

        return;
      }

      lines.push('');

      lines.push('✅ Есть 3 касания');

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

      const emojiScore = score >= 4 ? '🟢' : score >= 3 ? '🟡' : '🔴';

      lines.push(`${emojiScore} Качество сетапа <b>${score}</b> из 5`);

      const prices = getPrices();

      if (prices) {
        lines.push('');
        lines.push(prices);
      }
    };

    checkAnalys();

    const safeComment = escapeHtml(comment)?.trim();

    if (safeComment) {
      lines.push('');
      lines.push(`📝 ${safeComment}`);
    }

    return lines.join('\n').trim();
  } catch (err) {
    return `<b>⚠️ Ошибка форматирования сообщения для ${symbol}</b>\nДетали: ${(err as Error).message || String(err)}`;
  }
};

export const sendSignal = async (signal: Signal) => {
  const { symbol, signalId, interval } = signal;

  const analysis = (await getData(
    redisKeys.analysis(symbol, signalId),
  )) as Analysis;

  const message = formatMessage(signal, analysis);

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
        text: message,
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

  console.log('tg sendPhoto:', data?.ok);
};
