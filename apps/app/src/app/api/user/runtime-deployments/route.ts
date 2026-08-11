import { NextRequest, NextResponse } from 'next/server';
import {
  getRuntimeDeploymentHeartbeat,
  listRuntimeDeployments,
  saveRuntimeDeployment,
} from '@tradejs/infra/runtimeDeployments';
import { getTradingAccount } from '@tradejs/infra/tradingAccounts';
import { isMarketUniverse, type RuntimeDeployment } from '@tradejs/types';
import { getCurrentUserName } from '#app/lib/currentUser';

export const dynamic = 'force-dynamic';

export const GET = async () => {
  const userName = await getCurrentUserName();
  if (!userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const deployments = await listRuntimeDeployments(userName);
  const withHeartbeats = await Promise.all(
    deployments.map(async (deployment) => ({
      ...deployment,
      heartbeat: await getRuntimeDeploymentHeartbeat(userName, deployment.id),
    })),
  );
  return NextResponse.json({ deployments: withHeartbeats });
};

export const POST = async (request: NextRequest) => {
  const userName = await getCurrentUserName();
  if (!userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = (await request.json()) as Partial<RuntimeDeployment>;
    const universe = body.universe;
    if (
      !body.id ||
      !body.label ||
      !body.connectorName ||
      !body.provider ||
      !body.accountId ||
      !body.interval ||
      !isMarketUniverse(universe) ||
      !Array.isArray(body.strategies) ||
      !body.strategies.length ||
      body.strategies.some(
        (strategy) =>
          !String(strategy.strategyName ?? '').trim() ||
          !String(strategy.policyProfileId ?? '').trim(),
      )
    ) {
      return NextResponse.json(
        { error: 'Invalid runtime deployment' },
        { status: 400 },
      );
    }
    const account = await getTradingAccount(userName, body.accountId);
    if (
      !account ||
      !account.enabled ||
      account.provider !== body.provider.toLowerCase()
    ) {
      return NextResponse.json(
        { error: 'Deployment trading account is unavailable' },
        { status: 400 },
      );
    }
    if (!account.universes.includes(universe)) {
      return NextResponse.json(
        { error: `Account ${account.id} does not support ${universe}` },
        { status: 400 },
      );
    }
    const deployment = await saveRuntimeDeployment(userName, {
      id: body.id,
      label: body.label,
      connectorName: body.connectorName,
      provider: body.provider,
      accountId: body.accountId,
      universe,
      interval: String(body.interval),
      enabled: body.enabled !== false,
      strategies: body.strategies,
      assetClasses: body.assetClasses,
      tickers: body.tickers,
    });
    return NextResponse.json({ deployment });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
};
