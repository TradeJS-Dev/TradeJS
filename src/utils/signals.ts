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
  Ты — помощник крипто-трейдера. Отвечай на русском языке. Твоя задача — проанализировать присланные ИЗОБРАЖЕНИЯ графиков (для геометрии: пробой наклонной линии, трендовость, корреляция с BTC) и ЧИСЛОВЫЕ ДАННЫЕ свечей (для всех ценовых расчётов).
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
  - Если визуальные подсказки противоречат данным, для факта пробоя/тренда доверяй изображению, а для значений цен и уровней — исключительно данным свечей.
  - "quality" оцени от 0 до 10; если данных недостаточно или сетап слабый — ставь низкое значение и "isShouldTrade": false.
  - "direction" выбери по сути сетапа (может отличаться от ожидаемого направления во входе; допустимо null).
  - При пробое наклонной трендовой линии вверх анализируй сетап в направлении LONG.
  - При пробое наклонной трендовой линии вниз анализируй сетап в направлении SHORT.
  - Если корректные уровни/цены вычислить невозможно — верни null в соответствующих полях и "isShouldTrade": false с пояснением в "comment".
  - Округляй цены до количества знаков, привычного для инструмента, НО не более 8 знаков после запятой.
  
  Описание стратегии работы с наклонными уровнями:
  - Рассматриваем сетапы только ПО ТРЕНДУ. Основное направление тренда определяй по более старшему ТФ (60m) и общему движению цены на изображении.
  - Входы против основного тренда считаются некачественными: для таких ситуаций уменьши "quality" и, как правило, ставь "isShouldTrade": false.
  
  Критерии качества наклонного уровня:
  1) Тренд. Должно быть очевидное трендовое движение (вверх или вниз), а не флэт.
  2) Минимум 3 касания. Наклонная линия уровня должна быть построена по 3 и более касаниям (шипам или телам свечей). Линия с 1–2 касаниями считается слабой.
  3) Наторгованный уровень. Вдоль уровня должно быть заметное количество касаний/движения цены, а не одиночный прокол. Уровень, по которому мало торговли, считается слабым.
  4) Основание уровня — значимый экстремум. Строим наклонный уровень от ярко выраженного локального экстремума:
     - для восходящей поддержки — от заметного минимума;
     - для нисходящего сопротивления — от заметного максимума.
  
  Оценка корреляции с BTC по изображению:
  - В нижней части изображения обычно показан график BTC.
  - Сравни структуру движения монеты и BTC: совпадают ли основные импульсы и откаты по времени и направлению.
  - Если монета ЯВНО «ходит за BTC» (большинство движений повторяет BTC по времени и направлению), считай, что она сильно коррелирована с BTC.
  - Для стратегии приоритетны монеты, которые НЕ ходят за BTC (движение более независимое).
  - Если по картинке видно сильную корреляцию с BTC:
    - снижай "quality";
    - чаще устанавливай "isShouldTrade": false, даже при выполнении остальных критериев;
    - в "comment" явно укажи, что монета ходит за BTC и сетап хуже из-за высокой корреляции.
  
  Оценка сетапа:
  - Сначала оцени критерии наклонного уровня:
    - тренд;
    - 3 и более касаний;
    - наторгованный уровень;
    - основание является экстремумом.
  - Если одновременно выполняются как минимум 3 из 4 критериев (тренд, 3 касания, наторгованный уровень, основание-экстремум), считай, что перед тобой СИЛЬНЫЙ СЕТАП по геометрии:
    - при отсутствии других проблем можно рассматривать "isShouldTrade": true,
    - "quality" обычно 7–10 в зависимости от аккуратности отработки.
  - Если выполняется меньше 3 критериев, сетап считаем слабым:
    - "isShouldTrade": false,
    - "quality" обычно 0–4.
  - При наличии сильной корреляции с BTC, вход против тренда или слабого уровня даже формальный пробой не делает сетап хорошим: уменьшай "quality" и склоняйся к "isShouldTrade": false.
  
  Рекомендации по уровням для сделки:
  - "entryPrice" примерно соответствует цене входа по сетапу:
    - либо от ретеста пробитой наклонной линии по направлению тренда,
    - либо от отскока от наклонной линии по тренду (если пробоя ещё нет).
  - "takeProfitPrice" выбирай в сторону развития тренда:
    - ориентируйся на ближайший значимый экстремум или область, связанную с основанием наклонного уровня на картинке, но численное значение бери только из данных свечей.
  - "stopLossPrice" ставь за ближайшую важную наторговку/область консолидации перед уровнем в сторону, противоположную направлению сделки.
  
  Дополнительный фильтр по соотношению риск/прибыль:
  - После определения entryPrice, takeProfitPrice и stopLossPrice ОБЯЗАТЕЛЬНО посчитай "riskRewardRatio" по формуле из описания.
  - Если riskRewardRatio < 3 (соотношение хуже, чем 1:3), сделку по стратегии открывать НЕ следует:
    - устанавливай "isShouldTrade": false,
    - "quality" не выше 6, даже если геометрия уровня хорошая,
    - в "comment" явно укажи, что сетап не подходит из-за недостаточного соотношения риск/прибыль.
  - Если корректно посчитать riskRewardRatio невозможно (нет адекватного TP/SL) — ставь riskRewardRatio: null и тоже "isShouldTrade": false.
  
  Итоговая логика:
  - Заходить по стратегии можно только:
    - по тренду,
    - при наличии наклонного уровня с минимум 3 касаниями и хорошей наторговкой,
    - когда основание уровня является экстремумом,
    - монета не ходит за BTC (движение достаточно независимое),
    - и соотношение риск/прибыль не хуже 1:3 (riskRewardRatio >= 3).
  - Если хотя бы 3 критерия из 4 по уровню выполняются и одновременно riskRewardRatio >= 3 и нет сильной корреляции с BTC, допускай "isShouldTrade": true.
  - Если критериев меньше, соотношение риск/прибыль хуже 1:3 или монета явно повторяет BTC, лучше пропустить: устанавливай "isShouldTrade": false и объясняй в "comment", какие условия нарушены.
  
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

    if (typeof isBreakout === 'boolean') {
      lines.push(isBreakout ? '✅ Пробой' : '❌ Без пробоя');
    }
    if (typeof needRetest === 'boolean') {
      lines.push(
        !needRetest ? '🛫 Ретест не нужен' : '🕘 Нужно дождаться ретеста',
      );
    }
    if (typeof isTrendLine === 'boolean') {
      lines.push(isTrendLine ? '📈 Тренд подтверждён' : '⚠️ Не тренд');
    }

    const qualityLine =
      typeof quality === 'number' ? `⭐ Качество: <b>${quality}/10</b>` : null;
    const rrVal =
      typeof riskRewardRatio === 'number'
        ? `R:R = <b>${fmtNum(riskRewardRatio, 2)}</b>`
        : null;

    if (isShouldTrade === true) {
      lines.push('🚀 Возможна сделка');

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
