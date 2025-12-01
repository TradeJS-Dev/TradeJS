import 'dotenv/config';

import { ChatOpenAI } from '@langchain/openai';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { getScreenshotBase64, getImageUrl } from '@utils/screenshot';
import { setData, redisKeys, delKey } from '@utils/redis';
import { Signal } from '@types';

const { APP_URL } = process.env;

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

  const content = parseAIResponse(response.content) as any;

  if (
    !content.isTrendLine ||
    !['LONG', 'SHORT'].includes(content.direction ?? '')
  ) {
    await delKey(redisKeys.signal(symbol, signal.signalId));
  }

  await setData(redisKeys.analysis(symbol, signal.signalId), content);
};
