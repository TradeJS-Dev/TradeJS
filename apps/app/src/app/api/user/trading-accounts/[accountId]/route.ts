import { NextResponse } from 'next/server';
import {
  deleteTradingAccount,
  getTradingAccount,
  listRuntimeDeployments,
} from '@tradejs/infra/tradingAccounts';
import { getCurrentUserName } from '#app/lib/currentUser';

export const DELETE = async (
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) => {
  const userName = await getCurrentUserName();
  if (!userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { accountId } = await params;
  const account = await getTradingAccount(userName, accountId);
  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }
  const referencedBy = (await listRuntimeDeployments(userName)).filter(
    (deployment) => deployment.accountId === account.id,
  );
  if (referencedBy.length) {
    return NextResponse.json(
      {
        error: `Account is used by deployments: ${referencedBy.map(({ id }) => id).join(', ')}`,
      },
      { status: 409 },
    );
  }
  await deleteTradingAccount(userName, accountId);
  return NextResponse.json({ deleted: true });
};
