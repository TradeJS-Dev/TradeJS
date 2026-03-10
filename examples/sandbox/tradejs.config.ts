import { defineConfig } from '@tradejs/core';

export default defineConfig({
  strategyPlugins: ['./src/plugins/sandboxStrategy.plugin.ts'],
  indicatorsPlugins: ['./src/plugins/sandboxIndicator.plugin.ts'],
  connectorsPlugins: ['./src/plugins/sandboxConnector.plugin.ts'],
});
