'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  controlBacktestRun,
  deleteBacktestRun,
  getBacktestRunConfigs,
  getBacktestRuns,
  startBacktestRun,
} from '#actions/backtest';
import type {
  BacktestConfigSummary,
  BacktestJobRecord,
} from '#app/lib/backtestJobContracts';
import { reachYandexMetrikaGoal } from '#app/lib/yandexMetrika';
import { useTickers } from '#store';
import { toaster } from '#ui';

export type PeriodMode = 'days' | 'range';
export type JobAction = 'pause' | 'stop' | 'resume' | 'cancel' | 'heartbeat';

export interface BacktestRunForm {
  selectedStrategy: string;
  selectedConfigId: string;
  periodMode: PeriodMode;
  days: string;
  startDate: string;
  endDate: string;
  ai: boolean;
  fast: boolean;
  interval: string;
  connector: string;
  selectedTickers: string[];
  tickersLimit: string;
  testsLimit: string;
  parallel: string;
}

interface BacktestRunsState {
  configs: BacktestConfigSummary[];
  jobs: BacktestJobRecord[];
  loadingConfigs: boolean;
  loadingJobs: boolean;
  starting: boolean;
  busyAction: string;
  onboardingMode: boolean;
  form: BacktestRunForm;
}

type BacktestRunsAction =
  | { type: 'patch'; patch: Partial<BacktestRunsState> }
  | { type: 'form'; patch: Partial<BacktestRunForm> }
  | { type: 'jobs'; jobs: BacktestJobRecord[] }
  | { type: 'mergeJob'; job: BacktestJobRecord }
  | { type: 'mergeJobs'; jobs: BacktestJobRecord[] }
  | { type: 'removeJob'; jobId: string }
  | { type: 'onboarding' };

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_BACKTEST_REPORTED_KEY = 'tradejs:analytics:first-backtest-reported';
const FIRST_BACKTEST_PENDING_JOB_KEY =
  'tradejs:analytics:first-backtest-pending-job';

const toInputDate = (date: Date) => date.toISOString().slice(0, 10);

const initialState = (): BacktestRunsState => ({
  configs: [],
  jobs: [],
  loadingConfigs: false,
  loadingJobs: false,
  starting: false,
  busyAction: '',
  onboardingMode: false,
  form: {
    selectedStrategy: '',
    selectedConfigId: '',
    periodMode: 'days',
    days: '30',
    startDate: toInputDate(new Date(Date.now() - 30 * DAY_MS)),
    endDate: toInputDate(new Date()),
    ai: false,
    fast: false,
    interval: '15',
    connector: 'binance',
    selectedTickers: [],
    tickersLimit: '',
    testsLimit: '',
    parallel: '',
  },
});

const mergeJob = (
  jobs: BacktestJobRecord[],
  updated: BacktestJobRecord,
): BacktestJobRecord[] => {
  const existingIndex = jobs.findIndex((job) => job.id === updated.id);
  if (existingIndex === -1) return [updated, ...jobs];
  const nextJobs = [...jobs];
  nextJobs[existingIndex] = updated;
  return nextJobs;
};

const reducer = (
  state: BacktestRunsState,
  action: BacktestRunsAction,
): BacktestRunsState => {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch };
    case 'form':
      return { ...state, form: { ...state.form, ...action.patch } };
    case 'jobs':
      return { ...state, jobs: action.jobs };
    case 'mergeJob':
      return { ...state, jobs: mergeJob(state.jobs, action.job) };
    case 'mergeJobs':
      return {
        ...state,
        jobs: action.jobs.reduce(mergeJob, state.jobs),
      };
    case 'removeJob':
      return {
        ...state,
        jobs: state.jobs.filter((job) => job.id !== action.jobId),
      };
    case 'onboarding':
      return {
        ...state,
        onboardingMode: true,
        form: {
          ...state.form,
          days: '45',
          interval: '15',
          connector: 'binance',
          selectedTickers: ['BTCUSDT'],
          testsLimit: '1',
          parallel: '1',
        },
      };
  }
};

const dateToStartMs = (value: string) => {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const dateToEndMs = (value: string) => {
  const timestamp = Date.parse(`${value}T23:59:59.999Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const getJobTitle = (job: BacktestJobRecord) =>
  `${job.request.strategyName} / ${job.request.configId}`;

const buildStrategyItems = (configs: BacktestConfigSummary[]) =>
  [...new Set(configs.map((config) => config.strategyName))]
    .sort((left, right) => left.localeCompare(right))
    .map((strategyName) => ({ label: strategyName, value: strategyName }));

const buildConfigItems = (
  configs: BacktestConfigSummary[],
  selectedStrategy: string,
) =>
  configs
    .filter((config) => config.strategyName === selectedStrategy)
    .map((config) => ({
      label: config.id,
      value: config.id,
      description: `${config.combinationCount} combos / ${config.paramCount} params`,
    }));

export const useBacktestRunsController = () => {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const jobsRequestRef = useRef<Promise<void> | null>(null);
  const jobsErrorNotifiedRef = useRef(false);
  const jobsRef = useRef<BacktestJobRecord[]>([]);
  const { connector, selectedStrategy, selectedConfigId } = state.form;
  const { tickers: tickerItems, ensureLoaded: ensureTickersLoaded } =
    useTickers(connector, { enabled: false });

  const strategyItems = useMemo(
    () => buildStrategyItems(state.configs),
    [state.configs],
  );
  const configItems = useMemo(
    () => buildConfigItems(state.configs, selectedStrategy),
    [selectedStrategy, state.configs],
  );
  const selectedConfig = useMemo(
    () => state.configs.find((config) => config.id === selectedConfigId),
    [selectedConfigId, state.configs],
  );

  const updateForm = useCallback((patch: Partial<BacktestRunForm>) => {
    dispatch({ type: 'form', patch });
  }, []);

  const setSelectedTickers = useCallback(
    (next: string[] | ((current: string[]) => string[])) => {
      const selectedTickers =
        typeof next === 'function' ? next(state.form.selectedTickers) : next;
      dispatch({ type: 'form', patch: { selectedTickers } });
    },
    [state.form.selectedTickers],
  );

  const loadConfigs = useCallback(async () => {
    dispatch({ type: 'patch', patch: { loadingConfigs: true } });
    try {
      dispatch({
        type: 'patch',
        patch: { configs: await getBacktestRunConfigs() },
      });
    } catch (error) {
      toaster.error({
        title: 'Failed to load backtest configs',
        description: (error as Error)?.message || 'Request failed.',
      });
    } finally {
      dispatch({ type: 'patch', patch: { loadingConfigs: false } });
    }
  }, []);

  const loadJobs = useCallback((background = false) => {
    if (jobsRequestRef.current) return jobsRequestRef.current;
    const request = (async () => {
      if (!background)
        dispatch({ type: 'patch', patch: { loadingJobs: true } });
      try {
        dispatch({ type: 'jobs', jobs: await getBacktestRuns() });
        jobsErrorNotifiedRef.current = false;
      } catch (error) {
        if (!background && !jobsErrorNotifiedRef.current) {
          jobsErrorNotifiedRef.current = true;
          toaster.error({
            title: 'Failed to load backtest jobs',
            description: (error as Error)?.message || 'Request failed.',
          });
        }
      } finally {
        if (!background)
          dispatch({ type: 'patch', patch: { loadingJobs: false } });
        jobsRequestRef.current = null;
      }
    })();
    jobsRequestRef.current = request;
    return request;
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([loadConfigs(), loadJobs()]);
  }, [loadConfigs, loadJobs]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('onboarding') === '1') {
      dispatch({ type: 'onboarding' });
    }
  }, []);

  useEffect(() => {
    const next = strategyItems[0]?.value || '';
    if (!strategyItems.some((item) => item.value === selectedStrategy)) {
      updateForm({ selectedStrategy: next });
    }
  }, [selectedStrategy, strategyItems, updateForm]);

  useEffect(() => {
    const next = configItems[0]?.value || '';
    if (!configItems.some((item) => item.value === selectedConfigId)) {
      updateForm({ selectedConfigId: next });
    }
  }, [configItems, selectedConfigId, updateForm]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadJobs(true), 3_000);
    return () => window.clearInterval(timer);
  }, [loadJobs]);

  useEffect(() => {
    jobsRef.current = state.jobs;
  }, [state.jobs]);

  useEffect(() => {
    if (window.localStorage.getItem(FIRST_BACKTEST_REPORTED_KEY) === '1')
      return;
    const pendingJobId = window.localStorage.getItem(
      FIRST_BACKTEST_PENDING_JOB_KEY,
    );
    if (!pendingJobId) return;
    const pendingJob = state.jobs.find((job) => job.id === pendingJobId);
    if (
      pendingJob?.status !== 'completed' ||
      !reachYandexMetrikaGoal('first_backtest')
    )
      return;
    window.localStorage.setItem(FIRST_BACKTEST_REPORTED_KEY, '1');
    window.localStorage.removeItem(FIRST_BACKTEST_PENDING_JOB_KEY);
  }, [state.jobs]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const runningJobs = jobsRef.current.filter(
        (job) => job.status === 'running',
      );
      if (!runningJobs.length) return;
      void Promise.all(
        runningJobs.map((job) => controlBacktestRun(job.id, 'heartbeat')),
      )
        .then((jobs) => dispatch({ type: 'mergeJobs', jobs }))
        .catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const start = useCallback(async () => {
    const form = state.form;
    if (!form.selectedStrategy || !form.selectedConfigId) {
      toaster.error({
        title: 'Select strategy and config',
        description: 'Backtest config is required before launch.',
      });
      return;
    }

    const payload: Record<string, unknown> = {
      strategyName: form.selectedStrategy,
      configId: form.selectedConfigId,
      periodMode: form.periodMode,
      ai: form.ai,
      fast: form.fast,
      interval: form.interval,
      connector: form.connector,
    };
    if (form.periodMode === 'range') {
      const startTime = dateToStartMs(form.startDate);
      const endTime = dateToEndMs(form.endDate);
      if (!startTime || !endTime || startTime >= endTime) {
        toaster.error({
          title: 'Invalid date range',
          description: 'Start date must be earlier than end date.',
        });
        return;
      }
      payload.startTime = startTime;
      payload.endTime = endTime;
    } else {
      const days = Number(form.days);
      if (!Number.isFinite(days) || days <= 0) {
        toaster.error({
          title: 'Invalid days value',
          description: 'Days must be greater than zero.',
        });
        return;
      }
      payload.days = days;
    }
    if (form.selectedTickers.length)
      payload.tickers = form.selectedTickers.join(',');
    for (const [field, value] of [
      ['tickersLimit', form.tickersLimit],
      ['testsLimit', form.testsLimit],
      ['parallel', form.parallel],
    ] as const) {
      const parsed = Number(value);
      if (value.trim() && Number.isFinite(parsed) && parsed > 0)
        payload[field] = Math.trunc(parsed);
    }

    dispatch({ type: 'patch', patch: { starting: true } });
    try {
      const job = await startBacktestRun(payload);
      dispatch({ type: 'mergeJob', job });
      if (window.localStorage.getItem(FIRST_BACKTEST_REPORTED_KEY) !== '1') {
        window.localStorage.setItem(FIRST_BACKTEST_PENDING_JOB_KEY, job.id);
      }
      toaster.success({
        title: 'Backtest started',
        description: getJobTitle(job),
      });
    } catch (error) {
      toaster.error({
        title: 'Backtest start failed',
        description: (error as Error)?.message || 'Request failed.',
      });
    } finally {
      dispatch({ type: 'patch', patch: { starting: false } });
    }
  }, [state.form]);

  const control = useCallback(async (jobId: string, action: JobAction) => {
    dispatch({ type: 'patch', patch: { busyAction: `${jobId}:${action}` } });
    try {
      dispatch({
        type: 'mergeJob',
        job: await controlBacktestRun(jobId, action),
      });
    } catch (error) {
      toaster.error({
        title: 'Backtest action failed',
        description: (error as Error)?.message || 'Request failed.',
      });
    } finally {
      dispatch({ type: 'patch', patch: { busyAction: '' } });
    }
  }, []);

  const remove = useCallback(async (jobId: string) => {
    dispatch({ type: 'patch', patch: { busyAction: `${jobId}:delete` } });
    try {
      if (await deleteBacktestRun(jobId))
        dispatch({ type: 'removeJob', jobId });
    } catch (error) {
      toaster.error({
        title: 'Backtest job delete failed',
        description: (error as Error)?.message || 'Request failed.',
      });
    } finally {
      dispatch({ type: 'patch', patch: { busyAction: '' } });
    }
  }, []);

  return {
    state,
    strategyItems,
    configItems,
    selectedConfig,
    tickerItems,
    ensureTickersLoaded,
    updateForm,
    setSelectedTickers,
    start,
    control,
    remove,
    refresh,
  };
};
