export type AiEndpointOption = {
  label: string;
  value: string;
};

export const AI_CUSTOM_ENDPOINT_VALUE = '__custom__';

export const AI_ENDPOINT_OPTIONS: AiEndpointOption[] = [
  {
    label: 'OpenAI',
    value: 'https://api.openai.com/v1',
  },
  {
    label: 'Claude',
    value: 'https://api.anthropic.com/v1',
  },
  {
    label: 'OpenRouter',
    value: 'https://openrouter.ai/api/v1',
  },
  {
    label: 'Gemini',
    value: 'https://generativelanguage.googleapis.com/v1beta/openai',
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
  {
    label: 'xAI',
    value: 'https://api.x.ai/v1',
  },
  {
    label: 'Qwen (DashScope Intl)',
    value: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  },
  {
    label: 'Qwen (DashScope CN)',
    value: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  {
    label: 'Qwen (DashScope US)',
    value: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
  },
  {
    label: 'Perplexity',
    value: 'https://api.perplexity.ai',
  },
  {
    label: 'Fireworks',
    value: 'https://api.fireworks.ai/inference/v1',
  },
  {
    label: 'SambaNova',
    value: 'https://api.sambanova.ai/v1',
  },
  {
    label: 'Hyperbolic',
    value: 'https://api.hyperbolic.xyz/v1',
  },
  {
    label: 'Kimi',
    value: 'https://api.moonshot.ai/v1',
  },
  {
    label: 'ProxyAPI',
    value: 'https://openai.api.proxyapi.ru/v1',
  },
  {
    label: 'Custom',
    value: AI_CUSTOM_ENDPOINT_VALUE,
  },
];

const KNOWN_AI_ENDPOINTS = new Set(
  AI_ENDPOINT_OPTIONS.map((option) => option.value).filter(
    (value) => value !== AI_CUSTOM_ENDPOINT_VALUE,
  ),
);

const normalizeUrl = (value: string) => value.replace(/\/+$/, '');

const isIpv4Address = (value: string) =>
  /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value.trim());

const parseIpv4Address = (value: string) =>
  value
    .trim()
    .split('.')
    .map((part) => Number(part));

const isPrivateIpv4Address = (value: string) => {
  if (!isIpv4Address(value)) {
    return false;
  }

  const [a, b, c, d] = parseIpv4Address(value);
  if (
    [a, b, c, d].some(
      (part) => !Number.isInteger(part) || part < 0 || part > 255,
    )
  ) {
    return false;
  }

  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
};

const isPrivateHostname = (hostname: string) => {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.lan') ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    isPrivateIpv4Address(normalized)
  );
};

const isValidAiEndpointUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !isPrivateHostname(url.hostname);
  } catch {
    return false;
  }
};

export const normalizeAiEndpoint = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = normalizeUrl(value.trim());
  if (!trimmed) {
    return '';
  }

  if (KNOWN_AI_ENDPOINTS.has(trimmed)) {
    return trimmed;
  }

  return isValidAiEndpointUrl(trimmed) ? trimmed : '';
};

export const isKnownAiEndpoint = (value: unknown): value is string =>
  KNOWN_AI_ENDPOINTS.has(normalizeAiEndpoint(value));
