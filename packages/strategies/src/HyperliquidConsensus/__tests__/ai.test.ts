import { hyperliquidConsensusAiAdapter } from '../adapters/ai';

describe('hyperliquidConsensusAiAdapter', () => {
  it('preserves causal consensus context in the AI payload', () => {
    const context = {
      signalDirection: 'LONG',
      consensusScore: 0.5,
      uniqueWhales: 4,
      coveragePct: 0.9,
    };
    const payload = hyperliquidConsensusAiAdapter.buildPayload?.({
      signal: {
        additionalIndicators: { hyperliquidConsensusContext: context },
      } as any,
      basePayload: { additionalIndicators: { baseContext: {} } } as any,
    });

    expect(payload?.additionalIndicators).toMatchObject({
      baseContext: {},
      hyperliquidConsensusContext: context,
    });
    expect(
      hyperliquidConsensusAiAdapter.buildHumanPromptAddon?.({
        signal: {} as any,
        payload: payload as any,
      }),
    ).toContain('consensusScore=0.5');
  });
});
