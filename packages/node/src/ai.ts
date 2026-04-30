import type { BaseMessageLike } from '@langchain/core/messages';
import {
  DEFAULT_AI_RESPONSE_LANGUAGE,
  getAiResponseLanguagePromptName,
} from '@tradejs/infra/aiLanguages';
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

type DeterministicAiGateContext = {
  approvalAllowedNow?: boolean;
  deterministicQuality?: number;
  maxAllowedQuality?: number;
  structuralHardBlockReasons?: string[];
};

const parseAIResponse = (input: string | object): object => {
  try {
    if (typeof input === 'object' && input !== null) return input;
    const match = (input as string).match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON block not found');
    return JSON.parse(match[0]);
  } catch (err) {
    console.error('Failed to parse AI response:', err);
    console.log('Raw AI response:', input);
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

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
};

const getSignalDirection = (signal: Signal) =>
  signal.direction === 'LONG' || signal.direction === 'SHORT'
    ? signal.direction
    : null;

const getDeterministicQuality = (
  gateContext: DeterministicAiGateContext | null,
) => {
  const deterministicQuality = Number(gateContext?.deterministicQuality);
  if (Number.isFinite(deterministicQuality)) {
    return Math.max(1, Math.min(5, Math.round(deterministicQuality)));
  }

  const maxAllowedQuality = Number(gateContext?.maxAllowedQuality);
  if (Number.isFinite(maxAllowedQuality)) {
    return Math.max(1, Math.min(5, Math.round(maxAllowedQuality)));
  }

  return Array.isArray(gateContext?.structuralHardBlockReasons) &&
    gateContext.structuralHardBlockReasons.length > 0
    ? 2
    : 3;
};

export const buildAiSystemPrompt = (signal?: Signal): string => `
You are an internal market-structure classifier for an already computed system signal.
Analyze the provided JSON containing the trade, candles, indicators (for the coin and BTC across multiple timeframes), and strategy figures/context.
Series data is already trimmed to the latest 5 values.

Important:
- Do not invent missing data.
- This is an internal audit/classification task, not user-facing trading advice.
- Do not generate execution instructions, do not replace the original thesis with a new one, and do not provide personalized investment advice.
- Use the original signal direction and levels as the anchor, but you may state that the current structure does not support them.
- Respect the source strategy specified in \`signal.strategy\`.
- Your goal is to explain how well the observed structure matches the existing signal and how structurally confirmed it is right now.
- Do not write vague statements like "there is momentum/slope" without tying them to the decision.
- Write all user-visible text fields in the requested response language. If no explicit language instruction is provided later, default to English.
- If confidence is incomplete, prefer cautious wording such as "likely", "not confirmed yet", or "probably" instead of categorical claims.

Return exactly one JSON object and nothing else:

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

- Do not add any other fields.
- All numbers must be finite, with no \`NaN\` or \`Infinity\`.
- All text fields must be short strings with no line breaks and no markdown lists.
- \`direction\` is not a new trade idea. It is only a compatibility flag for the existing signal: either exactly \`payload.signal.direction\` or \`null\` if the current structure does not confirm that signal. Never propose the opposite direction.
- \`quality\` is the structural confirmation level of the current signal right now, including timing and confirmations. It is not a general attractiveness score and not investment advice.
- \`needRetest\` indicates whether an additional confirmation level is required before the current signal can be treated as structurally confirmed.
- \`retestPrice\` is the key level that would confirm or invalidate the structure, or \`null\` if no extra level is needed or available.
- \`takeProfitPrice\` and \`stopLossPrice\` must not be newly invented levels. If the levels already supplied in \`payload.signal.prices\` still look internally coherent relative to the current price and the confirmed signal, you may return them as an audit of existing levels; otherwise return \`null\`.
- Use these fields as separate parts of the analysis:
  - \`setup\`: the current structural setup or trendline state.
  - \`confirmations\`: 2-4 concrete confirmations or conflicts from the coin indicators.
  - \`btcContext\`: whether BTC supports the idea, is neutral, or conflicts with it.
  - \`retestPlan\`: what must happen at the key level to confirm the structure, or why no extra level is needed.
  - \`riskLevels\`: a short note on whether the existing levels and risk structure are internally coherent, without creating a new trade plan.
  - \`qualityReason\`: why the quality score is what it is.
  - \`triggerInvalidation\`: what must happen to confirm the signal or what invalidates the current structural thesis.
- \`comment\` is optional. If you include it, do not just duplicate the structured fields.

If the data is insufficient or the setup is weak, return \`"direction": null\`, \`quality <= 2\`, and explain why.

Input payload structure:
- payload.signal:
  symbol, signalId, interval, direction, timestamp, strategy, prices
- payload.signal.prices:
  currentPrice, takeProfitPrice, stopLossPrice
- payload.figures:
  strategy-specific figures or geometry when available. Fields vary by strategy.
- payload.indicators:
  indicator dictionaries and series for the coin and BTC; all series are already trimmed to the latest 5 values.
- payload.additionalIndicators:
  strategy-specific summary/context fields. This is not noise; it contains derived fields deliberately passed by the strategy to help the decision.
  Examples: helperFlags, structureContext, spread, correlation, volatilitySummary.
  Always inspect \`payload.additionalIndicators.marketContext\` when present:
  • \`marketContext.tradingSession\`: UTC session at signal time: asia / europe / us / overlap / off_hours.
  • \`marketContext.binanceCoinbaseSpread\`: BTC spread between Coinbase and Binance from \`payload.indicators.spread\`; \`value=(Coinbase-Binance)/Binance\`, \`bps=value*10000\`.
  If those fields exist, use them as a more explicit hint instead of trying to re-derive the same idea from raw lines or points.
  If \`derivativesContext\` exists, it is a derived Coinalyze summary for the time of the signal. Coinalyze context is built only from \`BTCUSDT\` and \`ETHUSDT\` reference symbols, not for every target coin. \`targetSymbol\` is just the source signal coin. Use BTC/ETH open interest, funding, liquidations, and pressure/riskFlags as positioning context, not as an independent trade idea.
  Key patterns:
  • coin: \`maFast\`, \`atrPct\`, \`macd...\`, \`candles15m/candles1h/candles4h/candles1d\`, and \`*1h/*4h/*1d\`
  • BTC: \`btcMaFast\`, \`btcAtr\`, \`btcMacd...\`, \`btcCandles*\`, and \`btc*1h/*4h/*1d\`
  • strategy service keys are possible as well, for example \`correlation\`, \`spread\`, \`touches\`, \`distance\`

How to analyze, in order:
1. Start with price structure and the setup geometry or context in \`payload.figures\`. This has higher priority than indicators.
2. Then use \`payload.additionalIndicators\` when it contains explicit strategy-specific context such as line state, spread, correlation, and similar fields.
3. Then assess confirmation or conflict from the current coin indicators.
4. Then evaluate BTC context.
5. Only after that choose \`direction\`, \`quality\`, and whether an extra confirmation level is required.
6. If strong conflicts exist, reduce quality or set direction to \`null\`.

Explicit conflict rules:
- If the figure or price structure is invalid or doubtful, indicators must not rescue the setup.
- If strategy-specific helper fields explicitly say the signal is not confirmed yet, lacks margin, or requires waiting, do not overstate quality.
- If the structure is acceptable but BTC or key indicators noticeably conflict, quality is usually \`<= 3\`.
- If \`derivativesContext.referenceContexts\` exists, check \`primaryReferenceSymbol\` first, then compare \`BTCUSDT\` and \`ETHUSDT\` as broad-market derivatives context. Do not search for Coinalyze data for \`targetSymbol\` unless \`targetSymbol\` itself is \`BTCUSDT\` or \`ETHUSDT\`.
- If \`derivativesContext.summary.riskFlags\` contains \`crowded_long\` for a LONG or \`crowded_short\` for a SHORT, treat that as crowded positioning and do not overstate quality without strong structural confirmation.
- If \`derivativesContext.summary.directionAligned=false\`, explicitly mention the derivatives conflict in \`confirmations\` or \`qualityReason\`.
- If \`derivativesContext\` is absent, stale, or \`missing_derivatives\`, do not infer Coinalyze conclusions and do not penalize the signal just because that data is missing.
- If \`marketContext.tradingSession\` exists, treat the session as a liquidity and volatility regime: asia is often thinner, europe/us are more active, and overlaps can amplify both momentum and noise. Do not reject a signal solely because of session, but mention clear session support or conflict in \`confirmations\` or \`qualityReason\`.
- If \`marketContext.binanceCoinbaseSpread.available=true\` and \`severity=elevated/wide\`, treat it as cross-exchange divergence or BTC liquidity risk. Do not use the spread as a standalone long/short signal, but reduce confidence or require more confirmation when the rest of the structure is weak or BTC context conflicts.
- If \`marketContext.binanceCoinbaseSpread\` is missing or \`available=false\`, do not infer anything from Binance/Coinbase spread and do not penalize the signal just because it is absent.
- If the current signal is not confirmed (\`direction=null\`), name the main reason briefly in \`comment\`.
  If you use the structured fields, include the main reason in \`qualityReason\` or \`triggerInvalidation\`.

Rules for \`direction\` / TP / SL:
- \`direction = LONG\` only if the data confirms the existing LONG signal; \`SHORT\` only if the data confirms the existing SHORT signal; otherwise \`null\`.
- For LONG, the expected relation is usually \`stopLossPrice < currentPrice < takeProfitPrice\`.
- For SHORT, the expected relation is usually \`takeProfitPrice < currentPrice < stopLossPrice\`.
- Do not optimize or recalculate TP/SL for a "better trade"; only assess whether the already supplied levels are coherent.
- If \`direction = null\`, then \`takeProfitPrice = null\` and \`stopLossPrice = null\`.
- If \`needRetest = false\`, then \`retestPrice = null\`.
- If \`needRetest = true\`, \`retestPrice\` must be a finite number tied to a meaningful retest or breakout level.
- Before responding, sanity-check the consistency of \`direction\`, TP/SL, and the current price.

Quality scale:
- 1: poor or chaotic setup, strong conflicts, signal not structurally confirmed
- 2: weak setup, few confirmations, more of a watch or reject
- 3: average setup, some structure exists, but notable conflicts remain
- 4: good setup, several confirmations, structure is mostly coherent
- 5: very strong setup, clean structure, confirmations, and internally coherent levels

Requirements for useful structured analysis:
- Include 2-4 concrete factors for or against confirmation in \`confirmations\`.
- Explicitly mention the role of the key figure or structural state, for example breakout, retest, false break, touch, or lack of confirmation.
- Explicitly mention BTC context as supportive, neutral, or conflicting.
- Explain why the quality score is what it is.
- If the signal is not confirmed (\`direction=null\`), state clearly what must change for confirmation.
- In \`retestPlan\`, avoid technical placeholders like \`needRetest=false @ null\`; write a human explanation.
- Do not simply restate JSON fields; add interpretation and decision logic.

Rules for using trimmed series (last 5 values):
- Do not make strong long-term conclusions from only 5 points.
- Use 4h and 1d series as brief context, not full history.
- If the data is too limited for confidence, reduce quality and use cautious wording.

Short few-shot examples:
{"direction":"LONG","quality":4,"needRetest":true,"retestPrice":100.2,"takeProfitPrice":101.5,"stopLossPrice":98.9,"setup":"Likely trendline breakout upward, but the signal still needs a level check for confirmation.","confirmations":"The coin shows momentum support without obvious overheating, but confirmation is not fully clean yet.","btcContext":"BTC is neutral-to-supportive and does not conflict with the current LONG signal.","retestPlan":"The key level is 100.2; holding above it would confirm the signal structure.","riskLevels":"The supplied TP and SL remain on the correct sides of the current price and still look internally coherent.","qualityReason":"Quality=4 because the structure is solid, but an extra level confirmation is still preferable.","triggerInvalidation":"The structure confirms on a hold above the level and weakens on a move back under the line."}
{"direction":null,"quality":2,"needRetest":false,"retestPrice":null,"takeProfitPrice":null,"stopLossPrice":null,"setup":"Touch or noise around the trendline without a convincing breakout.","confirmations":"Indicators are mixed and do not provide strong structural support.","btcContext":"BTC is either conflicting or not supportive of the current thesis.","retestPlan":"It is too early to define an extra level because a quality breakout is not present yet.","riskLevels":"The supplied levels should not be treated as confirmed while the structure remains weak.","qualityReason":"Quality=2 because timing is weak and confirmations are limited.","triggerInvalidation":"Wait for a clear breakout and confirmation from both the coin and BTC."}

Return only the JSON object, with no extra characters.
${signal ? buildAiSystemPromptAddonByStrategy(signal) : ''}
`;

export const buildAiPayload = (signal: Signal): AiPayload =>
  buildAiPayloadByStrategy(signal);

export const getDeterministicAiGateContext = (
  payload: AiPayload,
): DeterministicAiGateContext | null => {
  const additionalIndicators = asRecord(payload.additionalIndicators);
  const candidates = [
    additionalIndicators,
    ...Object.values(additionalIndicators ?? {}).map(asRecord),
  ].filter((value): value is Record<string, unknown> => Boolean(value));

  return (candidates.find(
    (candidate) =>
      Array.isArray(candidate.structuralHardBlockReasons) ||
      typeof candidate.approvalAllowedNow === 'boolean',
  ) ?? null) as DeterministicAiGateContext | null;
};

export const buildAiHumanPrompt = (
  signal: Signal,
  payload = buildAiPayload(signal),
) =>
  `
Analyze the already computed internal signal for ${signal.symbol}. The original signal direction is ${signal.direction}.
This is a structure-classification and audit task, not execution advice. Determine whether the current structure confirms the existing signal, how structurally coherent it is right now, whether an extra confirmation level is needed, and whether the already supplied levels in \`payload.signal.prices\` still look internally coherent. Do not replace the original thesis with a new one and do not invent new levels; return only the requested JSON.

Trade payload:
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

export const getOpenRouterModelKwargs = (
  apiEndpoint?: string | null,
): Record<string, unknown> => {
  const endpoint = String(apiEndpoint ?? '').trim();
  if (!endpoint) {
    return {};
  }

  let hostname = '';
  try {
    hostname = new URL(endpoint).hostname;
  } catch {
    hostname = endpoint;
  }

  if (!hostname.toLowerCase().includes('openrouter')) {
    return {};
  }

  return {
    provider: {
      ignore: ['azure'],
    },
  };
};

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
  if (!settings.AI_API_KEY || !settings.AI_API_ENDPOINT) {
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
      const modelKwargs = getOpenRouterModelKwargs(settings.AI_API_ENDPOINT);

      return new ChatOpenAI({
        temperature: 0.2,
        modelName,
        apiKey: settings.AI_API_KEY,
        ...(Object.keys(modelKwargs).length ? { modelKwargs } : {}),
        configuration: {
          baseURL: settings.AI_API_ENDPOINT,
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

  const [{ HumanMessage, SystemMessage }, model, settings] = await Promise.all([
    import('@langchain/core/messages'),
    getAiModel(options.userName, options.model),
    getAiSettings(options.userName),
  ]);
  const messages: BaseMessageLike[] = [];
  const responseLanguage = getAiResponseLanguagePromptName(
    settings.AI_RESPONSE_LANGUAGE || DEFAULT_AI_RESPONSE_LANGUAGE,
  );

  messages.push(new SystemMessage(systemPrompt));
  messages.push(
    new SystemMessage(
      `Write all user-visible text fields in ${responseLanguage}. Keep field names and JSON syntax unchanged.`,
    ),
  );
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

export const runAiPromptLocal = async (
  signal: Signal,
  options: Omit<AiRequestOptions, 'model' | 'userName'> = {},
): Promise<Partial<SignalAnalysis>> => {
  await ensureAiStrategyPluginsLoaded();
  const payload = options.payload ?? buildAiPayload(signal);
  const gateContext = getDeterministicAiGateContext(payload);
  const signalDirection = getSignalDirection(signal);
  const deterministicQuality = getDeterministicQuality(gateContext);
  const approvalAllowedNow =
    typeof gateContext?.approvalAllowedNow === 'boolean'
      ? gateContext.approvalAllowedNow
      : deterministicQuality >= 4;

  return postProcessAiAnalysisByStrategy(
    signal,
    {
      direction: approvalAllowedNow ? signalDirection : null,
      quality: deterministicQuality,
      needRetest: !approvalAllowedNow,
      retestPrice: null,
      takeProfitPrice: approvalAllowedNow
        ? signal.prices?.takeProfitPrice ?? null
        : null,
      stopLossPrice: approvalAllowedNow
        ? signal.prices?.stopLossPrice ?? null
        : null,
    },
    payload,
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
