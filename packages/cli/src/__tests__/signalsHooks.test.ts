import {
  invokeAfterSignalsHooks,
  invokeBeforeSignalsHooks,
  normalizeHookList,
} from '../lib/signals/hooks';

describe('signals hooks helpers', () => {
  it('normalizes single hooks and hook arrays', () => {
    const hook = jest.fn();

    expect(normalizeHookList(undefined)).toEqual([]);
    expect(normalizeHookList(hook)).toEqual([hook]);
    expect(normalizeHookList([hook])).toEqual([hook]);
  });

  it('stops beforeSignals hooks on abort', async () => {
    const first = jest.fn(async () => ({ abort: true, reason: 'LOCKED' }));
    const second = jest.fn();

    await expect(
      invokeBeforeSignalsHooks(
        {
          beforeSignals: [first, second],
        } as any,
        { userName: 'root' } as any,
      ),
    ).resolves.toEqual({ abort: true, reason: 'LOCKED' });
    expect(second).not.toHaveBeenCalled();
  });

  it('invokes afterSignals hooks in order', async () => {
    const calls: string[] = [];
    const first = jest.fn(async () => calls.push('first'));
    const second = jest.fn(async () => calls.push('second'));

    await invokeAfterSignalsHooks(
      {
        afterSignals: [first, second],
      } as any,
      { status: 'completed', signals: [] } as any,
    );

    expect(calls).toEqual(['first', 'second']);
  });
});
