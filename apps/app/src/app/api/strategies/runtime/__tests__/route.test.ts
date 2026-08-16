const mockJson = jest.fn((body: unknown, init?: { status?: number }) => ({
  body,
  status: init?.status ?? 200,
}));
const mockGetCurrentUserName = jest.fn();
const mockLoadRuntimeDashboard = jest.fn();
const mockLogger = { error: jest.fn() };

jest.mock('next/server', () => ({
  NextResponse: {
    json: (...args: Parameters<typeof mockJson>) => mockJson(...args),
  },
}));

jest.mock('#app/lib/currentUser', () => ({
  getCurrentUserName: (...args: unknown[]) => mockGetCurrentUserName(...args),
}));

jest.mock('@tradejs/node/runtimeDashboard', () => ({
  loadRuntimeDashboard: (...args: unknown[]) =>
    mockLoadRuntimeDashboard(...args),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLogger.error(...args),
  },
}));

import { GET } from '../route';

const request = (query = '') =>
  ({
    nextUrl: {
      searchParams: new URLSearchParams(query),
    },
  }) as any;

describe('runtime strategies route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps authentication and HTTP mapping at the route seam', async () => {
    mockGetCurrentUserName.mockResolvedValue('root');
    mockLoadRuntimeDashboard.mockResolvedValue({ strategies: [] });

    await expect(GET(request('provider=binance&hours=48'))).resolves.toEqual({
      body: { strategies: [] },
      status: 200,
    });
    expect(mockLoadRuntimeDashboard).toHaveBeenCalledWith({
      userName: 'root',
      provider: 'binance',
      hours: '48',
    });
  });

  it('rejects unauthenticated requests without entering the read model', async () => {
    mockGetCurrentUserName.mockResolvedValue(null);

    await expect(GET(request())).resolves.toEqual({
      body: { error: 'Unauthorized' },
      status: 401,
    });
    expect(mockLoadRuntimeDashboard).not.toHaveBeenCalled();
  });

  it('maps read-model failures to an internal server error', async () => {
    const error = new Error('boom');
    mockGetCurrentUserName.mockResolvedValue('root');
    mockLoadRuntimeDashboard.mockRejectedValue(error);

    await expect(GET(request())).resolves.toEqual({
      body: { error: 'Internal Server Error' },
      status: 500,
    });
    expect(mockLogger.error).toHaveBeenCalledWith(
      'strategies runtime route failed: %o',
      error,
    );
  });
});
