import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/files.ts',
    'src/http.ts',
    'src/logger.ts',
    'src/ml.ts',
    'src/redis.ts',
    'src/timescale.ts',
  ],
  format: ['cjs', 'esm'],
  dts: true,
  tsconfig: '../../tsconfig.build.json',
  clean: true,
  outDir: 'dist',
  target: 'node20',
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
