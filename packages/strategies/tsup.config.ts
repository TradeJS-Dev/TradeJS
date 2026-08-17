import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  tsconfig: './tsconfig.build.json',
  clean: true,
  outDir: 'dist',
  target: 'es2022',
  external: [
    '@tradejs/core',
    '@tradejs/indicators',
    '@tradejs/strategy-kit',
    '@tradejs/types',
    'technicalindicators',
  ],
});
