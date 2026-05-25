import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  tsconfig: './tsconfig.build.json',
  clean: true,
  outDir: 'dist',
  target: 'node20',
  noExternal: ['fast-technical-indicators'],
  external: [
    '@tradejs/core',
    '@tradejs/types',
    'klinecharts',
    'technicalindicators',
  ],
});
