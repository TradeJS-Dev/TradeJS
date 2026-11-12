import { z } from 'zod';
import { cliBacktestRunStorage } from '@tradejs/infra/redis';
import type { CliBacktestRun } from '@tradejs/types';
import type { BacktestJobRecord } from './backtestJobContracts';

const cliRunSchema = z.object({
  id: z.string(),
  userName: z.string(),
  strategyName: z.string(),
  configId: z.string(),
  connector: z.string(),
  interval: z.string(),
  startTime: z.number().min(0).max(8.64e15),
  endTime: z.number().min(0).max(8.64e15),
  symbols: z.array(z.string()),
  settings: z.record(
    z.string(),
    z.union([z.boolean(), z.number(), z.string()]),
  ),
  parameters: z.array(
    z.object({
      name: z.string(),
      values: z.array(z.string()),
      truncated: z.boolean(),
    }),
  ),
  status: z.enum(['running', 'completed', 'cancelled', 'failed']),
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  startedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<CliBacktestRun>;

export const listCliBacktestRuns = async (
  userName: string,
): Promise<BacktestJobRecord[]> => {
  const runs = await cliBacktestRunStorage.list(userName);
  return runs.flatMap((value) => {
    const parsed = cliRunSchema.safeParse(value);
    if (!parsed.success) return [];
    const run = parsed.data;
    if (
      run.userName !== userName ||
      run.startTime >= run.endTime ||
      run.completed > run.total
    ) {
      return [];
    }

    return [
      {
        id: run.id,
        userName,
        status: run.status,
        request: {
          strategyName: run.strategyName,
          configId: run.configId,
          periodMode: 'range',
          startTime: run.startTime,
          endTime: run.endTime,
          ai: run.settings.ai === true,
          fast: run.settings.fast === true,
          interval: run.interval,
          connector: run.connector,
        },
        cli: {
          symbols: run.symbols,
          settings: run.settings,
          parameters: run.parameters,
        },
        command: 'tradejs',
        args: [],
        createdAt: run.startedAt,
        startedAt: run.startedAt,
        updatedAt: run.updatedAt,
        runCount: 1,
        logs: [],
        progress: {
          completed: run.completed,
          total: run.total,
          percent: (run.completed / run.total) * 100,
          averageProfit: null,
          winRate: null,
          successTests: null,
          errorTests: null,
        },
      } satisfies BacktestJobRecord,
    ];
  });
};
