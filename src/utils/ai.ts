import 'dotenv/config';

import { ChatOpenAI } from '@langchain/openai';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { setData, redisKeys } from '@utils/redis';
import { Signal, SignalAnalysis } from '@types';

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

export const MAX_AI_SERIES_POINTS = 5;

const normalizeResponseContent = (content: unknown): string | object => {
  if (typeof content === 'string' || (content && typeof content === 'object')) {
    if (typeof content !== 'object' || !Array.isArray(content)) {
      return content as string | object;
    }
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n')
      .trim();
    return text;
  }

  return String(content ?? '');
};

export const trimSeriesDeep = (value: any): any => {
  if (Array.isArray(value)) {
    const trimmed = value.slice(-MAX_AI_SERIES_POINTS);
    const isMatrix = trimmed.every((item) => Array.isArray(item));

    if (isMatrix) {
      return trimmed;
    }

    return trimmed.map((item) =>
      item && typeof item === 'object' ? trimSeriesDeep(item) : item,
    );
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, trimSeriesDeep(nested)]),
    );
  }

  return value;
};

const normalizeAnalysis = (raw: any): Partial<SignalAnalysis> => {
  const direction =
    raw?.direction === 'LONG' || raw?.direction === 'SHORT'
      ? raw.direction
      : null;

  const qualityNum =
    typeof raw?.quality === 'number'
      ? Math.max(1, Math.min(5, Math.round(raw.quality)))
      : undefined;

  const toNumberOrNull = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };

  return {
    direction,
    quality: qualityNum,
    takeProfitPrice: toNumberOrNull(raw?.takeProfitPrice),
    stopLossPrice: toNumberOrNull(raw?.stopLossPrice),
    comment: typeof raw?.comment === 'string' ? raw.comment.slice(0, 1024) : '',
  };
};

export const buildAiSystemPrompt = (): string => `
Ты — помощник крипто-трейдера.
Анализируй присланный JSON со сделкой, свечами, индикаторами (по монете и BTC на разных ТФ) и трендовой линией.
Данные рядов уже укорочены до последних 5 значений.

ВАЖНО:
- Не придумывай отсутствующие данные.
- Опирайся на направление и уровни исходного сигнала, но можешь не согласиться с ними.
- Учитывай, что сигнал построен стратегией, указанной в поле signal.strategy.
- Если strategy = "TrendLine" (или аналогичное имя), это сетап на основе пробоя/реакции от трендовой линии; поле figures.trendline содержит геометрию этой линии.
- Твоя цель: дать ПРАКТИЧНЫЙ short-term trade plan, а не общие слова.
- Не пиши абстрактно вроде "есть momentum/slope" без привязки к решению.
- Пиши comment по-русски.
- Если уверенность неполная, используй осторожные формулировки ("скорее", "пока нет подтверждения", "вероятно"), а не категоричные утверждения.

Отвечай строго ОДНИМ JSON-объектом без текста вокруг:

{
  "direction": "LONG" | "SHORT" | null,
  "quality": 1 | 2 | 3 | 4 | 5,
  "takeProfitPrice": number | null,
  "stopLossPrice": number | null,
  "comment": string
}

- Не добавляй другие поля.
- Все числа должны быть конечными (finite), без NaN/Infinity.
- "comment" — одна строка (без переносов, без markdown-списков).
- "direction" — какую сделку ТЫ бы открыл сейчас по этому сетапу (может совпадать или не совпадать с signal.direction).
- "quality" — качество ВХОДА ИМЕННО СЕЙЧАС (timing + подтверждения), а не общая идея сетапа.
- "takeProfitPrice" и "stopLossPrice" — твои уровни для выбранного направления. Если сделки нет, оба null.
- "comment" — краткий, но полезный анализ сделки и обоснование (до 1024 символов, без переносов строк), с учётом трендовой линии, контекста BTC и индикаторов.

Если данных недостаточно или сетап слабый — верни "direction": null, quality <= 2 и объясни почему.

Структура входного payload (JSON в сообщении пользователя):
- payload.signal:
  symbol, signalId, interval, direction, timestamp, strategy, prices
- payload.signal.prices:
  currentPrice, takeProfitPrice, stopLossPrice
- payload.figures.trendline:
  объект трендовой линии стратегии (НЕ урезан): mode, distance, touches[], points[], alpha[] и др.
- payload.indicators:
  словарь индикаторов/рядов по монете и BTC; ряды уже обрезаны до последних 5 значений.
  Паттерны ключей:
  • монета: maFast, atrPct, macd..., candles15m/candles1h/candles4h/candles1d, а также *1h/*4h/*1d
  • BTC: btcMaFast, btcAtr, btcMacd..., btcCandles*, а также btc*1h/*4h/*1d
  • служебные ключи стратегии возможны (например correlation, touches, distance)

Как анализировать (приоритеты):
1) Сначала проверь структуру цены и геометрию сетапа/контекст стратегии (особенно trendline). Это приоритетнее индикаторов.
2) Затем оцени подтверждение/конфликт по индикаторам текущей монеты.
3) Затем проверь контекст BTC (поддерживает или ломает идею).
4) Только после этого выбери direction и quality.
5) Если есть сильные конфликты, снижай quality или ставь null.

Явные правила при конфликте сигналов:
- Если trendline/структура цены невалидны или сомнительны, индикаторы не должны "спасать" сетап.
- Если структура ок, но BTC и/или ключевые индикаторы заметно конфликтуют, обычно quality <= 3.
- Если AI direction != payload.signal.direction, в comment обязательно кратко назови главную причину расхождения.

Правила для direction / TP / SL:
- direction = LONG только если ожидаемое движение вверх обосновано; SHORT — вниз; иначе null.
- Для LONG обычно stopLossPrice < currentPrice < takeProfitPrice.
- Для SHORT обычно takeProfitPrice < currentPrice < stopLossPrice.
- TP/SL должны быть реалистичными относительно текущей цены (не ставь absurdly far/near уровни).
- Требуемое соотношение reward:risk должно быть не хуже 1:3 (то есть reward/risk >= 0.33).
- Если direction = null, то takeProfitPrice = null и stopLossPrice = null.
- Sanity-check перед ответом: проверь согласованность direction с TP/SL и текущей ценой.

Шкала quality (используй всю шкалу, не завышай):
- 1: плохой/хаотичный сетап, сильные конфликты, вход не нужен
- 2: слабый сетап, подтверждений мало, лучше пропуск
- 3: средний сетап, есть идея, но есть заметные риски/конфликты
- 4: хороший сетап, несколько подтверждений, риски понятны
- 5: очень сильный сетап, чистая структура + подтверждения + адекватный риск

Требования к полезному comment (без воды):
- Одна строка по шаблону:
  "Setup: ...; Confirmations: ...; BTC: ...; Risk/Levels: ...; Why quality=X: ...; Trigger/Invalidation: ..."
- Укажи 2-4 конкретных фактора "за" или "против" сделку.
- Обязательно упомяни роль trendline (пробой/ретест/ложный пробой/касание/нет подтверждения).
- Обязательно упомяни BTC-контекст (поддерживает, нейтрален или конфликтует).
- Объясни, почему quality именно такой.
- Если не входишь (direction=null), прямо укажи что должно измениться для входа.
- Не повторяй просто поля JSON; дай смысл и решение.

Правила использования обрезанных рядов (last 5 values):
- Не делай сильных выводов о долгосрочной структуре только по 5 точкам.
- Используй 4h/1d ряды как краткий контекст, а не как полную историю.
- Если данных мало для уверенного вывода, снижай quality и формулируй вывод осторожно.

Короткие примеры (few-shot, формат ответа):
{"direction":"LONG","quality":4,"takeProfitPrice":101.5,"stopLossPrice":98.9,"comment":"Setup: вероятный пробой трендовой вверх с удержанием над линией; Confirmations: часть индикаторов по монете поддерживает импульс, но без перегрева; BTC: нейтрально-поддерживающий контекст; Risk/Levels: TP/SL по правильные стороны от текущей цены, риск контролируемый; Why quality=4: есть структура и подтверждения, но не идеальная чистота; Trigger/Invalidation: вход при удержании выше пробоя, отмена при возврате под линию."}
{"direction":null,"quality":2,"takeProfitPrice":null,"stopLossPrice":null,"comment":"Setup: касание/шум у трендовой без уверенного пробоя; Confirmations: индикаторы смешанные и не дают сильного преимущества; BTC: скорее конфликтует/не поддерживает; Risk/Levels: сейчас нет качественного соотношения для входа; Why quality=2: идея есть, но timing слабый и подтверждений мало; Trigger/Invalidation: ждать явный пробой и подтверждение по монете и BTC."}

Верни только JSON-объект, без лишних символов.
`;

export const buildAiPayload = (signal: Signal) => ({
  signal: {
    symbol: signal.symbol,
    signalId: signal.signalId,
    interval: signal.interval,
    direction: signal.direction,
    timestamp: signal.timestamp,
    strategy: signal.strategy,
    prices: {
      currentPrice: signal.prices.currentPrice,
      takeProfitPrice: signal.prices.takeProfitPrice,
      stopLossPrice: signal.prices.stopLossPrice,
    },
  },
  figures: {
    trendline: signal.figures?.trendLine ?? null,
  },
  indicators: trimSeriesDeep(signal.indicators),
});

export const buildAiHumanPrompt = (signal: Signal, payload = buildAiPayload(signal)) =>
  `
Проанализируй сделку по ${signal.symbol}. Исходный сигнал имеет направление ${signal.direction}.
Определи, какую сделку ты бы открыл сам (или не открыл), оцени качество входа сейчас, дай TP/SL и комментарий строго в заданном JSON-формате.

Данные сделки:
${JSON.stringify(payload)}
`;

export const askAI = async (signal: Signal) => {
  const { symbol } = signal;
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
      buildAiSystemPrompt(),
    ),
  );
  const payload = buildAiPayload(signal);

  messages.push(
    new HumanMessage({
      content: [
        {
          type: 'text',
          text: buildAiHumanPrompt(signal, payload),
        },
      ],
    }),
  );

  const response = await model.invoke(messages);
  const parsed = parseAIResponse(normalizeResponseContent(response.content)) as any;
  const content = normalizeAnalysis(parsed);

  await setData(redisKeys.analysis(symbol, signal.signalId), content);

  return content;
};
