const mockDelKeyStrict = jest.fn();
const mockGetDataStrict = jest.fn();
const mockSetDataStrict = jest.fn();

jest.mock('../redis', () => ({
  delKeyStrict: (...args: unknown[]) => mockDelKeyStrict(...args),
  getDataStrict: (...args: unknown[]) => mockGetDataStrict(...args),
  redisKeys: {
    runtimeControls: (userName: string) => `users:${userName}:runtime:controls`,
  },
  setDataStrict: (...args: unknown[]) => mockSetDataStrict(...args),
}));

import {
  getRuntimeControls,
  pauseRuntimeStrategy,
  resumeRuntimeStrategy,
} from '../runtimeControls';

describe('runtime controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDataStrict.mockResolvedValue(null);
    mockSetDataStrict.mockResolvedValue(undefined);
    mockDelKeyStrict.mockResolvedValue(true);
  });

  it('treats an absent controls key as no manual overrides', async () => {
    await expect(getRuntimeControls('root')).resolves.toEqual({
      schema: 'tradejs-runtime-controls/v1',
      deployments: {},
    });
  });

  it('rejects a malformed persisted controls document', async () => {
    mockGetDataStrict.mockResolvedValue({ deployments: {} });

    await expect(getRuntimeControls('root')).rejects.toThrow(
      'Invalid runtime controls',
    );
  });

  it('creates a manual pause override lazily', async () => {
    await pauseRuntimeStrategy({
      userName: 'root',
      deploymentId: 'production',
      strategyName: 'DoubleTap',
      updatedBy: 'root',
      updatedAt: '2026-08-19T10:00:00.000Z',
    });

    expect(mockSetDataStrict).toHaveBeenCalledWith(
      'users:root:runtime:controls',
      {
        schema: 'tradejs-runtime-controls/v1',
        deployments: {
          production: {
            DoubleTap: {
              entriesPaused: true,
              updatedAt: '2026-08-19T10:00:00.000Z',
              updatedBy: 'root',
            },
          },
        },
      },
      { expire: 0 },
    );
  });

  it('removes a resume override and deletes an empty controls key', async () => {
    mockGetDataStrict.mockResolvedValue({
      schema: 'tradejs-runtime-controls/v1',
      deployments: {
        production: {
          DoubleTap: {
            entriesPaused: true,
            updatedAt: '2026-08-19T10:00:00.000Z',
            updatedBy: 'root',
          },
        },
      },
    });

    await resumeRuntimeStrategy({
      userName: 'root',
      deploymentId: 'production',
      strategyName: 'DoubleTap',
    });

    expect(mockSetDataStrict).not.toHaveBeenCalled();
    expect(mockDelKeyStrict).toHaveBeenCalledWith(
      'users:root:runtime:controls',
    );
  });

  it('fails closed when Redis is unavailable', async () => {
    mockGetDataStrict.mockRejectedValue(new Error('Redis is unavailable'));

    await expect(getRuntimeControls('root')).rejects.toThrow(
      'Redis is unavailable',
    );
  });
});
