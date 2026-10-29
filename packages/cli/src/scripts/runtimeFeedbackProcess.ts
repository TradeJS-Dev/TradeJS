import args from 'args';
import path from 'node:path';
import { processRuntimeFeedbackPair } from '../lib/runtimeFeedbackProcess';
args.option(
  'runtimeDir',
  'Directory containing the complete downloaded runtime evidence bundle',
);
args.option(
  'replayDir',
  'Directory containing the complete downloaded production replay bundle',
);
args.option(
  'historyDir',
  'Directory containing verified historical runtime bundles',
  'data/runtime-evidence/artifacts/production',
);
const flags = args.parse(process.argv);
export const main = async () => {
  if (!flags.runtimeDir || !flags.replayDir)
    throw new Error('Provide --runtimeDir and --replayDir');
  const root = process.env.PROJECT_CWD || process.cwd();
  console.log(
    JSON.stringify(
      await processRuntimeFeedbackPair({
        runtimeDir: path.resolve(root, String(flags.runtimeDir)),
        replayDir: path.resolve(root, String(flags.replayDir)),
        evidenceRoot: path.join(root, 'data/runtime-evidence'),
        outputRoot: path.join(root, 'output/runtime-feedback'),
        historyDir: path.resolve(root, String(flags.historyDir)),
      }),
    ),
  );
};
