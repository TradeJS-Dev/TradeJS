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
    '@tradejs/core',
    '@tradejs/indicators',
    '@tradejs/node',
    '@tradejs/types',
  ],
});
