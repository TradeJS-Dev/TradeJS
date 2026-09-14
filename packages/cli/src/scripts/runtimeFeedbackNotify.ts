import path from 'node:path';
import args from 'args';
import chalk from 'chalk';
import {
  buildRuntimeFeedbackTelegramMessage,
  notifyRuntimeFeedbackBundle,
} from '../lib/runtimeFeedbackNotification';
import { verifyRuntimeFeedbackReplayBundle } from '../lib/runtimeFeedbackArtifacts';

args.option('bundle', 'Verified runtime feedback replay bundle directory');
args.option('dryRun', 'Verify and print the message without sending it', false);

const flags = args.parse(process.argv);
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

export const runtimeFeedbackNotify = async () => {
  const bundle = String(flags.bundle ?? '').trim();
  if (!bundle) {
    throw new Error('Provide --bundle for runtime feedback notification.');
  }
  const bundleDir = path.resolve(projectRoot, bundle);

  if (flags.dryRun) {
    const verified = await verifyRuntimeFeedbackReplayBundle(bundleDir);
    console.log(buildRuntimeFeedbackTelegramMessage(verified.replayEvidence));
    return;
  }

  const result = await notifyRuntimeFeedbackBundle({ bundleDir });
  console.log(
    chalk.green(`Runtime feedback notification sent: ${result.artifactId}`),
  );
};

export const main = runtimeFeedbackNotify;
