import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  tsconfig: './tsconfig.build.json',
  clean: true,
  dts: false,
  outDir: 'dist',
  target: 'node24',
  banner: {
    js: '#!/usr/bin/env node',
  },
});
