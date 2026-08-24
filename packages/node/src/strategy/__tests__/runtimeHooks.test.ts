import type { Connector } from '@tradejs/types';
import { isRuntimeOrderExecutionEnabled } from '../runtimeHooks';

const connector = (test: boolean) =>
  ({ __tradejsTestConnector: test }) as unknown as Connector;

describe('runtime order execution safety', () => {
  it('simulates PARITY orders with MAKE_ORDERS disabled only on a test connector', () => {
    expect(
      isRuntimeOrderExecutionEnabled({
        config: { MAKE_ORDERS: false, SIMULATE_ORDERS: true },
        env: 'PARITY',
        connector: connector(true),
        externalOrderPlacement: 'false',
      }),
    ).toBe(true);
    expect(
      isRuntimeOrderExecutionEnabled({
        config: { MAKE_ORDERS: false, SIMULATE_ORDERS: true },
        env: 'PARITY',
        connector: connector(false),
        externalOrderPlacement: 'false',
      }),
    ).toBe(false);
  });

  it('hard-blocks a real connector when external placement is disabled', () => {
    expect(
      isRuntimeOrderExecutionEnabled({
        config: { MAKE_ORDERS: true },
        env: 'CRON',
        connector: connector(false),
        externalOrderPlacement: 'false',
      }),
    ).toBe(false);
  });
});
