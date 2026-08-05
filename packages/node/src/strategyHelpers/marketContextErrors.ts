const MARKET_CONTEXT_CANCELLATION_ERROR_NAMES = new Set([
  'AbortError',
  'TimescaleQueryTimeoutError',
]);

export const isMarketContextCancellationError = (
  error: unknown,
  abortSignal?: AbortSignal,
) =>
  abortSignal?.aborted === true ||
  (error instanceof Error &&
    MARKET_CONTEXT_CANCELLATION_ERROR_NAMES.has(error.name));
