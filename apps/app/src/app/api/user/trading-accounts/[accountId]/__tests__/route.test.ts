const mockDeleteTradingAccount = jest.fn();
const mockGetCurrentUserName = jest.fn();
const mockGetTradingAccount = jest.fn();
const mockListRuntimeDeployments = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

jest.mock('@tradejs/infra/tradingAccounts', () => ({
  deleteTradingAccount: (...args: unknown[]) =>
    mockDeleteTradingAccount(...args),
  getTradingAccount: (...args: unknown[]) => mockGetTradingAccount(...args),
  listRuntimeDeployments: (...args: unknown[]) =>
    mockListRuntimeDeployments(...args),
}));

jest.mock('#app/lib/currentUser', () => ({
  getCurrentUserName: (...args: unknown[]) => mockGetCurrentUserName(...args),
}));

import { DELETE } from '../route';

const context = (accountId: string) => ({
  params: Promise.resolve({ accountId }),
});

describe('trading account delete route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserName.mockResolvedValue('root');
    mockListRuntimeDeployments.mockResolvedValue([]);
  });

  it('returns not found for an unknown account', async () => {
    mockGetTradingAccount.mockResolvedValue(null);

    const response = await DELETE({} as Request, context('missing'));

    expect(response).toEqual({
      status: 404,
      body: { error: 'Account not found' },
    });
  });

  it('blocks deletion while deployments reference the account', async () => {
    mockGetTradingAccount.mockResolvedValue({ id: 'tradfi-main' });
    mockListRuntimeDeployments.mockResolvedValue([
      { id: 'tradfi-live', accountId: 'tradfi-main' },
      { id: 'tradfi-paper', accountId: 'tradfi-main' },
    ]);

    const response = await DELETE({} as Request, context('tradfi-main'));

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'Account is used by deployments: tradfi-live, tradfi-paper',
    });
    expect(mockDeleteTradingAccount).not.toHaveBeenCalled();
  });

  it('deletes an unreferenced account', async () => {
    mockGetTradingAccount.mockResolvedValue({ id: 'tradfi-main' });

    const response = await DELETE({} as Request, context('tradfi-main'));

    expect(mockDeleteTradingAccount).toHaveBeenCalledWith(
      'root',
      'tradfi-main',
    );
    expect(response).toEqual({ status: 200, body: { deleted: true } });
  });
});
