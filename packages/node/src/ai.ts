import type { BaseMessageLike } from '@langchain/core/messages';
import { setData, redisKeys } from '@tradejs/infra/redis';
import {
  getUserSettings,
  type UserSettings,
} from '@tradejs/infra/userSettings';
import {
  buildAiHumanPromptAddonByStrategy,
  buildAiPayloadByStrategy,
  buildAiSystemPromptAddonByStrategy,
  postProcessAiAnalysisByStrategy,
} from './strategyAdapters/ai';
import { ensureStrategyPluginsLoaded } from './strategy/manifests';
import {
  AiPayload,
  AiPromptPair,
  Signal,
  SignalAnalysis,
} from '@tradejs/types';
export { MAX_AI_SERIES_POINTS, trimSeriesDeep } from './aiShared';

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

  const toText = (value: unknown) =>
    typeof value === 'string' ? value.slice(0, 400) : undefined;

  return {
    direction,
    quality: qualityNum,
    needRetest: Boolean(raw?.needRetest),
    retestPrice: toNumberOrNull(raw?.retestPrice),
    takeProfitPrice: toNumberOrNull(raw?.takeProfitPrice),
    stopLossPrice: toNumberOrNull(raw?.stopLossPrice),
    setup: toText(raw?.setup),
    confirmations: toText(raw?.confirmations),
    btcContext: toText(raw?.btcContext),
    retestPlan: toText(raw?.retestPlan),
    riskLevels: toText(raw?.riskLevels),
    qualityReason: toText(raw?.qualityReason),
    triggerInvalidation: toText(raw?.triggerInvalidation),
    comment: typeof raw?.comment === 'string' ? raw.comment.slice(0, 1024) : '',
  };
};

export const buildAiSystemPrompt = (signal?: Signal): string => `
Ты — внутренний классификатор структуры рынка для уже рассчитанного системного сигнала.
Анализируй присланный JSON со сделкой, свечами, индикаторами (по монете и BTC на разных ТФ) и фигурами/контекстом стратегии.
Данные рядов уже укорочены до последних 5 значений.

ВАЖНО:
- Не придумывай отсутствующие данные.
- Это задача внутреннего аудита/классификации, а не пользовательская рекомендация к действию.
- Не формируй инструкции по исполнению, не меняй исходную гипотезу на новую и не давай персонализированных инвестиционных рекомендаций.
- Опирайся на направление и уровни исходного сигнала, но можешь указать, что текущая структура с ними не согласуется.
- Учитывай, что сигнал построен стратегией, указанной в поле signal.strategy.
- Твоя цель: описать, насколько наблюдаемая структура согласуется с уже сформированным сигналом и насколько сигнал подтвержден структурно сейчас.
- Не пиши абстрактно вроде "есть momentum/slope" без привязки к решению.
- Пиши comment по-русски.
- Если уверенность неполная, используй осторожные формулировки ("скорее", "пока нет подтверждения", "вероятно"), а не категоричные утверждения.

Отвечай строго ОДНИМ JSON-объектом без текста вокруг:

{
  "direction": payload.signal.direction | null,
  "quality": 1 | 2 | 3 | 4 | 5,
  "needRetest": boolean,
  "retestPrice": number | null,
  "takeProfitPrice": number | null,
  "stopLossPrice": number | null,
  "setup": string,
  "confirmations": string,
  "btcContext": string,
  "retestPlan": string,
  "riskLevels": string,
  "qualityReason": string,
  "triggerInvalidation": string
}

- Не добавляй другие поля.
- Все числа должны быть конечными (finite), без NaN/Infinity.
- Все текстовые поля — короткие строки (без переносов, без markdown-списков).
- "direction" — не новая торговая идея, а только флаг согласованности с уже существующим сигналом: либо РОВНО payload.signal.direction, либо null (если текущая структура не подтверждает этот сигнал). Никогда не предлагай противоположное направление.
- "quality" — уровень структурного подтверждения текущего сигнала ИМЕННО СЕЙЧАС (timing + подтверждения), а не общая привлекательность идеи и не инвестиционный совет.
- "needRetest" — нужен ли дополнительный confirmation по уровню, чтобы считать текущий сигнал структурно подтвержденным.
- "retestPrice" — ключевой уровень подтверждения/проверки структуры (или null, если дополнительный уровень не нужен / не определён).
- "takeProfitPrice" и "stopLossPrice" — не придумывай новые торговые уровни. Если уже переданные в payload.signal.prices уровни выглядят внутренне согласованными с текущей ценой и подтвержденным сигналом, можешь вернуть их как audit existing levels; иначе верни null.
- Разбивай анализ на поля:
  - "setup" — что за сетап по структуре/трендовой линии сейчас.
  - "confirmations" — 2-4 подтверждения/конфликта по индикаторам монеты.
  - "btcContext" — поддерживает ли BTC идею или конфликтует.
  - "retestPlan" — что должно подтвердить структуру на ключевом уровне (или почему дополнительный уровень не нужен).
  - "riskLevels" — кратко про согласованность уже заданных уровней/структуры риска, без генерации нового плана сделки.
  - "qualityReason" — почему quality именно такой.
  - "triggerInvalidation" — что должно подтвердить сигнал / что отменяет наблюдаемую структурную гипотезу.
- "comment" не обязателен. Если указываешь, не дублируй структурные поля.

Если данных недостаточно или сетап слабый — верни "direction": null, quality <= 2 и объясни почему.

Структура входного payload (JSON в сообщении пользователя):
- payload.signal:
  symbol, signalId, interval, direction, timestamp, strategy, prices
- payload.signal.prices:
  currentPrice, takeProfitPrice, stopLossPrice
- payload.figures:
  словарь strategy-specific фигур/геометрии (если есть). Конкретные поля зависят от стратегии.
- payload.indicators:
  словарь индикаторов/рядов по монете и BTC; ряды уже обрезаны до последних 5 значений.
- payload.additionalIndicators:
  strategy-specific summary/context fields. Это не "шум", а полезные derived-поля, которые стратегия передает специально для решения.
  Примеры: helperFlags, structureContext, spread, correlation, volatilitySummary.
  Если такие поля есть, используй их как более явную подсказку, чем попытку заново вывести то же самое только по lines/points.
  Паттерны ключей:
  • монета: maFast, atrPct, macd..., candles15m/candles1h/candles4h/candles1d, а также *1h/*4h/*1d
  • BTC: btcMaFast, btcAtr, btcMacd..., btcCandles*, а также btc*1h/*4h/*1d
  • служебные ключи стратегии возможны (например correlation, spread, touches, distance)

Как анализировать (приоритеты):
1) Сначала проверь структуру цены и геометрию/контекст сетапа из payload.figures. Это приоритетнее индикаторов.
2) Затем используй payload.additionalIndicators, если там есть явный strategy-specific context по линии/спреду/корреляции и т.п.
3) Затем оцени подтверждение/конфликт по индикаторам текущей монеты.
4) Затем проверь контекст BTC (поддерживает или ломает идею).
5) Только после этого выбери direction, quality и решение по дополнительному уровню подтверждения.
6) Если есть сильные конфликты, снижай quality или ставь null.

Явные правила при конфликте сигналов:
- Если фигура/структура цены невалидны или сомнительны, индикаторы не должны "спасать" сетап.
- Если strategy-specific helper fields прямо говорят, что сигнал еще не подтвержден / без запаса / требует ожидания, не завышай quality.
- Если структура ок, но BTC и/или ключевые индикаторы заметно конфликтуют, обычно quality <= 3.
- Если текущий сигнал не подтвержден (direction=null), в comment обязательно кратко назови главную причину.
  Если используешь структурные поля, укажи главную причину в "qualityReason" и/или "triggerInvalidation".

Правила для direction / TP / SL:
- direction = LONG только если данные подтверждают уже существующий LONG-сигнал; SHORT — только если подтверждают уже существующий SHORT-сигнал; иначе null.
- Для LONG обычно stopLossPrice < currentPrice < takeProfitPrice.
- Для SHORT обычно takeProfitPrice < currentPrice < stopLossPrice.
- Не оптимизируй и не пересчитывай TP/SL под "лучшую сделку"; только оцени согласованность уже переданных уровней.
- Если direction = null, то takeProfitPrice = null и stopLossPrice = null.
- Если needRetest = false, то retestPrice = null.
- Если needRetest = true, retestPrice должен быть указан (finite number) и связан с уровнем ретеста/пробоя.
- Sanity-check перед ответом: проверь согласованность direction с TP/SL и текущей ценой.

Шкала quality (используй всю шкалу, не завышай):
- 1: плохой/хаотичный сетап, сильные конфликты, сигнал структурно не подтвержден
- 2: слабый сетап, подтверждений мало, сигнал пока скорее watch/reject
- 3: средний сетап, часть структуры есть, но остаются заметные конфликты
- 4: хороший сетап, несколько подтверждений, структура в целом согласована
- 5: очень сильный сетап, чистая структура + подтверждения + внутренняя согласованность уровней

Требования к полезному структурированному анализу (без воды):
- Укажи 2-4 конкретных фактора "за" или "против" подтверждения сигнала в "confirmations".
- Обязательно упомяни роль ключевой фигуры/структуры сетапа (например пробой/ретест/ложный пробой/касание/нет подтверждения).
- Обязательно упомяни BTC-контекст (поддерживает, нейтрален или конфликтует).
- Объясни, почему quality именно такой.
- Если signal не подтвержден (direction=null), прямо укажи что должно измениться для подтверждения сигнала.
- В "retestPlan" не пиши технический шаблон вроде "needRetest=false @ null"; пиши человеческое объяснение.
- Не повторяй просто поля JSON; дай смысл и решение.

Правила использования обрезанных рядов (last 5 values):
- Не делай сильных выводов о долгосрочной структуре только по 5 точкам.
- Используй 4h/1d ряды как краткий контекст, а не как полную историю.
- Если данных мало для уверенного вывода, снижай quality и формулируй вывод осторожно.

Короткие примеры (few-shot, формат ответа):
{"direction":"LONG","quality":4,"needRetest":true,"retestPrice":100.2,"takeProfitPrice":101.5,"stopLossPrice":98.9,"setup":"Вероятный пробой трендовой вверх, но для подтверждения сигнала нужна дополнительная проверка уровня.","confirmations":"По монете есть поддержка импульса без явного перегрева, но подтверждение еще не идеальное.","btcContext":"BTC нейтрально поддерживает идею и не конфликтует с текущим LONG-сигналом.","retestPlan":"Ключевой уровень 100.2: удержание выше него подтвердит структуру сигнала.","riskLevels":"Переданные TP/SL стоят по правильные стороны от текущей цены и выглядят внутренне согласованно.","qualityReason":"Quality=4: структура хорошая, но дополнительное подтверждение по уровню еще желательно.","triggerInvalidation":"Структура подтверждается при удержании уровня; гипотеза ослабевает при возврате под линию."}
{"direction":null,"quality":2,"needRetest":false,"retestPrice":null,"takeProfitPrice":null,"stopLossPrice":null,"setup":"Касание/шум у трендовой без уверенного пробоя.","confirmations":"Индикаторы смешанные и не дают сильного структурного преимущества.","btcContext":"BTC скорее конфликтует или не поддерживает текущую гипотезу.","retestPlan":"Дополнительный уровень пока рано оценивать, потому что нет самого факта качественного пробоя.","riskLevels":"Переданные уровни пока не стоит считать подтвержденными из-за слабой структуры.","qualityReason":"Quality=2: timing слабый и подтверждений мало.","triggerInvalidation":"Ждать явный пробой и подтверждение по монете и BTC."}

Верни только JSON-объект, без лишних символов.
${signal ? buildAiSystemPromptAddonByStrategy(signal) : ''}
`;

export const buildAiPayload = (signal: Signal): AiPayload =>
  buildAiPayloadByStrategy(signal);

export const buildAiHumanPrompt = (
  signal: Signal,
  payload = buildAiPayload(signal),
) =>
  `
Проанализируй уже рассчитанный внутренний сигнал по ${signal.symbol}. Исходный сигнал имеет направление ${signal.direction}.
Это задача классификации/аудита структуры, а не рекомендация к действию. Определи, подтверждает ли текущая структура уже существующий сигнал, насколько он согласован структурно сейчас, нужен ли дополнительный confirmation level, и выглядят ли уже переданные в payload.signal.prices уровни внутренне согласованными. Не формируй новую гипотезу вместо исходного сигнала и не придумывай новые уровни; верни только JSON в заданном формате.

Данные сделки:
${JSON.stringify(payload)}
${buildAiHumanPromptAddonByStrategy(signal, payload)}
`;

interface AiRequestOptions {
  userName?: string;
  signal?: Signal;
  payload?: AiPayload;
  model?: string;
}

type AiModel = {
  invoke: (messages: BaseMessageLike[]) => Promise<{ content: unknown }>;
};

export const DEFAULT_AI_MODEL = 'openai/gpt-5-mini';

const userSettingsCache = new Map<string, Promise<UserSettings>>();
const aiModelCache = new Map<string, Promise<AiModel>>();

const getAiModelCacheKey = (userName: string, modelName: string) =>
  `${userName}::${modelName}`;

const getAiSettings = async (userName = 'root') => {
  let settingsPromise = userSettingsCache.get(userName);
  if (!settingsPromise) {
    settingsPromise = getUserSettings(userName);
    settingsPromise.catch(() => {
      userSettingsCache.delete(userName);
    });
    userSettingsCache.set(userName, settingsPromise);
  }

  const settings = await settingsPromise;
  if (!settings.OPENAI_API_KEY || !settings.OPENAI_API_ENDPOINT) {
    throw new Error(`AI settings are incomplete for user ${userName}`);
  }

  return settings;
};

const createAiModel = async (
  userName = 'root',
  modelName = DEFAULT_AI_MODEL,
) => {
  const cacheKey = getAiModelCacheKey(userName, modelName);
  let modelPromise = aiModelCache.get(cacheKey);
  if (!modelPromise) {
    modelPromise = (async () => {
      const [{ ChatOpenAI }, settings] = await Promise.all([
        import('@langchain/openai'),
        getAiSettings(userName),
      ]);

      return new ChatOpenAI({
        temperature: 0.2,
        modelName,
        apiKey: settings.OPENAI_API_KEY,
        configuration: {
          baseURL: settings.OPENAI_API_ENDPOINT,
          defaultHeaders: {
            'HTTP-Referer': 'https://tradejs.dev',
            'X-Title': 'Inv',
          },
        },
      }) as AiModel;
    })();
    modelPromise.catch(() => {
      aiModelCache.delete(cacheKey);
    });
    aiModelCache.set(cacheKey, modelPromise);
  }

  return modelPromise;
};

const getAiModel = async (userName = 'root', modelName = DEFAULT_AI_MODEL) => {
  try {
    return await createAiModel(userName, modelName);
  } catch (error) {
    aiModelCache.delete(getAiModelCacheKey(userName, modelName));
    userSettingsCache.delete(userName);
    throw error;
  }
};

export const resetAiRuntimeCache = () => {
  aiModelCache.clear();
  userSettingsCache.clear();
};

export const ensureAiStrategyPluginsLoaded = async () => {
  await ensureStrategyPluginsLoaded();
};

export const buildAiPrompts = (signal: Signal): AiPromptPair => {
  const payload = buildAiPayload(signal);
  return {
    systemPrompt: buildAiSystemPrompt(signal),
    humanPrompt: buildAiHumanPrompt(signal, payload),
  };
};

export const runAiPrompt = async (
  { systemPrompt, humanPrompt }: AiPromptPair,
  options: AiRequestOptions = {},
): Promise<Partial<SignalAnalysis>> => {
  if (options.signal) {
    await ensureAiStrategyPluginsLoaded();
  }

  const [{ HumanMessage, SystemMessage }, model] = await Promise.all([
    import('@langchain/core/messages'),
    getAiModel(options.userName, options.model),
  ]);
  const messages: BaseMessageLike[] = [];

  messages.push(new SystemMessage(systemPrompt));
  messages.push(
    new HumanMessage({
      content: [
        {
          type: 'text',
          text: humanPrompt,
        },
      ],
    }),
  );

  const response = await model.invoke(messages);
  const parsed = parseAIResponse(
    normalizeResponseContent(response.content),
  ) as any;
  const normalized = normalizeAnalysis(parsed);

  if (!options.signal) {
    return normalized;
  }

  return postProcessAiAnalysisByStrategy(
    options.signal,
    normalized,
    options.payload,
  );
};

export const askAI = async (signal: Signal, options: AiRequestOptions = {}) => {
  const { symbol } = signal;
  await ensureAiStrategyPluginsLoaded();
  const payload = buildAiPayload(signal);
  const content = await runAiPrompt(
    {
      systemPrompt: buildAiSystemPrompt(signal),
      humanPrompt: buildAiHumanPrompt(signal, payload),
    },
    {
      ...options,
      signal,
      payload,
    },
  );
  await setData(redisKeys.analysis(symbol, signal.signalId), content);

  return content;
};
