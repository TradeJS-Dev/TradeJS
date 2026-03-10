import path from 'path';
import { spawn } from 'child_process';
import {
  SANDBOX_E2E_CONNECTOR_PROVIDER,
  SANDBOX_E2E_TICKER,
  SANDBOX_E2E_TIMEFRAME,
  SANDBOX_E2E_USER,
} from './e2eConfig';

const runSignals = async (): Promise<void> => {
  const projectCwd = path.resolve(__dirname, '../..');
  const tsNodeProject = path.resolve(projectCwd, '../../tsconfig.json');
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    TS_NODE_PROJECT: tsNodeProject,
  };
  delete childEnv.PROJECT_CWD;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'node',
      [
        '-r',
        'ts-node/register',
        '-r',
        'tsconfig-paths/register',
        '../../packages/cli/src/scripts/signals.ts',
        '--user',
        SANDBOX_E2E_USER,
        '--connector',
        SANDBOX_E2E_CONNECTOR_PROVIDER,
        '--cacheOnly',
        '--tickers',
        SANDBOX_E2E_TICKER,
        '--timeframe',
        SANDBOX_E2E_TIMEFRAME,
        '--skipScreenshots',
      ],
      {
        cwd: projectCwd,
        stdio: 'inherit',
        env: childEnv,
      },
    );

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Signals process exited with code ${code ?? -1}`));
    });
  });
};

void runSignals();
