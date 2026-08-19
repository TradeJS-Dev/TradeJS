const mockGetCurrentUserName = jest.fn();
const mockGetRuntimeDeployment = jest.fn();
const mockPauseRuntimeStrategy = jest.fn();
const mockResumeRuntimeStrategy = jest.fn();
const mockRecordRuntimeStrategyControlEvent = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

jest.mock('@tradejs/node/runtimeStrategies', () => ({
  getRuntimeDeployment: (...args: unknown[]) =>
    mockGetRuntimeDeployment(...args),
}));

jest.mock('@tradejs/infra/runtimeControls', () => ({
  pauseRuntimeStrategy: (...args: unknown[]) =>
    mockPauseRuntimeStrategy(...args),
  resumeRuntimeStrategy: (...args: unknown[]) =>
    mockResumeRuntimeStrategy(...args),
  recordRuntimeStrategyControlEvent: (...args: unknown[]) =>
    mockRecordRuntimeStrategyControlEvent(...args),
}));

jest.mock('#app/lib/currentUser', () => ({
  getCurrentUserName: (...args: unknown[]) => mockGetCurrentUserName(...args),
}));

import { PATCH } from '../route';

const context = {
  params: Promise.resolve({
    deploymentId: 'production',
    strategyName: 'DoubleTap',
  }),
};
const request = (controlState: unknown) =>
  ({ json: async () => ({ controlState }) }) as any;
const deployment = (overrides: Record<string, unknown> = {}) => ({
  id: 'production',
  label: 'Production',
  connectorName: 'bybit',
  provider: 'bybit',
  accountId: 'bybit-main',
  enabled: true,
  strategies: [
    {
      strategyName: 'DoubleTap',
      version: 4,
      enabled: true,
      controlState: 'active',
    },
  ],
  ...overrides,
});

describe('runtime strategy manual controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserName.mockResolvedValue('root');
    mockGetRuntimeDeployment.mockResolvedValue(deployment());
    mockRecordRuntimeStrategyControlEvent.mockResolvedValue({
      eventId: 'event-1',
    });
  });

  it('pauses entries through the optional controls document', async () => {
    const response = await PATCH(request('entries_paused'), context);

    expect(mockPauseRuntimeStrategy).toHaveBeenCalledWith({
      userName: 'root',
      deploymentId: 'production',
      strategyName: 'DoubleTap',
      updatedBy: 'root',
    });
    expect(mockRecordRuntimeStrategyControlEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: 'production',
        strategyName: 'DoubleTap',
        version: 4,
        previousState: 'active',
        nextState: 'entries_paused',
      }),
    );
    expect(response.status).toBe(200);
  });

  it('rejects resume when Git keeps the strategy disabled', async () => {
    mockGetRuntimeDeployment.mockResolvedValue(
      deployment({
        strategies: [
          {
            strategyName: 'DoubleTap',
            version: 4,
            enabled: false,
            controlState: 'entries_paused',
          },
        ],
      }),
    );

    const response = await PATCH(request('active'), context);

    expect(response.status).toBe(409);
    expect(mockResumeRuntimeStrategy).not.toHaveBeenCalled();
  });

  it('rejects an unknown control state', async () => {
    const response = await PATCH(request('disabled'), context);

    expect(response).toEqual({
      status: 400,
      body: { error: 'controlState must be active or entries_paused' },
    });
    expect(mockPauseRuntimeStrategy).not.toHaveBeenCalled();
  });
});
