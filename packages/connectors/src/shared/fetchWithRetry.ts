export type FetchWithRetryOptions = RequestInit & {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseRetryAfterMs = (value: string | null) => {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
};

export const fetchWithRetry = async (
  url: string,
  options: FetchWithRetryOptions = {},
) => {
  const {
    attempts = 5,
    baseDelayMs = 300,
    maxDelayMs = 5_000,
    ...fetchOptions
  } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, fetchOptions);
      if (response.ok) return response;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === attempts - 1) return response;
      const retryAfterMs = parseRetryAfterMs(
        response.headers.get('retry-after'),
      );
      await sleep(
        Math.max(
          retryAfterMs,
          Math.min(maxDelayMs, baseDelayMs * 2 ** attempt),
        ),
      );
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
      await sleep(Math.min(maxDelayMs, baseDelayMs * 2 ** attempt));
    }
  }

  if (lastError) throw lastError;
  return fetch(url, fetchOptions);
};
