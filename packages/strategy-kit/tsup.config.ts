import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/context.ts',
    'src/figures.ts',
    'src/numbers.ts',
    'src/positions.ts',
    'src/risk.ts',
  ],
  format: ['cjs', 'esm'],
  dts: true,
  tsconfig: './tsconfig.build.json',
  clean: true,
  outDir: 'dist',
  target: 'es2022',
  external: ['@tradejs/core', '@tradejs/types'],
});
