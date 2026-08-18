const mockGetCurrentUserName = jest.fn();
const mockGetRuntimeDeployment = jest.fn();
const mockRecordRuntimeStrategyControlEvent = jest.fn();
const mockSaveRuntimeDeployment = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

jest.mock('@tradejs/infra/runtimeDeployments', () => ({
  getRuntimeDeployment: (...args: unknown[]) =>
    mockGetRuntimeDeployment(...args),
  saveRuntimeDeployment: (...args: unknown[]) =>
    mockSaveRuntimeDeployment(...args),
}));

jest.mock('@tradejs/infra/runtimeStrategyReleases', () => ({
  recordRuntimeStrategyControlEvent: (...args: unknown[]) =>
    mockRecordRuntimeStrategyControlEvent(...args),
}));

jest.mock('#app/lib/currentUser', () => ({
  getCurrentUserName: (...args: unknown[]) => mockGetCurrentUserName(...args),
}));

import { PATCH } from '../route';

const context = {
  params: Promise.resolve({
    deploymentId: 'doubletap-forward',
    strategyName: 'DoubleTap',
  }),
};
const request = (controlState: unknown) =>
  ({ json: async () => ({ controlState }) }) as any;

describe('runtime strategy control route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserName.mockResolvedValue('root');
    mockGetRuntimeDeployment.mockResolvedValue({
      id: 'doubletap-forward',
      label: 'DoubleTap forward',
      connectorName: 'bybit',
      provider: 'bybit',
      accountId: 'bybit-main',
      universe: 'crypto',
      interval: '15',
      enabled: true,
      strategies: [
        {
          strategyName: 'DoubleTap',
          releaseVersion: 3,
          controlState: 'active',
        },
      ],
    });
    mockSaveRuntimeDeployment.mockImplementation(
      async (_userName: string, value: unknown) => value,
    );
    mockRecordRuntimeStrategyControlEvent.mockResolvedValue({
      eventId: 'event-1',
    });
  });

  it('pauses only new entries and records the control event', async () => {
    const response = await PATCH(request('entries_paused'), context);

    expect(mockSaveRuntimeDeployment).toHaveBeenCalledWith(
      'root',
      expect.objectContaining({
        strategies: [
          expect.objectContaining({
            strategyName: 'DoubleTap',
            releaseVersion: 3,
            controlState: 'entries_paused',
          }),
        ],
      }),
    );
    expect(mockRecordRuntimeStrategyControlEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: 'doubletap-forward',
        strategyName: 'DoubleTap',
        releaseVersion: 3,
        previousState: 'active',
        nextState: 'entries_paused',
      }),
    );
    expect(response.status).toBe(200);
  });

  it('rejects an unknown control state', async () => {
    const response = await PATCH(request('disabled'), context);

    expect(response).toEqual({
      status: 400,
      body: { error: 'controlState must be active or entries_paused' },
    });
    expect(mockSaveRuntimeDeployment).not.toHaveBeenCalled();
  });
});
