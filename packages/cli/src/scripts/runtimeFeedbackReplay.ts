import path from 'node:path';
import args from 'args';
import chalk from 'chalk';
import { runRuntimeFeedbackReplay } from '../lib/runtimeFeedbackReplay';

args.option('runtimeEvidence', 'Verified runtime evidence JSON');
args.option('outDir', 'New writable directory for replay output');
args.option('runId', 'Stable identifier for this replay attempt');

const flags = args.parse(process.argv);
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

export const runtimeFeedbackReplay = async () => {
  const runtimeEvidence = String(flags.runtimeEvidence ?? '').trim();
  const outDir = String(flags.outDir ?? '').trim();
  if (!runtimeEvidence || !outDir) {
    throw new Error(
      'Provide --runtimeEvidence and --outDir for runtime feedback replay.',
    );
  }

  const verified = await runRuntimeFeedbackReplay({
    runtimeEvidencePath: path.resolve(projectRoot, runtimeEvidence),
    outDir: path.resolve(projectRoot, outDir),
    runId: String(flags.runId ?? '').trim() || undefined,
    projectRoot,
  });
  console.log(
    chalk.green(
      `Runtime feedback replay sealed: ${verified.manifest.artifactId}`,
    ),
  );
  console.log(
    JSON.stringify(
      {
        bundleDir: verified.bundleDir,
        manifestPath: verified.manifestPath,
        replayEvidencePath: verified.replayEvidencePath,
      },
      null,
      2,
    ),
  );
};

export const main = runtimeFeedbackReplay;
