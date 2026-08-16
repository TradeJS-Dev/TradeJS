import type { BaseMessageLike } from '@langchain/core/messages';
import { normalizeAiEndpoint } from '@tradejs/core/aiEndpoints';
import { normalizeAiModel } from '@tradejs/core/aiModels';
import { normalizeAiResponseLanguage } from '@tradejs/core/aiLanguages';
import {
  getUserSettings,
  type UserSettings,
} from '@tradejs/infra/userSettings';

type AiModel = {
  invoke: (messages: BaseMessageLike[]) => Promise<{ content: unknown }>;
};

export interface AiChatMessage {
  role: 'system' | 'user';
  content: string;
  format?: 'plain' | 'text-block';
}

export interface InvokeAiChatOptions {
  messages: AiChatMessage[];
  userName?: string;
  model?: string;
  temperature?: number;
}

export const DEFAULT_AI_MODEL = 'openai/gpt-5-mini';

const userSettingsCache = new Map<string, Promise<UserSettings>>();
const aiModelCache = new Map<string, Promise<AiModel>>();

const normalizeResponseContent = (content: unknown): string | object => {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part: { text?: unknown }) =>
        typeof part?.text === 'string' ? part.text : '',
      )
      .join('\n')
      .trim();
  }
  return String(content ?? '');
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

const getAiModelCacheKey = (
  userName: string,
  modelName: string,
  temperature: number,
) => `${userName}::${modelName}::${temperature}`;

const resolveAiModelName = (
  settings: UserSettings,
  requestedModelName?: string,
) => {
  const explicitModelName = requestedModelName?.trim() ?? '';
  if (explicitModelName) return explicitModelName;
  return settings.AI_MODEL?.trim() || DEFAULT_AI_MODEL;
};

export const getOpenRouterModelKwargs = (
  apiEndpoint?: string | null,
): Record<string, unknown> => {
  const endpoint = String(apiEndpoint ?? '').trim();
  if (!endpoint) return {};
  let hostname = '';
  try {
    hostname = new URL(endpoint).hostname;
  } catch {
    hostname = endpoint;
  }
  return hostname.toLowerCase().includes('openrouter')
    ? { provider: { ignore: ['azure'] } }
    : {};
};

export const getAiUserSettings = async (userName = 'root') => {
  let settingsPromise = userSettingsCache.get(userName);
  if (!settingsPromise) {
    settingsPromise = getUserSettings(userName).then((settings) => {
      const endpoint = normalizeAiEndpoint(settings.AI_API_ENDPOINT);
      return {
        ...settings,
        AI_API_ENDPOINT: endpoint,
        AI_MODEL: normalizeAiModel(settings.AI_MODEL, endpoint),
        AI_RESPONSE_LANGUAGE: normalizeAiResponseLanguage(
          settings.AI_RESPONSE_LANGUAGE,
        ),
      };
    });
    settingsPromise.catch(() => userSettingsCache.delete(userName));
    userSettingsCache.set(userName, settingsPromise);
  }
  const settings = await settingsPromise;
  if (!settings.AI_API_KEY || !settings.AI_API_ENDPOINT) {
    throw new Error(`AI settings are incomplete for user ${userName}`);
  }
  return settings;
};

const getAiModel = async (
  userName = 'root',
  requestedModelName?: string,
  temperature = 0.2,
) => {
  const settings = await getAiUserSettings(userName);
  const modelName = resolveAiModelName(settings, requestedModelName);
  const cacheKey = getAiModelCacheKey(userName, modelName, temperature);
  let modelPromise = aiModelCache.get(cacheKey);
  if (!modelPromise) {
    modelPromise = import('@langchain/openai').then(({ ChatOpenAI }) => {
      const modelKwargs = getOpenRouterModelKwargs(settings.AI_API_ENDPOINT);
      return new ChatOpenAI({
        temperature,
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
    });
    modelPromise.catch(() => aiModelCache.delete(cacheKey));
    aiModelCache.set(cacheKey, modelPromise);
  }
  try {
    return await modelPromise;
  } catch (error) {
    aiModelCache.delete(cacheKey);
    userSettingsCache.delete(userName);
    throw error;
  }
};

export const resetAiRuntimeCache = () => {
  aiModelCache.clear();
  userSettingsCache.clear();
};

export const invokeAiChat = async ({
  messages,
  userName = 'root',
  model,
  temperature = 0.2,
}: InvokeAiChatOptions): Promise<{ content: string | object }> => {
  const [{ HumanMessage, SystemMessage }, aiModel] = await Promise.all([
    import('@langchain/core/messages'),
    getAiModel(userName, model, temperature),
  ]);
  const providerMessages: BaseMessageLike[] = messages.map((message) =>
    message.role === 'system'
      ? new SystemMessage(message.content)
      : new HumanMessage(
          message.format === 'text-block'
            ? {
                content: [{ type: 'text', text: message.content }],
              }
            : message.content,
        ),
  );
  try {
    const response = await aiModel.invoke(providerMessages);
    const content = normalizeResponseContent(response?.content);
    if (isEmptyResponseContent(content)) {
      throw new Error('AI provider returned an empty chat completion');
    }
    return { content };
  } catch (error) {
    throw getAiInvocationError(error);
  }
};
