const initializeInstallationMock = jest.fn();
const isInstallationRequiredMock = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

jest.mock('#app/lib/installation', () => ({
  initializeInstallation: (...args: unknown[]) =>
    initializeInstallationMock(...args),
  isInstallationRequired: (...args: unknown[]) =>
    isInstallationRequiredMock(...args),
}));

import { GET, POST } from '../route';

describe('/api/install', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports whether first-run installation is required', async () => {
    isInstallationRequiredMock.mockResolvedValue(true);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ required: true });
  });

  it('validates password confirmation', async () => {
    const response = await POST({
      json: async () => ({
        password: 'Password123!',
        confirmPassword: 'Different123!',
      }),
    } as Request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Passwords do not match',
    });
  });

  it('installs root exactly once', async () => {
    initializeInstallationMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const request = () =>
      ({
        json: async () => ({
          password: 'Password123!',
          confirmPassword: 'Password123!',
        }),
      }) as Request;

    const installed = await POST(request());
    const repeated = await POST(request());

    expect(installed.status).toBe(201);
    expect(repeated.status).toBe(409);
  });
});
