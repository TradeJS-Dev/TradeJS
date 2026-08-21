import { defineConfig } from '@tradejs/core/config';
import {
  SANDBOX_E2E_ACCOUNT,
  SANDBOX_E2E_CONNECTOR_PROVIDER,
  SANDBOX_E2E_DEPLOYMENT,
  SANDBOX_E2E_STRATEGY,
  SANDBOX_E2E_STRATEGY_CONFIG,
  SANDBOX_E2E_TICKER,
} from './src/scripts/e2eConfig';

export default defineConfig({
  strategies: ['./src/plugins/sandboxStrategy.plugin.ts'],
  indicators: ['./src/plugins/sandboxIndicator.plugin.ts'],
  connectors: ['./src/plugins/sandboxConnector.plugin.ts'],
  runtime: {
    deployments: {
      [SANDBOX_E2E_DEPLOYMENT]: {
        label: 'Sandbox forward test',
        connectorName: SANDBOX_E2E_CONNECTOR_PROVIDER,
        provider: SANDBOX_E2E_CONNECTOR_PROVIDER,
        accountId: SANDBOX_E2E_ACCOUNT,
        enabled: true,
        assetClasses: ['crypto'],
        tickers: [SANDBOX_E2E_TICKER],
        strategies: {
          [SANDBOX_E2E_STRATEGY]: {
            version: 1,
            enabled: true,
            config: SANDBOX_E2E_STRATEGY_CONFIG,
          },
        },
      },
    },
  },
});
