import path from 'path';
import {
  SANDBOX_E2E_CONNECTOR_PROVIDER,
  SANDBOX_E2E_TICKER,
  SANDBOX_E2E_TIMEFRAME,
  SANDBOX_E2E_USER,
} from './e2eConfig';
import { runTradejsCli } from './runTradejsCli';

const runSignals = async (): Promise<void> => {
  const projectCwd = path.resolve(__dirname, '../..');
  await runTradejsCli({
    command: 'signals',
    args: [
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
    projectCwd,
    errorMessage: 'Signals process exited with code',
  });
};

void runSignals();
