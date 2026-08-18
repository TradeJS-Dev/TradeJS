import { NextRequest, NextResponse } from 'next/server';
import {
  getRuntimeDeploymentHeartbeat,
  listRuntimeDeployments,
  saveRuntimeDeployment,
} from '@tradejs/infra/runtimeDeployments';
import { getTradingAccount } from '@tradejs/infra/tradingAccounts';
import { getRuntimeStrategyRelease } from '@tradejs/infra/runtimeStrategyReleases';
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
    const hasVersionedStrategies = Boolean(
      body.strategies?.some((strategy) => strategy.releaseVersion != null),
    );
    if (
      hasVersionedStrategies &&
      body.strategies?.some((strategy) => strategy.releaseVersion == null)
    ) {
      return NextResponse.json(
        { error: 'A deployment cannot mix legacy configs and releases' },
        { status: 400 },
      );
    }
    const releases = hasVersionedStrategies
      ? await Promise.all(
          (body.strategies ?? []).map(async (strategy) => {
            if (
              !Number.isSafeInteger(strategy.releaseVersion) ||
              !strategy.releaseVersion ||
              (strategy.config && Object.keys(strategy.config).length)
            ) {
              throw new Error('Invalid versioned strategy reference');
            }
            const release = await getRuntimeStrategyRelease(
              userName,
              strategy.strategyName,
              strategy.releaseVersion,
            );
            if (!release) {
              throw new Error(
                `Release not found: ${strategy.strategyName} v${strategy.releaseVersion}`,
              );
            }
            return release;
          }),
        )
      : [];
    const universe = releases[0]?.config.UNIVERSE ?? body.universe;
    const interval = releases[0]?.config.INTERVAL ?? body.interval;
    if (
      !body.id ||
      !body.label ||
      !body.connectorName ||
      !body.provider ||
      !body.accountId ||
      !interval ||
      !isMarketUniverse(universe) ||
      !Array.isArray(body.strategies) ||
      !body.strategies.length ||
      body.strategies.some((strategy) =>
        hasVersionedStrategies
          ? !String(strategy.strategyName ?? '').trim()
          : !String(strategy.strategyName ?? '').trim() ||
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
      interval: String(interval),
      enabled: body.enabled !== false,
      strategies: body.strategies.map((strategy) =>
        hasVersionedStrategies
          ? {
              strategyName: strategy.strategyName,
              releaseVersion: strategy.releaseVersion,
              controlState: strategy.controlState ?? 'active',
            }
          : strategy,
      ),
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
