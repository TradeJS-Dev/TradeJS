import type { ConnectorRuntime } from '@tradejs/types';
import { bindConnectorRuntime } from '../connectorRuntime';

describe('bindConnectorRuntime', () => {
  it('injects the composition-root runtime into a connector creator', async () => {
    const creator = jest.fn(async () => ({ provider: 'test' }) as any);
    const runtime = {
      logger: {
        log: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
      resolveTradingAccount: jest.fn(),
      createCachedKline: jest.fn(),
    } as unknown as ConnectorRuntime;
    const config = { userName: 'root' };

    const connector = await bindConnectorRuntime(creator, runtime)(config);

    expect(connector).toEqual({ provider: 'test' });
    expect(creator).toHaveBeenCalledWith(config, runtime);
  });
});
