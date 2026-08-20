import { mkdtemp, rm, writeFile } from 'fs/promises';
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import {
  SANDBOX_E2E_DEPLOYMENT,
  SANDBOX_E2E_TICKER,
  SANDBOX_E2E_USER,
} from './e2eConfig';
import { runTradejsCli } from './runTradejsCli';
import { collectSandboxRuntimePackageVersions } from './runtimePackageManifest';

const runSignals = async (): Promise<void> => {
  const projectCwd = path.resolve(__dirname, '../..');
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'tradejs-sandbox-runtime-'),
  );
  try {
    const packages = await collectSandboxRuntimePackageVersions(projectCwd);
    const manifestPath = path.join(
      temporaryRoot,
      'runtime-package-manifest.json',
    );
    await writeFile(
      manifestPath,
      JSON.stringify({
        schema: 'tradejs-runtime-package-manifest/v1',
        projectSha: execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: projectCwd,
          encoding: 'utf8',
        }).trim(),
        packages,
      }),
    );
    const runtimeEnv = {
      TRADEJS_RUNTIME_PACKAGE_MANIFEST: manifestPath,
    };

    await runTradejsCli({
      command: 'runtime-control',
      args: [
        'verify',
        '--user',
        SANDBOX_E2E_USER,
        '--deployment',
        SANDBOX_E2E_DEPLOYMENT,
      ],
      projectCwd,
      env: runtimeEnv,
      errorMessage: 'Runtime verify process exited with code',
    });
    await runTradejsCli({
      command: 'signals',
      args: [
        '--user',
        SANDBOX_E2E_USER,
        '--deployment',
        SANDBOX_E2E_DEPLOYMENT,
        '--cacheOnly',
        '--tickers',
        SANDBOX_E2E_TICKER,
        '--skipScreenshots',
      ],
      projectCwd,
      env: runtimeEnv,
      errorMessage: 'Signals process exited with code',
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};

void runSignals();
