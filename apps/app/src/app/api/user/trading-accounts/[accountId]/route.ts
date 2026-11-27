import { NextResponse } from 'next/server';
import {
  deleteTradingAccount,
  getTradingAccount,
} from '@tradejs/infra/tradingAccounts';
import { listRuntimeDeployments } from '@tradejs/node/runtimeStrategies';
import { getCurrentUserName } from '#app/lib/currentUser';
import { requireActionConfirmation } from '#app/lib/actionConfirmation';

export const DELETE = async (
  request: Request,
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
  const projectRoot =
    String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
  const referencedBy = (
    await listRuntimeDeployments({ userName, projectRoot })
  ).filter((deployment) => deployment.accountId === account.id);
  if (referencedBy.length) {
    return NextResponse.json(
      {
        error: `Account is used by deployments: ${referencedBy.map(({ id }) => id).join(', ')}`,
      },
      { status: 409 },
    );
  }
  const body: unknown = await request.json().catch(() => null);
  const proof =
    body && typeof body === 'object' && 'confirmation' in body
      ? body.confirmation
      : undefined;
  const failure = await requireActionConfirmation(userName, proof);
  if (failure) return failure;
  await deleteTradingAccount(userName, accountId);
  return NextResponse.json({ deleted: true });
};
