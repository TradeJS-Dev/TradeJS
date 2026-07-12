const mockGetToken = jest.fn();
const mockEncode = jest.fn();
const mockConsumeScreenshotSessionToken = jest.fn();

type MockResponse = {
  kind: 'next' | 'json' | 'redirect';
  status: number;
  body?: unknown;
  location?: string;
  cookies: {
    values: Array<{ name: string; value: string; options?: unknown }>;
    set: (name: string, value: string, options?: unknown) => void;
  };
};

const createResponse = (
  kind: MockResponse['kind'],
  init?: { status?: number },
  location?: string,
): MockResponse => {
  const cookies = {
    values: [] as Array<{ name: string; value: string; options?: unknown }>,
    set(name: string, value: string, options?: unknown) {
      this.values.push({ name, value, options });
    },
  };

  return {
    kind,
    status: init?.status ?? (kind === 'redirect' ? 307 : 200),
    ...(location ? { location } : {}),
    cookies,
  };
};

jest.mock('next/server', () => ({
  NextResponse: {
    next: () => createResponse('next'),
    json: (body: unknown, init?: { status?: number }) => ({
      ...createResponse('json', init),
      body,
    }),
    redirect: (url: URL | string, init?: { status?: number }) =>
      createResponse(
        'redirect',
        init,
        typeof url === 'string' ? url : url.toString(),
      ),
  },
}));

jest.mock('next-auth/jwt', () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
  encode: (...args: unknown[]) => mockEncode(...args),
}));

jest.mock('@tradejs/infra/redis', () => ({
  consumeScreenshotSessionToken: (...args: unknown[]) =>
    mockConsumeScreenshotSessionToken(...args),
}));

import { proxy } from '../proxy';

const createRequest = (url: string, init?: { method?: string }) => {
  const nextUrl = new URL(url);
  const headers = new Headers();

  return {
    method: init?.method ?? 'GET',
    url,
    nextUrl,
    headers: {
      get: (name: string) => headers.get(name),
    },
  } as any;
};

describe('proxy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_SECRET = 'test-secret';
    process.env.NEXTAUTH_SECRET = 'test-secret';
    process.env.NEXTAUTH_URL = 'https://tradejs.dev';
  });

  it('returns 401 for api json-like paths without a session', async () => {
    mockGetToken.mockResolvedValue(null);

    const response = await proxy(
      createRequest('https://tradejs.dev/api/signal/BTCUSDT/abc123.json'),
    );

    expect(response.kind).toBe('json');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('issues a short-lived session from screenshot token and removes it from the redirect url', async () => {
    mockConsumeScreenshotSessionToken.mockResolvedValue('alice');
    mockEncode.mockResolvedValue('signed-jwt');

    const response = await proxy(
      createRequest(
        'https://tradejs.dev/routes/dashboard/bybit/BTCUSDT/60?screenshotToken=shot-token&foo=1',
      ),
    );

    expect(mockConsumeScreenshotSessionToken).toHaveBeenCalledWith(
      'shot-token',
    );
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(response.kind).toBe('redirect');
    expect(response.location).toBe(
      'https://tradejs.dev/routes/dashboard/bybit/BTCUSDT/60?foo=1',
    );
    expect(response.cookies.values).toEqual([
      {
        name: '__Secure-authjs.session-token',
        value: 'signed-jwt',
        options: expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: true,
          maxAge: 15 * 60,
        }),
      },
    ]);
  });
});
