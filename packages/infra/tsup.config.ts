import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/ai.ts',
    'src/aiEndpoints.ts',
    'src/aiLanguages.ts',
    'src/aiModels.ts',
    'src/backtestArtifacts.ts',
    'src/files.ts',
    'src/http.ts',
    'src/logger.ts',
    'src/ml.ts',
    'src/redis.ts',
    'src/userSettings.ts',
    'src/timescale.ts',
    'src/tradingAccounts.ts',
  ],
  format: ['cjs', 'esm'],
  dts: true,
  tsconfig: './tsconfig.build.json',
  clean: true,
  outDir: 'dist',
  target: 'node24',
  external: [
    '@grpc/grpc-js',
    '@grpc/proto-loader',
    '@tradejs/types',
    'chalk',
    'ioredis',
    'pg',
    'winston',
  ],
});
