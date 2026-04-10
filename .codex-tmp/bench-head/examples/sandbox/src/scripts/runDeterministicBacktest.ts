import http from 'http';
import path from 'path';
import {
  SANDBOX_E2E_BACKTEST_CONFIG,
  SANDBOX_E2E_CONNECTOR_PROVIDER,
  SANDBOX_E2E_TICKER,
  SANDBOX_E2E_TIMEFRAME,
  SANDBOX_E2E_USER,
} from './e2eConfig';
import { runTradejsCli } from './runTradejsCli';

const writeJson = (
  res: http.ServerResponse,
  statusCode: number,
  payload: unknown,
): void => {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
};

const createMockExchangeServer = () =>
  http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = requestUrl.pathname;

    if (pathname === '/api/v3/klines') {
      writeJson(res, 200, []);
      return;
    }

    if (pathname === '/api/v3/ticker/24hr') {
      writeJson(res, 200, []);
      return;
    }

    if (pathname === '/products/BTC-USD/candles') {
      writeJson(res, 200, []);
      return;
    }

    if (pathname.endsWith('/ticker') || pathname.endsWith('/stats')) {
      writeJson(res, 200, {});
      return;
    }

    writeJson(res, 404, { error: `Path not mocked: ${pathname}` });
  });

const runBacktest = async (mockBaseUrl: string): Promise<void> => {
  const projectCwd = path.resolve(__dirname, '../..');
  await runTradejsCli({
    command: 'backtest',
    args: [
      '--user',
      SANDBOX_E2E_USER,
      '--config',
      SANDBOX_E2E_BACKTEST_CONFIG,
      '--connector',
      SANDBOX_E2E_CONNECTOR_PROVIDER,
      '--cacheOnly',
      '--tickers',
      SANDBOX_E2E_TICKER,
      '--timeframe',
      SANDBOX_E2E_TIMEFRAME,
      '--tests',
      '1',
      '--parallel',
      '1',
      '--top',
      '1',
      '--progressStep',
      '1',
    ],
    projectCwd,
    env: {
      BINANCE_BASE_URL: mockBaseUrl,
      COINBASE_BASE_URL: mockBaseUrl,
    },
    errorMessage: 'Backtest process exited with code',
  });
};

const run = async () => {
  const server = createMockExchangeServer();

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to acquire mock server address');
  }

  const mockBaseUrl = `http://127.0.0.1:${address.port}`;

  try {
    console.log(`Mock exchange server: ${mockBaseUrl}`);
    await runBacktest(mockBaseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
};

void run();
