import { execFile } from 'node:child_process';
import { mcpStorage } from '@tradejs/infra/redis';
import {
  drainDataBackfillQueue,
  enqueueDataBackfill,
  listDataBackfillJobs,
} from '../dataBackfillQueue';

jest.mock('node:fs', () => ({ existsSync: () => true }));
jest.mock('node:child_process', () => ({ execFile: jest.fn() }));
jest.mock('@tradejs/infra/redis', () => ({
  mcpStorage: { get: jest.fn(), put: jest.fn(), compare: jest.fn() },
}));
jest.mock('../dataCoverageCache', () => ({
  invalidateDataCoverage: jest.fn(),
}));

const day = Date.UTC(2026, 0, 1);
const request = { dataset: 'binance-candles-15m', series: 'BTCUSDT', day };

beforeEach(() => {
  let state: unknown = null;
  jest.mocked(mcpStorage.get).mockImplementation(async () => state as never);
  jest.mocked(mcpStorage.put).mockImplementation(async (_key, value) => {
    if (state !== null) return false;
    state = value;
    return true;
  });
  jest
    .mocked(mcpStorage.compare)
    .mockImplementation(async (_key, previous, next) => {
      if (previous !== state) return false;
      state = next;
      return true;
    });
});

it('deduplicates a gap and lets only one worker run it, preserving a partial result for retry', async () => {
  const [a, b] = await Promise.all([
    enqueueDataBackfill('root', request),
    enqueueDataBackfill('root', request),
  ]);
  expect(a.id).toEqual(b.id);
  jest.mocked(execFile).mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as (
      error: null,
      stdout: string,
      stderr: string,
    ) => void;
    callback(
      null,
      'TRADEJS_DATA_BACKFILL {"loaded":95,"added":1,"missing":1}\n',
      '',
    );
    return {} as ReturnType<typeof execFile>;
  });
  await Promise.all([
    drainDataBackfillQueue('root'),
    drainDataBackfillQueue('root'),
  ]);
  expect(execFile).toHaveBeenCalledTimes(1);
  expect(await listDataBackfillJobs('root')).toMatchObject([
    { id: a.id, status: 'partial', result: { missing: 1, added: 1 } },
  ]);
  await enqueueDataBackfill('root', request);
  expect(await listDataBackfillJobs('root')).toMatchObject([
    { id: a.id, status: 'queued' },
  ]);
});

it('reopens a completed current-day repair after the closed-data horizon advances', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(day + 3_600_000);
  try {
    const first = await enqueueDataBackfill('root', request);
    jest.mocked(execFile).mockImplementation((...args: unknown[]) => {
      (args.at(-1) as Function)(
        null,
        'TRADEJS_DATA_BACKFILL {"loaded":1,"added":1,"missing":0}\n',
        '',
      );
      return {} as ReturnType<typeof execFile>;
    });
    await drainDataBackfillQueue('root');
    expect(await enqueueDataBackfill('root', request)).toMatchObject({
      id: first.id,
      status: 'completed',
    });
    now.mockReturnValue(day + 3_660_000);
    expect(await enqueueDataBackfill('root', request)).toMatchObject({
      id: first.id,
      status: 'queued',
    });
  } finally {
    now.mockRestore();
  }
});
