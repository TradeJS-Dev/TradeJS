import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  SANDBOX_E2E_ACCOUNT,
  SANDBOX_E2E_CONNECTOR_PROVIDER,
  SANDBOX_E2E_DEPLOYMENT,
  SANDBOX_E2E_STRATEGY,
  SANDBOX_E2E_STRATEGY_CONFIG,
  SANDBOX_E2E_TICKER,
  SANDBOX_E2E_USER,
} from './e2eConfig';
import { runTradejsCli } from './runTradejsCli';

const readJson = async (filePath: string) =>
  JSON.parse(await readFile(filePath, 'utf8')) as {
    name?: string;
    version?: string;
  };

const runSignals = async (): Promise<void> => {
  const projectCwd = path.resolve(__dirname, '../..');
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'tradejs-sandbox-runtime-'),
  );
  try {
    const [projectPackage, runtimePackage] = await Promise.all([
      readJson(path.join(projectCwd, 'package.json')),
      readJson(
        path.join(
          projectCwd,
          'node_modules',
          '@tradejs',
          'node',
          'package.json',
        ),
      ),
    ]);
    if (
      !projectPackage.name ||
      !projectPackage.version ||
      !runtimePackage.version
    ) {
      throw new Error('Sandbox package identity is incomplete');
    }
    const configPath = path.join(temporaryRoot, 'strategy-config.json');
    const manifestPath = path.join(
      temporaryRoot,
      'runtime-package-manifest.json',
    );
    await Promise.all([
      writeFile(configPath, JSON.stringify(SANDBOX_E2E_STRATEGY_CONFIG)),
      writeFile(
        manifestPath,
        JSON.stringify({
          schema: 'tradejs-runtime-package-manifest/v1',
          projectSha: 'sandbox-e2e',
          packages: {
            [projectPackage.name]: projectPackage.version,
            '@tradejs/node': runtimePackage.version,
          },
        }),
      ),
    ]);
    const runtimeEnv = {
      TRADEJS_RUNTIME_PACKAGE_MANIFEST: manifestPath,
    };

    await runTradejsCli({
      command: 'runtime-config',
      args: [
        'provision',
        '--user',
        SANDBOX_E2E_USER,
        '--strategy',
        SANDBOX_E2E_STRATEGY,
        '--deployment',
        SANDBOX_E2E_DEPLOYMENT,
        '--account',
        SANDBOX_E2E_ACCOUNT,
        '--connector',
        SANDBOX_E2E_CONNECTOR_PROVIDER,
        '--provider',
        SANDBOX_E2E_CONNECTOR_PROVIDER,
        '--file',
        configPath,
        '--write',
      ],
      projectCwd,
      env: runtimeEnv,
      errorMessage: 'Runtime provision process exited with code',
    });
    await runTradejsCli({
      command: 'runtime-config',
      args: [
        'resume',
        '--user',
        SANDBOX_E2E_USER,
        '--strategy',
        SANDBOX_E2E_STRATEGY,
        '--deployment',
        SANDBOX_E2E_DEPLOYMENT,
      ],
      projectCwd,
      env: runtimeEnv,
      errorMessage: 'Runtime resume process exited with code',
    });
    await runTradejsCli({
      command: 'runtime-config',
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
