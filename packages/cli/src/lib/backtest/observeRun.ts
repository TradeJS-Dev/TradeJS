import { TTL_1H } from '@tradejs/core/constants';
import { cliBacktestRunStorage } from '@tradejs/infra/redis';
import { logger } from '@tradejs/infra/logger';
import type { CliBacktestRun, TestSuite } from '@tradejs/types';
import type { BacktestRunManifest } from './checkpoint';

const HEARTBEAT_MS = 2_000;
const ACTIVE_TTL_SECONDS = 30;
const LINKED_RUN_TTL_SECONDS = 30 * 24 * TTL_1H;
const RESEARCH_STUDY =
  /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}\/\d{4}-\d{2}-\d{2}-[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const MAX_VALUES_PER_PARAMETER = 12;
const MAX_VALUE_LENGTH = 500;

export const summarizeBacktestParameters = (tests: TestSuite) => {
  const parameters = new Map<
    string,
    { values: Set<string>; truncated: boolean }
  >();
  for (const test of tests) {
    for (const [name, value] of Object.entries(test.strategyConfig)) {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) continue;
      const parameter = parameters.get(name) ?? {
        values: new Set<string>(),
        truncated: false,
      };
      parameters.set(name, parameter);
      if (parameter.values.has(serialized)) continue;
      if (
        parameter.values.size === MAX_VALUES_PER_PARAMETER ||
        serialized.length > MAX_VALUE_LENGTH
      ) {
        parameter.truncated = true;
      } else {
        parameter.values.add(serialized);
      }
    }
  }
  return [...parameters].map(([name, { values, truncated }]) => ({
    name,
    values: [...values],
    truncated,
  }));
};

export const observeBacktestRun = async (
  manifest: BacktestRunManifest,
  initialCompleted: number,
  parallel: number,
) => {
  if (process.env.TRADEJS_BACKTEST_WEB_JOB === '1') return;

  const researchStudy = process.env.TRADEJS_RESEARCH_STUDY?.trim();
  const linkedStudy =
    researchStudy && RESEARCH_STUDY.test(researchStudy)
      ? researchStudy
      : undefined;
  if (researchStudy && !linkedStudy) {
    logger.warn(
      'invalid TRADEJS_RESEARCH_STUDY; expected Strategy/YYYY-MM-DD-slug',
    );
  }
  const { testSuite } = manifest;
  const firstTest = testSuite[0];
  const startedAt = new Date().toISOString();
  const run: CliBacktestRun = {
    id: manifest.runId,
    ...(linkedStudy && { researchStudy: linkedStudy }),
    userName: manifest.userName,
    strategyName: firstTest.strategyName,
    configId: manifest.config,
    connector: manifest.connectorName,
    interval: manifest.interval,
    startTime: manifest.window.start,
    endTime: manifest.window.end,
    symbols: [...new Set(testSuite.map((test) => test.symbol))],
    settings: {
      ...manifest.flags,
      parallel,
      ...(firstTest.executionCosts && {
        executionCosts: JSON.stringify(firstTest.executionCosts),
      }),
    },
    parameters: summarizeBacktestParameters(testSuite),
    status: 'running',
    completed: initialCompleted,
    total: testSuite.length,
    startedAt,
    updatedAt: startedAt,
  };
  const save = async (expire: number) => {
    run.updatedAt = new Date().toISOString();
    try {
      await cliBacktestRunStorage.put(run, expire);
    } catch (error) {
      logger.warn('failed to publish CLI backtest progress: %s', String(error));
    }
  };
  await save(ACTIVE_TTL_SECONDS);

  let pending: Promise<void> | undefined;
  const timer = setInterval(() => {
    pending ??= save(ACTIVE_TTL_SECONDS).finally(() => {
      pending = undefined;
    });
  }, HEARTBEAT_MS).unref();

  return {
    progress: (completed: number) => {
      run.completed = completed;
    },
    finish: async (status: Exclude<CliBacktestRun['status'], 'running'>) => {
      clearInterval(timer);
      await pending;
      run.status = status;
      await save(linkedStudy ? LINKED_RUN_TTL_SECONDS : TTL_1H);
    },
  };
};
