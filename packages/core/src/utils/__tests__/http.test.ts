import { fetchWithRetry } from '@utils/http';

type MockResponse = {
  ok: boolean;
  status: number;
  headers: {
    get: (name: string) => string | null;
  };
};

const makeResponse = (
  status: number,
  retryAfter: string | null = null,
): MockResponse => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get: (name: string) =>
      name.toLowerCase() === 'retry-after' ? retryAfter : null,
  },
});

describe('fetchWithRetry', () => {
  const originalFetch = (global as any).fetch;

  afterEach(() => {
    (global as any).fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns immediately on successful response', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(makeResponse(200) as any);
    (global as any).fetch = fetchMock;

    const response = await fetchWithRetry('https://example.com', {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com', {
      method: 'POST',
    });
  });

  it('retries on 5xx with exponential backoff and succeeds', async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(500) as any)
      .mockResolvedValueOnce(makeResponse(200) as any);
    (global as any).fetch = fetchMock;

    const promise = fetchWithRetry('https://example.com', {
      attempts: 2,
      baseDelayMs: 120,
      maxDelayMs: 1000,
    });

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 120);

    await jest.advanceTimersByTimeAsync(120);
    const response = await promise;
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on 429 and prefers retry-after delay when greater than backoff', async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(429, '2') as any)
      .mockResolvedValueOnce(makeResponse(200) as any);
    (global as any).fetch = fetchMock;

    const promise = fetchWithRetry('https://example.com', {
      attempts: 2,
      baseDelayMs: 100,
      maxDelayMs: 5000,
    });

    await Promise.resolve();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);

    await jest.advanceTimersByTimeAsync(2000);
    const response = await promise;
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('parses HTTP-date retry-after value and uses it as retry delay', async () => {
    jest.useFakeTimers();
    const now = new Date('2026-03-04T10:00:00.000Z');
    jest.setSystemTime(now);
    const retryAt = new Date(now.getTime() + 2_000).toUTCString();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(429, retryAt) as any)
      .mockResolvedValueOnce(makeResponse(200) as any);
    (global as any).fetch = fetchMock;

    const promise = fetchWithRetry('https://example.com', {
      attempts: 2,
      baseDelayMs: 100,
      maxDelayMs: 5_000,
    });

    await Promise.resolve();
    const retryDelay = Number(setTimeoutSpy.mock.calls[0]?.[1] ?? 0);
    expect(retryDelay).toBeGreaterThanOrEqual(1_000);
    expect(retryDelay).toBeLessThanOrEqual(2_000);

    await jest.advanceTimersByTimeAsync(retryDelay);
    const response = await promise;
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to exponential backoff when retry-after header is invalid', async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(429, 'not-a-valid-retry-after') as any)
      .mockResolvedValueOnce(makeResponse(200) as any);
    (global as any).fetch = fetchMock;

    const promise = fetchWithRetry('https://example.com', {
      attempts: 2,
      baseDelayMs: 250,
      maxDelayMs: 5_000,
    });

    await Promise.resolve();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 250);
    await jest.advanceTimersByTimeAsync(250);

    const response = await promise;
    expect(response.status).toBe(200);
  });

  it('does not retry on non-retryable status', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(makeResponse(400) as any);
    (global as any).fetch = fetchMock;

    const response = await fetchWithRetry('https://example.com', {
      attempts: 5,
      baseDelayMs: 100,
    });

    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on fetch error and succeeds on next attempt', async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('network-1'))
      .mockResolvedValueOnce(makeResponse(200) as any);
    (global as any).fetch = fetchMock;

    const promise = fetchWithRetry('https://example.com', {
      attempts: 2,
      baseDelayMs: 50,
      maxDelayMs: 1000,
    });

    await Promise.resolve();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 50);
    await jest.advanceTimersByTimeAsync(50);

    const response = await promise;
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on fetch error when attempts is 1', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('network-final'));
    (global as any).fetch = fetchMock;

    await expect(
      fetchWithRetry('https://example.com', {
        attempts: 1,
      }),
    ).rejects.toThrow('network-final');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to final fetch path when attempts is 0', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(makeResponse(204) as any);
    (global as any).fetch = fetchMock;

    const response = await fetchWithRetry('https://example.com', {
      attempts: 0,
    });

    expect(response.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws remembered last error after loop completion for fractional attempts', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('fractional-attempt-error'));
    (global as any).fetch = fetchMock;

    const promise = fetchWithRetry('https://example.com', {
      attempts: 0.5,
      baseDelayMs: 10,
      maxDelayMs: 10,
    });
    const rejection = expect(promise).rejects.toThrow(
      'fractional-attempt-error',
    );

    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(10);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
