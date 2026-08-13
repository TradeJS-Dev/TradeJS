import { AI_CUSTOM_ENDPOINT_VALUE } from './aiEndpoints';

export type AiModelOption = {
  label: string;
  value: string;
};

export const AI_CUSTOM_MODEL_VALUE = '__custom_model__';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1';
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1';
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/openai';
const TOGETHER_ENDPOINT = 'https://api.together.xyz/v1';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1';
const XAI_ENDPOINT = 'https://api.x.ai/v1';
const QWEN_INTL_ENDPOINT =
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const QWEN_CN_ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const QWEN_US_ENDPOINT = 'https://dashscope-us.aliyuncs.com/compatible-mode/v1';
const PERPLEXITY_ENDPOINT = 'https://api.perplexity.ai';
const KIMI_ENDPOINT = 'https://api.moonshot.ai/v1';
const PROXY_API_ENDPOINT = 'https://openai.api.proxyapi.ru/v1';

const AI_MODEL_OPTIONS_BY_ENDPOINT: Record<string, AiModelOption[]> = {
  [OPENAI_ENDPOINT]: [
    { label: 'GPT-5 mini', value: 'gpt-5-mini' },
    { label: 'GPT-5', value: 'gpt-5' },
    { label: 'GPT-5.2', value: 'gpt-5.2' },
    { label: 'GPT-4.1', value: 'gpt-4.1' },
    { label: 'GPT-4o', value: 'gpt-4o' },
  ],
  [ANTHROPIC_ENDPOINT]: [
    { label: 'Claude Sonnet 4', value: 'claude-sonnet-4-20250514' },
    { label: 'Claude Opus 4.1', value: 'claude-opus-4-1-20250805' },
    { label: 'Claude Opus 4', value: 'claude-opus-4-20250514' },
    { label: 'Claude 3.7 Sonnet', value: 'claude-3-7-sonnet-20250219' },
    { label: 'Claude 3.5 Haiku', value: 'claude-3-5-haiku-20241022' },
  ],
  [OPENROUTER_ENDPOINT]: [
    { label: 'OpenAI GPT-5', value: 'openai/gpt-5' },
    { label: 'Anthropic Claude Sonnet 4', value: 'anthropic/claude-sonnet-4' },
    { label: 'Google Gemini 2.5 Pro', value: 'google/gemini-2.5-pro' },
    { label: 'OpenAI GPT-5 mini', value: 'openai/gpt-5-mini' },
    {
      label: 'DeepSeek V3.1',
      value: 'deepseek/deepseek-chat-v3.1',
    },
  ],
  [GEMINI_ENDPOINT]: [
    { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
    { label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
    { label: 'Gemini 2.5 Flash-Lite', value: 'gemini-2.5-flash-lite' },
    { label: 'Gemini 2.0 Flash', value: 'gemini-2.0-flash' },
    { label: 'Gemini 2.0 Flash-Lite', value: 'gemini-2.0-flash-lite' },
  ],
  [TOGETHER_ENDPOINT]: [
    { label: 'DeepSeek V3.1', value: 'deepseek-ai/DeepSeek-V3.1' },
    {
      label: 'Qwen3 Coder 480B',
      value: 'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8',
    },
    {
      label: 'Llama 4 Maverick',
      value: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
    },
    { label: 'DeepSeek V3', value: 'deepseek-ai/DeepSeek-V3' },
    {
      label: 'Llama 3.3 70B Turbo',
      value: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    },
  ],
  [GROQ_ENDPOINT]: [
    { label: 'GPT-OSS 120B', value: 'openai/gpt-oss-120b' },
    {
      label: 'Llama 4 Scout',
      value: 'meta-llama/llama-4-scout-17b-16e-instruct',
    },
    { label: 'Qwen3 32B', value: 'qwen/qwen3-32b' },
    { label: 'Llama 3.3 70B', value: 'llama-3.3-70b-versatile' },
    { label: 'Llama 3.1 8B Instant', value: 'llama-3.1-8b-instant' },
  ],
  [XAI_ENDPOINT]: [
    { label: 'Grok 4 Fast Reasoning', value: 'grok-4-fast-reasoning' },
    { label: 'Grok 4 Fast Non-Reasoning', value: 'grok-4-fast-non-reasoning' },
    { label: 'Grok Code Fast 1', value: 'grok-code-fast-1' },
    { label: 'Grok 4', value: 'grok-4-0709' },
    { label: 'Grok 3 Mini', value: 'grok-3-mini' },
  ],
  [QWEN_INTL_ENDPOINT]: [
    { label: 'Qwen Plus Latest', value: 'qwen-plus-latest' },
    { label: 'Qwen Turbo Latest', value: 'qwen-turbo-latest' },
    { label: 'Qwen Max Latest', value: 'qwen-max-latest' },
    { label: 'Qwen3 Coder Plus', value: 'qwen3-coder-plus' },
    { label: 'Qwen3 Coder Next', value: 'qwen3-coder-next' },
  ],
  [QWEN_CN_ENDPOINT]: [
    { label: 'Qwen Plus Latest', value: 'qwen-plus-latest' },
    { label: 'Qwen Turbo Latest', value: 'qwen-turbo-latest' },
    { label: 'Qwen Max Latest', value: 'qwen-max-latest' },
    { label: 'Qwen3 Coder Plus', value: 'qwen3-coder-plus' },
    { label: 'Qwen3 Coder Next', value: 'qwen3-coder-next' },
  ],
  [QWEN_US_ENDPOINT]: [
    { label: 'Qwen Plus Latest', value: 'qwen-plus-latest' },
    { label: 'Qwen Turbo Latest', value: 'qwen-turbo-latest' },
    { label: 'Qwen Max Latest', value: 'qwen-max-latest' },
    { label: 'Qwen3 Coder Plus', value: 'qwen3-coder-plus' },
    { label: 'Qwen3 Coder Next', value: 'qwen3-coder-next' },
  ],
  [PERPLEXITY_ENDPOINT]: [
    { label: 'Sonar Pro', value: 'sonar-pro' },
    { label: 'Sonar', value: 'sonar' },
    { label: 'Sonar Reasoning Pro', value: 'sonar-reasoning-pro' },
    { label: 'Sonar Deep Research', value: 'sonar-deep-research' },
  ],
  [KIMI_ENDPOINT]: [
    { label: 'Kimi K2.5', value: 'kimi-k2.5' },
    { label: 'Kimi K2 Thinking', value: 'kimi-k2-thinking' },
    { label: 'Kimi K2 Turbo Preview', value: 'kimi-k2-turbo-preview' },
    { label: 'Kimi K2 0905 Preview', value: 'kimi-k2-0905-preview' },
    { label: 'Kimi K2', value: 'kimi-k2' },
  ],
  [PROXY_API_ENDPOINT]: [
    {
      label: 'Anthropic Claude Sonnet 4',
      value: 'anthropic/claude-sonnet-4-20250514',
    },
    { label: 'Gemini 2.5 Flash', value: 'gemini/gemini-2.5-flash' },
    { label: 'OpenAI GPT-5 mini', value: 'openai/gpt-5-mini' },
    { label: 'OpenAI GPT-4o', value: 'openai/gpt-4o' },
    {
      label: 'OpenRouter DeepSeek Chat V3.1',
      value: 'openrouter/deepseek/deepseek-chat-v3.1',
    },
  ],
};

const DEFAULT_AI_MODEL_BY_ENDPOINT: Record<string, string> = Object.fromEntries(
  Object.entries(AI_MODEL_OPTIONS_BY_ENDPOINT).map(([endpoint, options]) => [
    endpoint,
    options[0]?.value ?? '',
  ]),
);

const normalizeModel = (value: string) => value.trim();

export const getAiModelOptionsForEndpoint = (
  endpoint: string,
): AiModelOption[] => AI_MODEL_OPTIONS_BY_ENDPOINT[endpoint] ?? [];

export const getDefaultAiModelForEndpoint = (endpoint: string): string =>
  DEFAULT_AI_MODEL_BY_ENDPOINT[endpoint] ?? '';

export const normalizeAiModel = (value: unknown, endpoint: string): string => {
  if (typeof value === 'string') {
    const trimmed = normalizeModel(value);
    if (trimmed) {
      return trimmed;
    }
  }

  return getDefaultAiModelForEndpoint(endpoint);
};

export const isKnownAiModelForEndpoint = (
  value: unknown,
  endpoint: string,
): value is string =>
  getAiModelOptionsForEndpoint(endpoint).some(
    (option) => option.value === normalizeAiModel(value, endpoint),
  );

export const hasPresetAiModelsForEndpoint = (endpoint: string) =>
  getAiModelOptionsForEndpoint(endpoint).length > 0 &&
  endpoint !== AI_CUSTOM_ENDPOINT_VALUE;
