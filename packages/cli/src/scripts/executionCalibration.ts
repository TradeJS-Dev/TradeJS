import fs from 'node:fs/promises';
import path from 'node:path';
import args from 'args';
import chalk from 'chalk';
import { buildExecutionCalibrationReport } from '../lib/executionCalibration';

args.option(
  'runtimeEvidence',
  'Runtime debug JSON collected on the runtime server',
);
args.option(
  'replayEvidence',
  'Replay runtime evidence JSON produced by replay-runtime-evidence',
);
args.option(
  ['o', 'out'],
  'Output JSON path',
  'output/execution-calibration.json',
);

const flags = args.parse(process.argv);
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

const readJsonFile = async (filePath: string) =>
  JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;

const resolveInputPath = (value: unknown) => {
  const raw = String(value ?? '').trim();
  return raw ? path.resolve(projectRoot, raw) : null;
};

export const executionCalibration = async () => {
  const runtimeEvidencePath = resolveInputPath(flags.runtimeEvidence);
  const replayEvidencePath = resolveInputPath(flags.replayEvidence);

  if (!runtimeEvidencePath && !replayEvidencePath) {
    throw new Error(
      'Provide --runtimeEvidence, --replayEvidence, or both for execution calibration.',
    );
  }

  const [runtimeArtifact, replayEvidenceArtifact] = await Promise.all([
    runtimeEvidencePath
      ? readJsonFile(runtimeEvidencePath)
      : Promise.resolve(undefined),
    replayEvidencePath
      ? readJsonFile(replayEvidencePath)
      : Promise.resolve(undefined),
  ]);
  const report = buildExecutionCalibrationReport({
    runtimeArtifact,
    replayEvidenceArtifact,
    sourcePaths: {
      runtimeEvidence: runtimeEvidencePath,
      replayEvidence: replayEvidencePath,
    },
  });
  const outPath = path.resolve(projectRoot, String(flags.out));

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(chalk.green(`Wrote ${outPath}`));
  console.log(
    JSON.stringify(
      {
        counts: report.counts,
        currentModel: report.currentModel,
        recommendation: report.recommendation,
        summary: {
          signalToArrivalAdverseBps:
            report.summary.all.signalToArrivalAdverseBps,
          arrivalToFillAdverseBps: report.summary.all.arrivalToFillAdverseBps,
          signalToFillAdverseBps: report.summary.all.signalToFillAdverseBps,
          residualVsCurrentModelBps:
            report.summary.all.residualVsCurrentModelBps,
          replayEntryResidualBps: report.summary.all.replayEntryResidualBps,
        },
      },
      null,
      2,
    ),
  );
};

export const main = executionCalibration;
