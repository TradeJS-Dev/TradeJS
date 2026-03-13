import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
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
