import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  tsconfig: './tsconfig.build.json',
  clean: true,
  outDir: 'dist',
  target: 'node24',
  external: [
    '@tradejs/connectors',
    '@tradejs/core',
    '@tradejs/indicators',
    '@tradejs/strategies',
  ],
});
