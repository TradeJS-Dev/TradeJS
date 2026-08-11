import type { QueryResultRow } from 'pg';
import { getPool } from './pool';

export type TimescaleMarketContextQueryOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

const resolveQueryTimeoutMs = (override?: number) => {
  if (Number.isFinite(override) && Number(override) > 0) {
    return Math.floor(Number(override));
  }
  const configured = Number(process.env.MARKET_CONTEXT_SQL_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : 30_000;
};

const createQueryError = (
  name: 'AbortError' | 'TimescaleQueryTimeoutError',
  message: string,
) => {
  const error = new Error(message);
  error.name = name;
  return error;
};

export const queryMarketContext = async <TRow extends QueryResultRow>(
  text: string,
  values: unknown[],
  options: TimescaleMarketContextQueryOptions = {},
) => {
  const client = await getPool().connect();
  const timeoutMs = resolveQueryTimeoutMs(options.timeoutMs);
  let released = false;
  let rejectCancellation: ((error: Error) => void) | undefined;
  const release = (error?: Error) => {
    if (released) return;
    released = true;
    client.release(error);
  };
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const cancel = (error: Error) => {
    release(error);
    rejectCancellation?.(error);
  };
  const onAbort = () =>
    cancel(
      createQueryError('AbortError', 'Timescale market-context query aborted'),
    );
  const timer = setTimeout(
    () =>
      cancel(
        createQueryError(
          'TimescaleQueryTimeoutError',
          `Timescale market-context query exceeded ${timeoutMs}ms`,
        ),
      ),
    timeoutMs,
  );
  timer.unref?.();
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    if (options.signal?.aborted) {
      const error = createQueryError(
        'AbortError',
        'Timescale market-context query aborted',
      );
      release(error);
      throw error;
    }
    return await Promise.race([client.query<TRow>(text, values), cancellation]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    release();
  }
};
