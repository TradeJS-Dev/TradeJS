type FetchWithRetryOptions = RequestInit & {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseRetryAfterMs = (value: string | null) => {
  if (!value) return 0;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return 0;
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

  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url, fetchOptions);
      if (response.ok) {
        return response;
      }

      const shouldRetry = response.status === 429 || response.status >= 500;
      if (!shouldRetry || i === attempts - 1) {
        return response;
      }

      const retryAfterMs = parseRetryAfterMs(
        response.headers.get('retry-after'),
      );
      const backoffMs = Math.min(maxDelayMs, baseDelayMs * 2 ** i);
      await sleep(Math.max(retryAfterMs, backoffMs));
    } catch (error) {
      lastError = error;
      if (i === attempts - 1) {
        throw error;
      }
      const backoffMs = Math.min(maxDelayMs, baseDelayMs * 2 ** i);
      await sleep(backoffMs);
    }
  }

  if (lastError) {
    throw lastError;
  }

  return fetch(url, fetchOptions);
};
