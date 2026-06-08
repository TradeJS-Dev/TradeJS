import fs from 'node:fs/promises';
import path from 'node:path';
import args from 'args';
import chalk from 'chalk';
import {
  buildRuntimeDebugReportPayload,
  collectRuntimeDebugEvidence,
} from '../lib/runtimeDebugEvidence';

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
args.option(['s', 'strategy'], 'Strategy filter, comma-separated');
args.option(['o', 'out'], 'Output JSON path', 'output/runtime-evidence.json');

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
  const endTime = toEpochMs(flags.endTime) ?? Date.now();
  const hours = Math.max(
    1,
    Number.parseInt(String(flags.hours ?? 24), 10) || 24,
  );
  const startTime =
    toEpochMs(flags.startTime) ?? endTime - hours * 60 * 60 * 1000;

  if (startTime >= endTime) {
    throw new Error(
      `Invalid window: startTime (${startTime}) must be less than endTime (${endTime})`,
    );
  }

  return {
    startTime,
    endTime,
    source:
      flags.startTime != null || flags.endTime != null ? 'explicit' : 'hours',
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
  const runtime = await buildRuntimeDebugReportPayload({
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

  console.log(chalk.green(`Wrote ${outPath}`));
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
