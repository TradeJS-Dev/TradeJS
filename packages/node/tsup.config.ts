import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/ai.ts',
    'src/backtest.ts',
    'src/cli.ts',
    'src/connectors.ts',
    'src/constants.ts',
    'src/pine.ts',
    'src/registry.ts',
    'src/strategies.ts',
  ],
  format: ['cjs', 'esm'],
  dts: true,
  tsconfig: './tsconfig.build.json',
  clean: true,
  outDir: 'dist',
  target: 'node24',
  external: [
    '@langchain/core',
    '@langchain/openai',
    '@tradejs/core',
    '@tradejs/infra',
    '@tradejs/types',
    'chalk',
    'ioredis',
    'pinets',
    'progress',
    'puppeteer',
  ],
});
