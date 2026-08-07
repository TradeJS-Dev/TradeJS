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
  const strategies = parseStrategyFilter(flags.strategy);
  const evidence = await collectRuntimeDebugEvidence({
    userName: flags.user,
    startTime,
    endTime,
    strategies: strategies.length ? strategies : undefined,
  });
  const runtime = buildRuntimeEvidenceReportPayload({
    userName: flags.user,
    startTime,
    endTime,
    signals: evidence.signals,
    evaluations: evidence.evaluations,
    trades: evidence.trades,
    strategyConfigs: evidence.strategyConfigs,
    evaluationStatsBuckets: evidence.evaluationStatsBuckets,
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
    runtime,
  };
  const outPath = path.resolve(projectRoot, String(flags.out));

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  const publishDir = String(flags.publishDir ?? '').trim();
  const published = publishDir
    ? await publishRuntimeEvidenceBundle({
        publishRoot: path.resolve(projectRoot, publishDir),
        deploymentId: String(flags.deployment),
        userName: String(flags.user),
        startTime,
        endTime,
        artifact,
        counts: artifact.runtime.counts,
        lineageKeys: [
          ...evidence.signals.map((signal) => signal.runtimeLineage),
          ...evidence.evaluations.map(
            (evaluation) => evaluation.runtimeLineage,
          ),
          ...evidence.trades.map((trade) => trade.runtimeLineage),
        ]
          .filter((lineage) => lineage != null)
          .map(runtimeLineageKey),
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
