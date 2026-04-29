export type AiEndpointOption = {
  label: string;
  value: string;
};

export const AI_ENDPOINT_OPTIONS: AiEndpointOption[] = [
  {
    label: 'OpenAI',
    value: 'https://api.openai.com/v1',
  },
  {
    label: 'OpenRouter',
    value: 'https://openrouter.ai/api/v1',
  },
  {
    label: 'Together AI',
    value: 'https://api.together.xyz/v1',
  },
  {
    label: 'Groq',
    value: 'https://api.groq.com/openai/v1',
  },
  {
    label: 'DeepInfra',
    value: 'https://api.deepinfra.com/v1/openai',
  },
];

const KNOWN_AI_ENDPOINTS = new Set(
  AI_ENDPOINT_OPTIONS.map((option) => option.value),
);

export const normalizeAiEndpoint = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  return KNOWN_AI_ENDPOINTS.has(trimmed) ? trimmed : '';
};

export const isKnownAiEndpoint = (value: unknown): value is string =>
  normalizeAiEndpoint(value).length > 0;
