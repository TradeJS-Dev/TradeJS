import {
  projectAiFeatures,
  validateAiFeatureDefinitions,
  validateAiFeatureSnapshot,
} from '../aiFeatures';
import type { AiFeatureDefinition } from '@tradejs/types';
const definition: AiFeatureDefinition = {
  id: 'setup.amplitude',
  version: 1,
  path: 'setup.swings',
  source: 'signal',
  reduction: 'max',
  divideBy: 'atr',
  role: 'input',
  stationary: true,
  scope: 'setup',
  unit: 'ATR',
  description: 'Maximum confirmed swing divided by signal ATR',
};
describe('explicit AI feature projection', () => {
  it('projects full causal arrays before prompt truncation and preserves the recipe', () => {
    const s = projectAiFeatures([definition], {
      signal: { setup: { swings: [12, 1, 2, 3, 4, 5, 6] }, atr: 2 },
      payload: { setup: { swings: [2, 3, 4, 5, 6] }, atr: 2 },
    });
    expect(s.values['setup.amplitude']).toBe(6);
    expect(s.definitions).toEqual([definition]);
    expect(() =>
      validateAiFeatureSnapshot(JSON.parse(JSON.stringify(s))),
    ).not.toThrow();
  });
  it('does not replace missing or invalid inputs with zero', () => {
    expect(
      projectAiFeatures([definition], {
        signal: { setup: { swings: [1, NaN] }, atr: 2 },
        payload: {},
      }).values['setup.amplitude'],
    ).toBeNull();
    expect(
      projectAiFeatures([definition], {
        signal: { setup: { swings: [] }, atr: 0 },
        payload: {},
      }).values['setup.amplitude'],
    ).toBeNull();
  });
  it('rejects outcome inputs, duplicate IDs, prototype traversal and incomplete snapshots', () => {
    expect(() =>
      validateAiFeatureDefinitions([
        { ...definition, path: 'tradeResult.netProfit' },
      ]),
    ).toThrow('Outcome');
    expect(() =>
      validateAiFeatureDefinitions([definition, definition]),
    ).toThrow('duplicate');
    expect(() =>
      validateAiFeatureDefinitions([
        { ...definition, path: '__proto__.value' },
      ]),
    ).toThrow('path');
    expect(() =>
      validateAiFeatureSnapshot({
        schema: 'tradejs-ai-features/v1',
        definitions: [definition],
        values: {},
      }),
    ).toThrow('match');
  });
  it.each(['last', 'mean', 'min', 'max', 'count'] as const)(
    'reduces %s with an explicit definition',
    (reduction) => {
      const values = { last: 3, mean: 2, min: 1, max: 3, count: 3 };
      expect(
        projectAiFeatures([{ ...definition, reduction, divideBy: undefined }], {
          signal: { setup: { swings: [1, 2, 3] } },
          payload: {},
        }).values['setup.amplitude'],
      ).toBe(values[reduction]);
    },
  );
});
