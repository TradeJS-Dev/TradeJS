const mockDeleteRuntimeDeployment = jest.fn();
const mockGetCurrentUserName = jest.fn();
const mockGetRuntimeDeployment = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

jest.mock('@tradejs/infra/runtimeDeployments', () => ({
  deleteRuntimeDeployment: (...args: unknown[]) =>
    mockDeleteRuntimeDeployment(...args),
  getRuntimeDeployment: (...args: unknown[]) =>
    mockGetRuntimeDeployment(...args),
}));

jest.mock('#app/lib/currentUser', () => ({
  getCurrentUserName: (...args: unknown[]) => mockGetCurrentUserName(...args),
}));

import { DELETE } from '../route';

const context = (deploymentId: string) => ({
  params: Promise.resolve({ deploymentId }),
});

describe('runtime deployment delete route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserName.mockResolvedValue('root');
  });

  it('returns not found for an unknown deployment', async () => {
    mockGetRuntimeDeployment.mockResolvedValue(null);

    const response = await DELETE({} as Request, context('missing'));

    expect(response).toEqual({
      status: 404,
      body: { error: 'Deployment not found' },
    });
  });

  it('deletes an existing deployment', async () => {
    mockGetRuntimeDeployment.mockResolvedValue({ id: 'tradfi-live' });

    const response = await DELETE({} as Request, context('tradfi-live'));

    expect(mockDeleteRuntimeDeployment).toHaveBeenCalledWith(
      'root',
      'tradfi-live',
    );
    expect(response).toEqual({ status: 200, body: { deleted: true } });
  });
});
