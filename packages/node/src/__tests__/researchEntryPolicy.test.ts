import type { AiPayload, ResearchEntryPolicy, Signal } from '@tradejs/types';
import {
  parseResearchEntryPolicy,
  matchesResearchEntryRules,
  evaluateResearchEntryPolicy,
} from '../researchEntryPolicy';
import { buildAiPayload, runAiPromptLocal } from '../ai';

jest.mock('../ai', () => ({
  buildAiPayload: jest.fn(),
  runAiPromptLocal: jest.fn(),
  getDeterministicAiGateContext: jest.fn(() => null),
}));

const policy: ResearchEntryPolicy = {
  schema: 'tradejs-research-entry-policy/v1',
  strategy: 'Example',
  mode: 'rules',
  minQuality: 4,
  rules: {
    LONG: [
      { path: 'additionalIndicators.setup.strength', op: '>=', value: 0.5 },
    ],
    SHORT: null,
  },
};
const payload = {
  additionalIndicators: { setup: { strength: 0.6 } },
} as AiPayload;

describe('frozen research entry policy', () => {
  beforeEach(() => {
    jest.mocked(buildAiPayload).mockReturnValue(payload);
    jest
      .mocked(runAiPromptLocal)
      .mockResolvedValue({ direction: 'LONG', quality: 4 });
  });
  it('validates both directions and rejects outcome or prototype paths', () => {
    expect(parseResearchEntryPolicy(policy)).toEqual(policy);
    for (const path of [
      'additionalIndicators.outcome.profit',
      'additionalIndicators.__proto__.x',
      'signal.timestamp',
      'additionalIndicators.context.rows',
    ])
      expect(() =>
        parseResearchEntryPolicy({
          ...policy,
          rules: { ...policy.rules, LONG: [{ path, op: '>=', value: 1 }] },
        }),
      ).toThrow('non-causal');
    expect(() =>
      parseResearchEntryPolicy({ ...policy, rules: { LONG: [] } }),
    ).toThrow('both directions');
    expect(() =>
      parseResearchEntryPolicy({ ...policy, minQuality: 6 }),
    ).toThrow('contract');
  });
  it('validates frozen direction masks and blocks the current gate before evaluation', async () => {
    for (const directions of [['LONG', 'LONG'], ['OTHER'], null, 'LONG'])
      expect(() => parseResearchEntryPolicy({ ...policy, directions })).toThrow(
        'directions',
      );
    expect(
      parseResearchEntryPolicy({ ...policy, directions: [] }).directions,
    ).toEqual([]);
    jest.mocked(runAiPromptLocal).mockClear();
    const decision = jest.fn();
    expect(
      await evaluateResearchEntryPolicy(
        { ...policy, mode: 'current-gate', directions: ['LONG'] },
        { strategy: 'Example', direction: 'SHORT' } as Signal,
        decision,
      ),
    ).toBe(false);
    expect(runAiPromptLocal).not.toHaveBeenCalled();
    expect(decision).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'DIRECTION_BLOCKED' }),
    );
  });
  it('blocks missing and nonnumeric data without treating it as zero', () => {
    expect(matchesResearchEntryRules(payload, policy.rules.LONG!)).toBe(true);
    expect(
      matchesResearchEntryRules(
        { additionalIndicators: {} } as AiPayload,
        policy.rules.LONG!,
      ),
    ).toBe(false);
    expect(
      matchesResearchEntryRules(
        { additionalIndicators: { setup: { strength: '0.8' } } } as AiPayload,
        policy.rules.LONG!,
      ),
    ).toBe(false);
    expect(
      matchesResearchEntryRules(payload, [
        { path: 'additionalIndicators.setup.strength', op: '<=', value: 0.5 },
      ]),
    ).toBe(false);
    expect(
      matchesResearchEntryRules(payload, [
        { path: 'additionalIndicators.setup.strength', op: '==', value: '0.6' },
      ]),
    ).toBe(false);
  });
  it('runs current deterministic gate or frozen directional rules, never a provider', async () => {
    const signal = { strategy: 'Example', direction: 'LONG' } as Signal;
    expect(await evaluateResearchEntryPolicy(policy, signal)).toBe(true);
    expect(
      await evaluateResearchEntryPolicy(policy, {
        ...signal,
        direction: 'SHORT',
      }),
    ).toBe(false);
    expect(
      await evaluateResearchEntryPolicy(
        { ...policy, mode: 'current-gate' },
        signal,
      ),
    ).toBe(true);
    jest
      .mocked(runAiPromptLocal)
      .mockResolvedValue({ direction: 'LONG', quality: 3 });
    expect(
      await evaluateResearchEntryPolicy(
        { ...policy, mode: 'current-gate' },
        signal,
      ),
    ).toBe(false);
    await expect(
      evaluateResearchEntryPolicy(policy, { ...signal, strategy: 'Other' }),
    ).rejects.toThrow('mismatch');
  });
});
