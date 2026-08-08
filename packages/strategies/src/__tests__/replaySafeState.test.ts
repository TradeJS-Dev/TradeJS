/** @jest-environment node */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const statefulStrategyCores = [
  'AdaptiveMomentumRibbon',
  'AdaptiveTrendChannel',
  'CupAndHandle',
  'DoubleTap',
  'Grid',
  'GridClassic',
  'LiquidityTails',
  'LiquidityZones',
  'ReverseTrendLine',
  'StructureZones',
  'TrendFollow',
  'TrendLine',
  'TrendShift',
  'VolumeDivergence',
];

const readStrategyCore = (strategyName: string) =>
  readFileSync(path.join(__dirname, '..', strategyName, 'core.ts'), 'utf8');

describe('replay-safe strategy state', () => {
  it.each(statefulStrategyCores)(
    '%s keeps rolling detector state behind StrategyAPI state controller',
    (strategyName) => {
      const source = readStrategyCore(strategyName);

      expect(source).toContain('createStateController');
      expect(source).toContain('oncePerTimestamp');
      expect(source).not.toMatch(
        /\bconst\s+engine\s*=\s*create[A-Za-z0-9]+Engine\(/,
      );
      expect(source).not.toMatch(
        /\blet\s+(pendingCandidate|processedCandles)\b/,
      );
    },
  );
});
