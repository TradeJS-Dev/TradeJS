import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/api.ts',
    'src/async.ts',
    'src/backtest.ts',
    'src/config.ts',
    'src/constants.ts',
    'src/data.ts',
    'src/figures.ts',
    'src/indicators.ts',
    'src/math.ts',
    'src/strategies.ts',
    'src/tickers.ts',
    'src/time.ts',
  ],
  format: ['cjs', 'esm'],
  dts: true,
  tsconfig: './tsconfig.build.json',
  clean: true,
  outDir: 'dist',
  target: 'node20',
  external: [
    '@tradejs/types',
    'date-fns',
    'klinecharts',
    'lodash',
    'technicalindicators',
    'uuid',
  ],
});
