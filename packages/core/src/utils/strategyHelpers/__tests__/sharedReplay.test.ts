import {
  getSharedStrategyReplayState,
  releaseStrategyReplayCache,
} from '../sharedReplay';

describe('shared strategy replay cache', () => {
  afterEach(() => {
    releaseStrategyReplayCache('test');
  });

  it('reuses state by key and releases by prefix', () => {
    const first = getSharedStrategyReplayState('test:a', () => ({ calls: 1 }));
    const second = getSharedStrategyReplayState('test:a', () => ({ calls: 2 }));

    expect(second).toBe(first);
    expect(second.calls).toBe(1);

    releaseStrategyReplayCache('test');

    const third = getSharedStrategyReplayState('test:a', () => ({ calls: 3 }));
    expect(third).not.toBe(first);
    expect(third.calls).toBe(3);
  });

  it('does not cache when key is missing', () => {
    const first = getSharedStrategyReplayState(undefined, () => ({ calls: 1 }));
    const second = getSharedStrategyReplayState(undefined, () => ({
      calls: 2,
    }));

    expect(second).not.toBe(first);
    expect(second.calls).toBe(2);
  });
});
