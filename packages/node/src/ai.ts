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
export {
  buildCompactAiIndicatorsSnapshot,
  MAX_AI_SERIES_POINTS,
  trimSeriesDeep,
} from './aiShared';

type DeterministicAiGateContext = {
  approvalAllowedNow?: boolean;
  deterministicQuality?: number;
  maxAllowedQuality?: number;
  approvalBlockReasons?: string[];
  riskAnnotations?: string[];
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

  return (Array.isArray(gateContext?.approvalBlockReasons) &&
    gateContext.approvalBlockReasons.length > 0) ||
    (Array.isArray(gateContext?.structuralHardBlockReasons) &&
      gateContext.structuralHardBlockReasons.length > 0)
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
  historical indicator dictionaries and series for the coin and BTC; all series are already trimmed to the latest 5 values. Treat this block as recent-history transport, not as the primary source of the current shared context.
- payload.additionalIndicators:
  strategy-specific summary/context fields plus the canonical current shared context snapshot.
  This is not noise; it contains derived fields deliberately passed by the strategy to help the decision.
  Examples: baseContext, helperFlags, structureContext, volatilitySummary.
  Always inspect \`payload.additionalIndicators.baseContext\` first for the current shared state:
  • \`baseContext.raw\`: current MA, ATR, BB, OBV, price stats, levels, BTC correlation.
  • \`baseContext.regime\`: derived trend / volatility / momentum / session regime fields.
  • \`baseContext.structure\`: local range position, breakout freshness/quality, level-touch counts, rejection wick context.
  • \`baseContext.participation\`: volume/turnover participation, effort-vs-result context, and Binance aggTrades trade-flow when available.
  • \`baseContext.relative\`: BTC/ETH relative-strength, benchmark MA bias context, Binance alt-basket breadth, and CoinMarketCap historical global/exchange/index context when available.
  • \`baseContext.derivatives\`: Coinalyze-aligned derivatives summary when available.
  • \`baseContext.mtf\`: compact multi-timeframe summary plus only the latest few candles for each timeframe.
  • \`baseContext.gateFeatures\`: direction-aware, normalized fields derived from baseContext; prefer \`setup\`, \`scores\`, \`confirmations\`, \`conflicts\`, \`risk\`, and \`decisionHints\` for quick gate checks before inspecting raw nested context.
  Always inspect \`payload.additionalIndicators.marketContext\` when present:
  • \`marketContext.execution.binanceCoinbaseSpread\`: AI-friendly BTC spread view projected from \`payload.additionalIndicators.baseContext.relative.execution.venueSpread\`; \`value=(Coinbase-Binance)/Binance\`, \`bps=value*10000\`.
  • \`marketContext.participation.trueDelta\`: Binance taker buy/sell volume delta from kline payload when \`source=kline_taker_volume\`; otherwise absent/unavailable.
  • \`marketContext.participation.tradeFlow\`: Binance aggTrades buy/sell pressure buckets when available.
  • \`marketContext.relative.marketBreadths.top5|top10|top30|top50|top100\`: equal/volume-weighted alt-basket return, advance/decline ratio, and MA breadth for the five versioned Binance breadth universes. \`marketBreadth\` remains the top30 primary view used by existing gates.
  • \`marketContext.relative.targetVsBtc\`: target/BTC ratio returns, alpha, beta, and short-window correlation; use it to decide whether the target is leading or lagging BTC in the signal direction.
  • \`marketContext.relative.btcAltRegime\`: Binance-derived BTC-vs-alt basket regime, BTC/alt 24h returns, BTC turnover share, and alt dispersion; use it as a broad alt-market risk pocket.
  • \`marketContext.relative.cmcGlobal\`: historical CoinMarketCap global market metrics: total/alt market cap, total/alt volume, BTC/ETH dominance and 24h changes, active markets, \`interval\`, and \`altLiquidityRegime\`.
  • \`marketContext.relative.cmcReferenceAssets\`: historical CoinMarketCap BTC/ETH market-cap and volume context, ETH/BTC market-cap ratio, ETH-vs-BTC volume ratio, \`interval\`, and \`referenceLiquidityRegime\`.
  • \`marketContext.relative.cmcExchangeLiquidity\`: historical CoinMarketCap major-exchange liquidity aggregate: total volume, 24h volume change, Binance share, concentration, and \`liquidityRegime\`.
  • \`marketContext.relative.cmcFearGreed\`: historical daily CoinMarketCap Fear & Greed sentiment index: value, classification, 24h/7d value changes, and \`sentimentRegime\`.
  • \`marketContext.relative.cmcIndexes\`: historical daily CoinMarketCap CMC100/CMC20 index values, 24h changes, top constituents, CMC20/CMC100 ratio, and \`indexRegime\`.
  • \`marketContext.relative.referenceTradeFlow\`: BTC/ETH reference trade-flow summary used for broad market pressure when the target symbol itself is not BTC/ETH.
  If those fields exist, use them as a more explicit hint instead of trying to re-derive the same idea from raw lines or points.
  If \`baseContext.derivatives\` exists, its top-level \`summary\` and \`intervals\` are the primary BTCUSDT Coinalyze benchmark context for the time of the signal. \`secondaryReferenceSymbol\` identifies the ETHUSDT secondary benchmark, and \`referenceContexts\` contains BTCUSDT/ETHUSDT plus configured extra reference symbols such as BNBUSDT/SOLUSDT/TRXUSDT/XRPUSDT. If \`targetContext\` or \`targetDerived\` exists, those fields are the Coinalyze context for the actual target coin; use them as target-specific positioning evidence, but do not infer target-coin derivatives when they are absent.
  Key patterns:
  • current shared state: prefer \`payload.additionalIndicators.baseContext\`
  • recent historical series: \`payload.indicators\`
  • strategy service keys are possible as well, for example \`touches\`, \`distance\`, timing flags, and other setup-specific summaries

How to analyze, in order:
1. Start with price structure and the setup geometry or context in \`payload.figures\`. This has higher priority than indicators.
2. Then use \`payload.additionalIndicators.baseContext\` and other explicit strategy-specific context fields.
3. Then assess confirmation or conflict from the current shared state and recent coin indicator history.
4. Then evaluate BTC context.
5. Only after that choose \`direction\`, \`quality\`, and whether an extra confirmation level is required.
6. If strong conflicts exist, reduce quality or set direction to \`null\`.

Explicit conflict rules:
- If the figure or price structure is invalid or doubtful, indicators must not rescue the setup.
- If strategy-specific helper fields explicitly say the signal is not confirmed yet, lacks margin, or requires waiting, do not overstate quality.
- If the structure is acceptable but BTC or key indicators noticeably conflict, quality is usually \`<= 3\`.
- If \`baseContext.derivatives.referenceContexts\` exists, check \`primaryReferenceSymbol\` first as the BTC benchmark, then compare \`secondaryReferenceSymbol\`/ETHUSDT and any target-specific \`targetDerived\`. If \`targetDerived\` exists, compare it to the primary reference instead of treating reference pressure as the target coin's own pressure.
- If top-level \`baseContext.derivatives.summary.riskFlags\` contains \`crowded_long\` for a LONG or \`crowded_short\` for a SHORT, treat that as broad-market crowded positioning. If \`targetDerived.riskFlags\` contains the same directional crowding, treat that as target-specific crowded positioning.
- If top-level \`baseContext.derivatives.summary.directionAligned=false\`, explicitly mention the broad-market derivatives conflict in \`confirmations\` or \`qualityReason\`. If \`targetDerived.directionAligned=false\`, explicitly mention the target-specific derivatives conflict.
- If \`baseContext.derivatives\` is absent, stale, or \`missing_derivatives\`, do not infer Coinalyze conclusions and do not penalize the signal just because that data is missing.
- Use \`baseContext.regime.session\` directly as the canonical session/liquidity regime: asia is often thinner, europe/us are more active, and overlaps can amplify both momentum and noise. Do not reject a signal solely because of session, but mention clear session support or conflict in \`confirmations\` or \`qualityReason\`.
- If \`marketContext.execution.binanceCoinbaseSpread.available=true\` and \`severity=elevated/wide\`, treat it as cross-exchange divergence or BTC liquidity risk. Do not use the spread as a standalone long/short signal, but reduce confidence or require more confirmation when the rest of the structure is weak or BTC context conflicts.
- If \`marketContext.execution.binanceCoinbaseSpread\` is missing or \`available=false\`, do not infer anything from Binance/Coinbase spread and do not penalize the signal just because it is absent.
- If \`marketContext.participation.trueDelta.available=true\`, use it as better participation evidence than OHLCV-derived proxy delta; still do not let delta override invalid price structure.
- If \`marketContext.participation.tradeFlow.available=true\` and \`stale=false\`, use it as direct lower-timeframe participation evidence. Treat stale or missing tradeFlow as absent, not as negative evidence.
- If \`marketContext.relative.marketBreadth.available=true\` and \`stale=false\`, use it as broad alt-market support/conflict. Breadth is contextual; do not let it override the target symbol structure.
- If \`marketContext.relative.targetVsBtc.available=true\`, treat positive target/BTC ratio trend as support for alt LONGs and negative ratio trend as support for alt SHORTs; ignore it when the target structure is stronger and clearly explains the setup.
- If \`marketContext.relative.btcAltRegime.available=true\` and \`stale=false\`, treat \`alt_lead\`/\`risk_on\` as broad support for alt LONGs and \`btc_lead\`/\`risk_off\` as pressure against alt LONGs or support for cautious alt SHORTs. Do not use it as a standalone entry reason.
- If \`marketContext.relative.cmcGlobal.available=true\` and \`stale=false\`, use falling alt market cap/volume or rising BTC dominance as broad risk pressure for alt LONGs. Treat missing CMC history as absent context, not a bearish signal.
- If \`marketContext.relative.cmcReferenceAssets.available=true\` and \`stale=false\`, use \`eth_led\` as broad support for ETH/high-beta alt strength and \`btc_led\`/\`thin\` as broad caution. Do not describe BTC/ETH reference history as target-symbol flow.
- If \`marketContext.relative.cmcExchangeLiquidity.available=true\` and \`stale=false\`, treat \`contracting\`, \`thin\`, or \`concentrated\` as broad liquidity risk; \`expanding\` or \`balanced\` supports cleaner execution context but is not a standalone entry reason.
- If \`marketContext.relative.cmcFearGreed.available=true\` and \`stale=false\`, use \`risk_on\` as broad support for LONGs and \`risk_off\`/\`capitulation\` as broad pressure. Treat \`euphoric\` as overheating/chase caution, not as standalone SHORT proof.
- If \`marketContext.relative.cmcIndexes.available=true\` and \`stale=false\`, use \`top20_led\` as broad support for mega-cap leadership, \`large_cap_led\` as broader CMC100 participation, and \`risk_off\` as broad pressure. Do not use CMC index history as a standalone entry reason.
- If \`marketContext.relative.referenceTradeFlow.available=true\`, treat BTC/ETH trade-flow as broad market context only. For alt symbols, do not describe it as the target coin's own flow.
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
      Array.isArray(candidate.approvalBlockReasons) ||
      Array.isArray(candidate.riskAnnotations) ||
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

const getAiInvocationError = (error: unknown) => {
  const details =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : String(error);
  const isEmptyCompletion =
    error instanceof TypeError &&
    /Cannot read properties of undefined \(reading ['"]message['"]\)/.test(
      details,
    );
  const wrapped = new Error(
    isEmptyCompletion
      ? 'AI provider returned an empty chat completion'
      : `AI model invocation failed: ${details}`,
  ) as Error & { cause?: unknown };
  wrapped.cause = error;
  return wrapped;
};

const isEmptyResponseContent = (content: string | object) =>
  typeof content === 'string'
    ? content.trim().length === 0
    : Object.keys(content).length === 0;

export const DEFAULT_AI_MODEL = 'openai/gpt-5-mini';

const userSettingsCache = new Map<string, Promise<UserSettings>>();
const aiModelCache = new Map<string, Promise<AiModel>>();

const getAiModelCacheKey = (userName: string, modelName: string) =>
  `${userName}::${modelName}`;

const resolveAiModelName = (
  settings: UserSettings,
  requestedModelName?: string,
) => {
  const explicitModelName =
    typeof requestedModelName === 'string' ? requestedModelName.trim() : '';

  if (explicitModelName) {
    return explicitModelName;
  }

  const settingsModelName =
    typeof settings.AI_MODEL === 'string' ? settings.AI_MODEL.trim() : '';

  return settingsModelName || DEFAULT_AI_MODEL;
};

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
  requestedModelName?: string,
) => {
  const settings = await getAiSettings(userName);
  const modelName = resolveAiModelName(settings, requestedModelName);
  const cacheKey = getAiModelCacheKey(userName, modelName);
  let modelPromise = aiModelCache.get(cacheKey);
  if (!modelPromise) {
    modelPromise = (async () => {
      const { ChatOpenAI } = await import('@langchain/openai');
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

const getAiModel = async (userName = 'root', requestedModelName?: string) => {
  const settings = await getAiSettings(userName);
  const resolvedModelName = resolveAiModelName(settings, requestedModelName);

  try {
    return await createAiModel(userName, resolvedModelName);
  } catch (error) {
    aiModelCache.delete(getAiModelCacheKey(userName, resolvedModelName));
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

  let response: { content: unknown };
  try {
    response = await model.invoke(messages);
  } catch (error) {
    throw getAiInvocationError(error);
  }

  const responseContent = normalizeResponseContent(response?.content);
  if (isEmptyResponseContent(responseContent)) {
    throw new Error('AI provider returned an empty chat completion');
  }

  const parsed = parseAIResponse(responseContent) as any;
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
