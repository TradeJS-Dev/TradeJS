import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/scripts/*.ts', 'src/lib/*.ts', 'src/workers/*.ts'],
  format: ['cjs'],
  tsconfig: './tsconfig.build.json',
  clean: true,
  outDir: 'dist',
  target: 'node24',
  external: [
    '@tradejs/connectors',
    '@tradejs/core',
    '@tradejs/infra',
    '@tradejs/indicators',
    '@tradejs/node',
    '@tradejs/strategy-kit',
    '@tradejs/types',
    'args',
    'bcryptjs',
    'chalk',
    'date-fns',
    'dotenv',
    'ioredis',
    'lodash',
    'progress',
    'ws',
  ],
});
