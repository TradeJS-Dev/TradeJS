import path from 'node:path';
import args from 'args';
import chalk from 'chalk';
import { syncRuntimeEvidenceBundles } from '../lib/runtimeEvidenceSync';

args.option(
  'source',
  'Rsync source ending at the deployment ready directory',
  process.env.RUNTIME_EVIDENCE_RSYNC_SOURCE,
);
args.option(
  'deployment',
  'Deployment id expected in artifact manifests',
  process.env.RUNTIME_EVIDENCE_DEPLOYMENT_ID || 'production',
);
args.option(
  'dir',
  'Local evidence storage root',
  process.env.RUNTIME_EVIDENCE_LOCAL_DIR || 'data/runtime-evidence',
);

const flags = args.parse(process.argv);
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

export const runtimeEvidenceSync = async () => {
  const source = String(flags.source ?? '').trim();
  if (!source) {
    throw new Error(
      'Provide --source or RUNTIME_EVIDENCE_RSYNC_SOURCE for runtime evidence sync.',
    );
  }
  const evidenceRoot = path.resolve(projectRoot, String(flags.dir));
  const result = await syncRuntimeEvidenceBundles({
    source,
    evidenceRoot,
    deploymentId: String(flags.deployment),
  });

  console.log(
    chalk.green(
      `Runtime evidence sync completed: received=${result.received.length} pending=${result.pending.length} unsupported=${result.unsupported.length}`,
    ),
  );
  console.log(
    JSON.stringify(
      {
        evidenceRoot,
        received: result.received.map((bundle) => ({
          artifactId: bundle.manifest.artifactId,
          bundleDir: bundle.bundleDir,
          payloadPath: bundle.payloadPath,
        })),
        pending: result.pending.map((bundle) => ({
          artifactId: bundle.manifest.artifactId,
          bundleDir: bundle.bundleDir,
          payloadPath: bundle.payloadPath,
          window: bundle.manifest.window,
        })),
        unsupported: result.unsupported.map(({ bundle, reason }) => ({
          artifactId: bundle.manifest.artifactId,
          bundleDir: bundle.bundleDir,
          payloadPath: bundle.payloadPath,
          window: bundle.manifest.window,
          reason,
        })),
      },
      null,
      2,
    ),
  );
};

export const main = runtimeEvidenceSync;
