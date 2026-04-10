import { defineConfig } from '@tradejs/core/config';

export default defineConfig({
  strategies: ['./src/plugins/sandboxStrategy.plugin.ts'],
  indicators: ['./src/plugins/sandboxIndicator.plugin.ts'],
  connectors: ['./src/plugins/sandboxConnector.plugin.ts'],
});
