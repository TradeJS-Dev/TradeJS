import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type {
  RuntimeLaunchReport,
  RuntimeLaunchReportResponse,
} from '@tradejs/types';
import { loadTradejsConfig } from './tradejsConfig';
import { getStrategyPluginSource } from './strategy';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isText = (value: unknown): value is string =>
  typeof value === 'string' && Boolean(value.trim());

const isSha256 = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 8.64e15;

const metricChecks: Record<
  keyof RuntimeLaunchReport['metrics'],
  (value: number) => boolean
> = {
  trades: (value) => Number.isInteger(value) && value >= 0,
  winRatePercent: (value) => value >= 0 && value <= 100,
  maxDrawdownDurationDays: (value) => value >= 0,
  maxLossStreak: (value) => Number.isInteger(value) && value >= 0,
  maxDrawdown: (value) => value >= 0,
  pnl: () => true,
  profitFactor: (value) => value >= 0,
};

const parseReport = (data: unknown, strategy: string): RuntimeLaunchReport => {
  if (
    !isRecord(data) ||
    data.schema !== 'tradejs-launch-report/v1' ||
    data.strategy !== strategy ||
    !isText(data.candidate) ||
    !isSha256(data.sourceSha256) ||
    !isRecord(data.metrics)
  ) {
    throw new Error('Invalid strategy launch report');
  }
  const metrics: RuntimeLaunchReport['metrics'] = {};
  for (const key of Object.keys(
    metricChecks,
  ) as (keyof typeof metricChecks)[]) {
    const value = data.metrics[key];
    if (value === undefined) continue;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      !metricChecks[key](value)
    ) {
      throw new Error(`Invalid launch report metric: ${key}`);
    }
    metrics[key] = value;
  }

  const report: RuntimeLaunchReport = {
    schema: data.schema,
    strategy,
    candidate: data.candidate,
    sourceSha256: data.sourceSha256,
    metrics,
  };
  const { period, chart, note, researchRiskUsdt } = data;
  if (note !== undefined) {
    if (!isText(note)) throw new Error('Invalid launch report note');
    report.note = note;
  }
  if (researchRiskUsdt !== undefined) {
    if (
      typeof researchRiskUsdt !== 'number' ||
      !Number.isFinite(researchRiskUsdt) ||
      researchRiskUsdt <= 0
    ) {
      throw new Error('Invalid launch report research risk');
    }
    report.researchRiskUsdt = researchRiskUsdt;
  }
  if (period !== undefined) {
    if (
      !isRecord(period) ||
      !isTimestamp(period.start) ||
      !isTimestamp(period.end) ||
      period.start >= period.end
    ) {
      throw new Error('Invalid launch report period');
    }
    report.period = { start: period.start, end: period.end };
  }
  if (chart !== undefined) {
    if (!isRecord(chart) || !isText(chart.caption) || !isSha256(chart.sha256)) {
      throw new Error('Invalid launch report chart');
    }
    report.chart = { caption: chart.caption, sha256: chart.sha256 };
  }
  return report;
};

export const readRuntimeLaunchReport = async ({
  projectRoot,
  deploymentId,
  strategyName,
}: {
  projectRoot: string;
  deploymentId: string;
  strategyName: string;
}): Promise<RuntimeLaunchReportResponse | null> => {
  const { runtime, launchReports } = await loadTradejsConfig(projectRoot);
  const deployments = runtime?.deployments;
  if (!deployments || !Object.hasOwn(deployments, deploymentId)) return null;
  const { strategies } = deployments[deploymentId];
  if (!Object.hasOwn(strategies, strategyName)) return null;
  const bindings =
    launchReports && Object.hasOwn(launchReports, deploymentId)
      ? launchReports[deploymentId]
      : undefined;
  if (!isRecord(bindings) || !Object.hasOwn(bindings, strategyName))
    return null;
  const launchReportId = bindings[strategyName];
  if (
    typeof launchReportId !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,127}$/.test(launchReportId)
  ) {
    throw new Error('Invalid strategy launch report ID');
  }
  const source = await getStrategyPluginSource(
    strategyName,
    projectRoot,
    strategies[strategyName].module,
  );
  if (!source || !/^(?:@[\w.-]+\/)?[\w-][\w.-]*$/.test(source)) {
    throw new Error('Launch reports require an installed strategy package');
  }

  const requireFromProject = createRequire(
    path.join(projectRoot, 'package.json'),
  );
  let reportPath: string;
  try {
    reportPath = requireFromProject.resolve(
      `${source}/launch-reports/${launchReportId}.json`,
    );
  } catch (error) {
    if (
      isRecord(error) &&
      ['ERR_PACKAGE_PATH_NOT_EXPORTED', 'MODULE_NOT_FOUND'].includes(
        String(error.code),
      )
    ) {
      return null;
    }
    throw error;
  }
  const report = parseReport(
    JSON.parse(await readFile(reportPath, 'utf8')),
    strategyName,
  );
  if (!report.chart) return { report };

  const image = await readFile(reportPath.replace(/\.json$/, '.png'));
  if (
    createHash('sha256').update(image).digest('hex') !== report.chart.sha256
  ) {
    throw new Error('Launch report chart checksum does not match');
  }
  return {
    report,
    chartUrl: `data:image/png;base64,${image.toString('base64')}`,
  };
};
