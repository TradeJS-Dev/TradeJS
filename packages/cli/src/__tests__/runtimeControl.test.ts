import { RUNTIME_CONTROL_ACTIONS } from '../scripts/runtimeControl';

describe('runtime-control commands', () => {
  it('exposes only inspection and manual pause controls', () => {
    expect(RUNTIME_CONTROL_ACTIONS).toEqual([
      'inspect',
      'verify',
      'pause',
      'resume',
    ]);
  });
});
