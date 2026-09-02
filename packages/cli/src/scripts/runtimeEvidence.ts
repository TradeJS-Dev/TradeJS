import fs from 'node:fs/promises';
import path from 'node:path';
import args from 'args';
import chalk from 'chalk';
import {
  buildRuntimeEvidenceReportPayload,
  collectRuntimeDebugEvidence,
} from '../lib/runtimeDebugEvidence';
import { publishRuntimeEvidenceBundle } from '../lib/runtimeEvidenceArtifacts';
import {
  loadRuntimeEvidenceCompositionSnapshots,
  splitRuntimeEvidenceByComposition,
} from '../lib/runtimeEvidenceCompositions';
import { runtimeLineageKey } from '../lib/runtimeLineage';
import { resolveRuntimeEvidenceProducer } from '../lib/runtimeEvidenceProducer';
import {
  activeRuntimeEvidenceStrategies,
  resolveRuntimeEvidenceDeploymentSnapshot,
  resolveRuntimeEvidenceTickerUniverse,
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
  const publishDir = String(flags.publishDir ?? '').trim();
  const producer = await resolveRuntimeEvidenceProducer({
    projectRoot,
    required: Boolean(publishDir),
  });
  const deploymentSnapshot = await resolveRuntimeEvidenceDeploymentSnapshot({
    userName: String(flags.user),
    projectRoot,
    deploymentId,
  });
  const requestedStrategies = parseStrategyFilter(flags.strategy);
  const evidence = await collectRuntimeDebugEvidence({
    userName: flags.user,
    startTime,
    endTime,
    strategies: requestedStrategies.length ? requestedStrategies : undefined,
    deploymentId,
  });
  const snapshots =
    publishDir && producer
      ? await loadRuntimeEvidenceCompositionSnapshots({
          publishRoot: path.resolve(projectRoot, publishDir),
          currentDeployment: deploymentSnapshot,
          currentProducer: producer,
        })
      : new Map([
          [
            deploymentSnapshot.deploymentCompositionId,
            { deployment: deploymentSnapshot, producer },
          ],
        ]);
  const declaredStrategies = new Set(
    [...snapshots.values()].flatMap(({ deployment }) =>
      deployment.strategies.map(({ strategyName }) => strategyName),
    ),
  );
  const unknownStrategies = requestedStrategies.filter(
    (strategyName) => !declaredStrategies.has(strategyName),
  );
  if (unknownStrategies.length) {
    throw new Error(
      `Strategies are not declared in ${deploymentId}: ${unknownStrategies.join(', ')}`,
    );
  }
  const compositionRows = splitRuntimeEvidenceByComposition({
    evidence,
    snapshots,
    includeEmptyCompositionIds: publishDir
      ? []
      : [deploymentSnapshot.deploymentCompositionId],
    ignoreUnknownCompositions: !publishDir,
  });
  const artifacts = compositionRows.map((composition) => {
    const strategies = activeRuntimeEvidenceStrategies(composition.deployment)
      .map(({ strategyName }) => strategyName)
      .filter(
        (strategyName) =>
          !requestedStrategies.length ||
          requestedStrategies.includes(strategyName),
      );
    const runtime = buildRuntimeEvidenceReportPayload({
      userName: flags.user,
      startTime,
      endTime,
      signals: composition.signals,
      evaluations: composition.evaluations,
      trades: composition.trades,
      lineageScopes: composition.lineageScopes,
    });
    const deployment = resolveRuntimeEvidenceTickerUniverse({
      deployment: composition.deployment,
      lineageScopes: composition.lineageScopes,
    });
    return {
      artifact: {
        reportType: 'runtime-evidence',
        generatedAt: Date.now(),
        ...(composition.producer ? { producer: composition.producer } : {}),
        ...(producer &&
        composition.producer &&
        composition.producer !== producer
          ? { collector: producer }
          : {}),
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
      },
      composition,
    };
  });
  const current =
    artifacts.find(
      ({ artifact }) =>
        artifact.deployment.deploymentCompositionId ===
        deploymentSnapshot.deploymentCompositionId,
    ) ?? artifacts.at(-1);
  if (!current) {
    throw new Error('Runtime evidence window has no versioned runtime rows');
  }
  const artifact = current.artifact;
  const outPath = path.resolve(projectRoot, String(flags.out));

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  const published = publishDir
    ? await Promise.all(
        artifacts.map(({ artifact, composition }) =>
          publishRuntimeEvidenceBundle({
            publishRoot: path.resolve(projectRoot, publishDir),
            deploymentId,
            userName: String(flags.user),
            startTime,
            endTime,
            artifact,
            counts: artifact.runtime.counts,
            lineageKeys: [
              ...composition.signals.map((signal) => signal.runtimeLineage),
              ...composition.evaluations.map(
                (evaluation) => evaluation.runtimeLineage,
              ),
              ...composition.trades.map((trade) => trade.runtimeLineage),
              ...composition.lineageScopes.map((scope) => scope.lineage),
            ]
              .filter((lineage) => lineage != null)
              .map(runtimeLineageKey)
              .filter((key, index, values) => values.indexOf(key) === index),
          }),
        ),
      )
    : [];

  console.log(chalk.green(`Wrote ${outPath}`));
  for (const bundle of published) {
    console.log(chalk.green(`Published ${bundle.bundleDir}`));
  }
  console.log(
    JSON.stringify(
      {
        compositions: artifacts.map(({ artifact }) => ({
          deploymentCompositionId: artifact.deployment.deploymentCompositionId,
          strategies: artifact.strategies,
          runtimeCounts: artifact.runtime.counts,
        })),
      },
      null,
      2,
    ),
  );
};

export const main = runtimeEvidence;
