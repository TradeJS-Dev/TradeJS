import { config as DEFAULT_CONFIG } from '../config';
import { cupAndHandleAiAdapter } from '../adapters/ai';

describe('CupAndHandle AI adapter', () => {
  it('copies pattern context into the AI payload and prompt', () => {
    const context = {
      patternKind: 'cup_and_handle',
      signalDirection: 'LONG',
      cupDepthAtr: 3.2,
      handleDepthRatio: 0.3,
    };
    const signal = {
      additionalIndicators: { cupAndHandleContext: context },
    } as any;
    const payload = cupAndHandleAiAdapter.buildPayload?.({
      signal,
      basePayload: {
        signal: {} as any,
        figures: {},
        indicators: {},
        additionalIndicators: { baseContext: {} },
      },
    });

    expect((payload?.additionalIndicators as any).cupAndHandleContext).toEqual(
      context,
    );
    expect(
      cupAndHandleAiAdapter.buildHumanPromptAddon?.({
        signal,
        payload: payload as any,
      }),
    ).toContain('handleDepthRatio=0.3');
  });

  it('maps runtime AI settings from strategy config', () => {
    expect(
      cupAndHandleAiAdapter.mapEntryRuntimeFromConfig?.({
        ...DEFAULT_CONFIG,
        AI_ENABLED: true,
        AI_MODE: 'llm',
        MIN_AI_QUALITY: 3,
      } as any),
    ).toEqual({ enabled: true, mode: 'llm', minQuality: 3 });
  });
});
