import path from 'node:path';
import args from 'args';
import chalk from 'chalk';
import { syncRuntimeFeedbackReplayBundles } from '../lib/runtimeFeedbackSync';

args.option(
  'source',
  'Rsync source ending at the runtime feedback ready directory',
  process.env.RUNTIME_FEEDBACK_RSYNC_SOURCE,
);
args.option(
  'deployment',
  'Deployment id expected in runtime feedback manifests',
  process.env.RUNTIME_EVIDENCE_DEPLOYMENT_ID || 'production',
);
args.option(
  'dir',
  'Local runtime feedback storage root',
  process.env.RUNTIME_FEEDBACK_LOCAL_DIR || 'data/runtime-feedback',
);

const flags = args.parse(process.argv);
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

export const runtimeFeedbackSync = async () => {
  const source = String(flags.source ?? '').trim();
  if (!source) {
    throw new Error(
      'Provide --source or RUNTIME_FEEDBACK_RSYNC_SOURCE for runtime feedback sync.',
    );
  }
  const feedbackRoot = path.resolve(projectRoot, String(flags.dir));
  const result = await syncRuntimeFeedbackReplayBundles({
    source,
    feedbackRoot,
    deploymentId: String(flags.deployment),
  });

  console.log(
    chalk.green(
      `Runtime feedback sync completed: received=${result.received.length}`,
    ),
  );
  console.log(
    JSON.stringify(
      {
        feedbackRoot,
        received: result.received.map((bundle) => ({
          artifactId: bundle.manifest.artifactId,
          bundleDir: bundle.bundleDir,
          replayEvidencePath: bundle.replayEvidencePath,
          runtimeEvidence: bundle.manifest.runtimeEvidence,
        })),
      },
      null,
      2,
    ),
  );
};

export const main = runtimeFeedbackSync;
