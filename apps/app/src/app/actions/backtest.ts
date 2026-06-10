import { API } from '@tradejs/core/api';
import { Item, OrderLogData, TestResult } from '@tradejs/types';
import type {
  BacktestConfigSummary,
  BacktestJobRecord,
  BacktestJobRequest,
} from '#app/lib/backtestJobs';

const API_BASE = '/api/backtest';

export const getBacktestFiles = async (): Promise<Item[]> => {
  const data = await API.get<{ items?: Item[] }>(`${API_BASE}/files`);

  return data.items ?? [];
};

export const getOrderLog = async (
  name: string | undefined,
  strategyName: string | undefined,
): Promise<OrderLogData | null> => {
  if (!name || !strategyName) {
    return null;
  }

  const data = await API.get<{ orderLog?: OrderLogData }>(
    `${API_BASE}/order-log/${strategyName}/${name}`,
  );

  return data.orderLog ?? null;
};

export const getBacktest = async (
  name: string | undefined,
  strategyName: string | undefined,
): Promise<TestResult | null> => {
  if (!name || !strategyName) {
    return null;
  }

  const data = await API.get<{ result?: TestResult }>(
    `${API_BASE}/result/${strategyName}/${name}`,
  );

  return data.result ?? null;
};

export const deleteBacktest = async (
  name: string | undefined,
  strategyName: string | undefined,
): Promise<boolean> => {
  if (!name || !strategyName) {
    return false;
  }

  const data = await API.delete<{ deleted?: boolean }>(
    `${API_BASE}/test/${encodeURIComponent(strategyName)}/${encodeURIComponent(name)}`,
  );

  return data.deleted === true;
};

export const getBacktestRunConfigs = async (): Promise<
  BacktestConfigSummary[]
> => {
  const data = await API.get<{ configs?: BacktestConfigSummary[] }>(
    `${API_BASE}/configs`,
  );

  return data.configs ?? [];
};

export const getBacktestRuns = async (): Promise<BacktestJobRecord[]> => {
  const data = await API.get<{ jobs?: BacktestJobRecord[] }>(
    `${API_BASE}/runs`,
  );

  return data.jobs ?? [];
};

export const startBacktestRun = async (
  request: Partial<BacktestJobRequest>,
): Promise<BacktestJobRecord> => {
  const data = await API.post<{ job: BacktestJobRecord }>(
    `${API_BASE}/runs`,
    request,
  );

  return data.job;
};

export const controlBacktestRun = async (
  jobId: string,
  action: 'pause' | 'stop' | 'resume' | 'cancel' | 'heartbeat',
): Promise<BacktestJobRecord> => {
  const data = await API.post<{ job: BacktestJobRecord }>(
    `${API_BASE}/runs/${encodeURIComponent(jobId)}`,
    { action },
  );

  return data.job;
};

export const deleteBacktestRun = async (jobId: string): Promise<boolean> => {
  const data = await API.delete<{ deleted?: boolean }>(
    `${API_BASE}/runs/${encodeURIComponent(jobId)}`,
  );

  return data.deleted === true;
};
