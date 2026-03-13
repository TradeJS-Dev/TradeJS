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
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
  };
  delete childEnv.PROJECT_CWD;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'tradejs',
      [
        'signals',
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
