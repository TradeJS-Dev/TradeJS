/** @jest-environment node */

const mockVerify = jest.fn();
const mockConsume = jest.fn();
const mockAuthorize = jest.fn();
const mockRead = jest.fn();

jest.mock('#app/lib/actionConfirmation', () => ({
  verifyActionConfirmation: (...args: unknown[]) => mockVerify(...args),
}));
jest.mock('#app/lib/currentUser', () => ({
  getCurrentUserName: async () => 'root',
}));
jest.mock('#app/lib/mcp/http', () => ({
  readMcpBody: (request: Request) => request.text(),
}));
jest.mock('#app/lib/mcp/oauth', () => ({
  mcpEnabled: () => true,
  mcpOrigin: () => 'http://localhost',
  requireSameOrigin: () => true,
  oauthResponse: (body: object, status: number) =>
    Response.json(body, { status }),
  readConsent: (...args: unknown[]) => mockRead(...args),
  consumeConsent: (...args: unknown[]) => mockConsume(...args),
  authorizeConsent: (...args: unknown[]) => mockAuthorize(...args),
}));

import { POST } from '../route';

const request = (
  decision: 'allow' | 'deny',
  proof: Record<string, string> = {},
) =>
  new Request('http://localhost/oauth/authorize', {
    method: 'POST',
    body: new URLSearchParams({
      ticket: 'ticket',
      decision,
      scope: 'market:read',
      ...proof,
    }),
  });

beforeEach(() => {
  jest.clearAllMocks();
  const consent = {
    userName: 'root',
    scopes: ['market:read', 'runtime:read'],
    query: {
      redirect_uri: 'https://client.example/callback',
      state: 'example-state',
    },
  };
  mockRead.mockResolvedValue(consent);
  mockConsume.mockResolvedValue(consent);
  mockAuthorize.mockResolvedValue(
    'https://client.example/callback?code=authorized',
  );
});

it('leaves the consent ticket available after a failed confirmation', async () => {
  mockVerify.mockResolvedValueOnce({ status: 403 });
  const rejected = await POST(request('allow'));
  const retry = new URL(rejected.headers.get('Location') ?? '');
  expect(retry.pathname).toBe('/routes/mcp/consent');
  expect(retry.searchParams.get('ticket')).toBe('ticket');
  expect(retry.searchParams.getAll('scope')).toEqual(['market:read']);
  expect(mockConsume).not.toHaveBeenCalled();
  expect(mockAuthorize).not.toHaveBeenCalled();

  mockVerify.mockResolvedValueOnce(null);
  const approved = await POST(
    request('allow', { confirmationMethod: 'code', confirmation: '012345' }),
  );
  expect(approved.headers.get('Location')).toBe(
    'https://client.example/callback?code=authorized',
  );
  expect(mockVerify).toHaveBeenLastCalledWith('root', {
    method: 'code',
    value: '012345',
  });
  expect(mockConsume).toHaveBeenCalledTimes(1);
  expect(mockAuthorize).toHaveBeenCalledWith(
    expect.objectContaining({ scopes: ['market:read'] }),
  );
});

it('does not require confirmation to decline a connection', async () => {
  const denied = await POST(request('deny'));
  expect(
    new URL(denied.headers.get('Location') ?? '').searchParams.get('error'),
  ).toBe('access_denied');
  expect(mockVerify).not.toHaveBeenCalled();
  expect(mockAuthorize).not.toHaveBeenCalled();
});
