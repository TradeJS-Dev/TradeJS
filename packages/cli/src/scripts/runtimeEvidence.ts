import fs from 'node:fs/promises';
import path from 'node:path';
import args from 'args';
import chalk from 'chalk';
import {
  buildRuntimeEvidenceReportPayload,
  collectRuntimeDebugEvidence,
} from '../lib/runtimeDebugEvidence';
import { publishRuntimeEvidenceBundle } from '../lib/runtimeEvidenceArtifacts';
import { runtimeLineageKey } from '../lib/runtimeLineage';
import {
  activeRuntimeEvidenceStrategies,
  resolveRuntimeEvidenceDeploymentSnapshot,
  resolveRuntimeEvidenceTickerUniverse,
  runtimeLineageMatchesStrategySnapshot,
} from '../lib/runtimeEvidenceDeployment';

args.option(['u', 'user'], 'Use user config', 'root');
args.option(
  ['S', 'startTime'],
  'Window start timestamp, seconds/ms, or ISO date',
);
args.option(['E', 'endTime'], 'Window end timestamp, seconds/ms, or ISO date');
args.option(
  ['H', 'hours'],
  'Fallback window in hours when start/end are omitted',
  24,
);
args.option(
  'daily',
  'Use the latest complete 21:00 MSK to 21:00 MSK window',
  false,
);
args.option(['s', 'strategy'], 'Strategy filter, comma-separated');
args.option(['o', 'out'], 'Output JSON path', 'output/runtime-evidence.json');
args.option(
  'publishDir',
  'Publish an immutable bundle under <dir>/ready/<deployment>',
);
args.option(
  'deployment',
  'Deployment id used by immutable evidence bundles',
  process.env.RUNTIME_EVIDENCE_DEPLOYMENT_ID || 'production',
);

const flags = args.parse(process.argv);
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

const toEpochMs = (value: unknown): number | null => {
  if (value == null || value === '') {
    return null;
  }

  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) {
    const parsed = Number(raw);
    return parsed < 1e12 ? Math.trunc(parsed * 1000) : Math.trunc(parsed);
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveWindow = () => {
  const explicitStartTime = toEpochMs(flags.startTime);
  const explicitEndTime = toEpochMs(flags.endTime);
  const now = Date.now();
  const dailyEndTime = (() => {
    if (!flags.daily || explicitStartTime != null || explicitEndTime != null) {
      return null;
    }
    const date = new Date(now);
    const boundary = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      18,
    );
    return now >= boundary ? boundary : boundary - 24 * 60 * 60 * 1000;
  })();
  const endTime = explicitEndTime ?? dailyEndTime ?? now;
  const hours = Math.max(
    1,
    Number.parseInt(String(flags.hours ?? 24), 10) || 24,
  );
  const startTime = explicitStartTime ?? endTime - hours * 60 * 60 * 1000;

  if (startTime >= endTime) {
    throw new Error(
      `Invalid window: startTime (${startTime}) must be less than endTime (${endTime})`,
    );
  }

  return {
    startTime,
    endTime,
    source:
      explicitStartTime != null || explicitEndTime != null
        ? 'explicit'
        : dailyEndTime != null
          ? 'daily'
          : 'hours',
  };
};

const parseStrategyFilter = (value: unknown): string[] =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const runtimeEvidence = async () => {
  const { startTime, endTime, source } = resolveWindow();
  const deploymentId = String(flags.deployment);
  const deploymentSnapshot = await resolveRuntimeEvidenceDeploymentSnapshot({
    userName: String(flags.user),
    projectRoot,
    deploymentId,
  });
  const activeStrategies = activeRuntimeEvidenceStrategies(
    deploymentSnapshot,
  ).map(({ strategyName }) => strategyName);
  const requestedStrategies = parseStrategyFilter(flags.strategy);
  const strategies = requestedStrategies.length
    ? requestedStrategies
    : activeStrategies;
  const declaredStrategies = new Set(
    deploymentSnapshot.strategies.map(({ strategyName }) => strategyName),
  );
  const unknownStrategies = strategies.filter(
    (strategyName) => !declaredStrategies.has(strategyName),
  );
  if (unknownStrategies.length) {
    throw new Error(
      `Strategies are not declared in ${deploymentId}: ${unknownStrategies.join(', ')}`,
    );
  }
  const evidence = await collectRuntimeDebugEvidence({
    userName: flags.user,
    startTime,
    endTime,
    strategies,
    deploymentId,
  });
  const activeSnapshots = new Map(
    activeRuntimeEvidenceStrategies(deploymentSnapshot).map((strategy) => [
      strategy.strategyName,
      strategy,
    ]),
  );
  const belongsToCurrentDeployment = (row: {
    strategy: string;
    deploymentId?: string;
    accountId?: string;
    runtimeLineage?: import('@tradejs/types').RuntimeLineage;
  }) => {
    const snapshot = activeSnapshots.get(row.strategy);
    return Boolean(
      snapshot &&
        row.deploymentId === deploymentSnapshot.id &&
        row.accountId === deploymentSnapshot.accountId &&
        runtimeLineageMatchesStrategySnapshot({
          lineage: row.runtimeLineage,
          deployment: deploymentSnapshot,
          strategy: snapshot,
        }),
    );
  };
  const currentSignals = evidence.signals.filter(belongsToCurrentDeployment);
  const currentEvaluations = evidence.evaluations.filter(
    belongsToCurrentDeployment,
  );
  const currentTrades = evidence.trades.filter(belongsToCurrentDeployment);
  const currentLineageScopes = evidence.lineageScopes.filter((scope) =>
    belongsToCurrentDeployment({
      ...scope,
      runtimeLineage: scope.lineage,
    }),
  );
  const runtime = buildRuntimeEvidenceReportPayload({
    userName: flags.user,
    startTime,
    endTime,
    signals: currentSignals,
    evaluations: currentEvaluations,
    trades: currentTrades,
    evaluationStatsBuckets: evidence.evaluationStatsBuckets,
    lineageScopes: currentLineageScopes,
  });
  const deployment = resolveRuntimeEvidenceTickerUniverse({
    deployment: deploymentSnapshot,
    lineageScopes: currentLineageScopes,
  });
  const artifact = {
    reportType: 'runtime-evidence',
    generatedAt: Date.now(),
    userName: flags.user,
    window: {
      startTime,
      endTime,
      startIso: new Date(startTime).toISOString(),
      endIso: new Date(endTime).toISOString(),
      source,
    },
    strategies,
    deployment,
    runtime,
  };
  const outPath = path.resolve(projectRoot, String(flags.out));

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  const publishDir = String(flags.publishDir ?? '').trim();
  const published = publishDir
    ? await publishRuntimeEvidenceBundle({
        publishRoot: path.resolve(projectRoot, publishDir),
        deploymentId,
        userName: String(flags.user),
        startTime,
        endTime,
        artifact,
        counts: artifact.runtime.counts,
        lineageKeys: [
          ...currentSignals.map((signal) => signal.runtimeLineage),
          ...currentEvaluations.map((evaluation) => evaluation.runtimeLineage),
          ...currentTrades.map((trade) => trade.runtimeLineage),
          ...currentLineageScopes.map((scope) => scope.lineage),
        ]
          .filter((lineage) => lineage != null)
          .map(runtimeLineageKey)
          .filter((key, index, values) => values.indexOf(key) === index),
      })
    : null;

  console.log(chalk.green(`Wrote ${outPath}`));
  if (published) {
    console.log(chalk.green(`Published ${published.bundleDir}`));
  }
  console.log(
    JSON.stringify(
      {
        strategies: artifact.strategies,
        runtimeCounts: artifact.runtime.counts,
      },
      null,
      2,
    ),
  );
};

export const main = runtimeEvidence;
