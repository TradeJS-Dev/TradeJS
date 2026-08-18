import { NextRequest, NextResponse } from 'next/server';
import {
  getRuntimeDeploymentHeartbeat,
  listRuntimeDeployments,
  saveRuntimeDeployment,
} from '@tradejs/infra/runtimeDeployments';
import { getTradingAccount } from '@tradejs/infra/tradingAccounts';
import { getRuntimeStrategyRelease } from '@tradejs/infra/runtimeStrategyReleases';
import type {
  MarketUniverse,
  RuntimeDeployment,
  RuntimeDeploymentStrategy,
} from '@tradejs/types';
import { getCurrentUserName } from '#app/lib/currentUser';

export const dynamic = 'force-dynamic';

const isRuntimeStrategyReference = (
  value: unknown,
): value is RuntimeDeploymentStrategy => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.strategyName === 'string' &&
    record.strategyName.trim().length > 0 &&
    Number.isSafeInteger(record.releaseVersion) &&
    Number(record.releaseVersion) > 0 &&
    (record.controlState === 'active' ||
      record.controlState === 'entries_paused') &&
    Object.keys(record).every((key) =>
      ['strategyName', 'releaseVersion', 'controlState'].includes(key),
    )
  );
};

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
    if (
      !Array.isArray(body.strategies) ||
      !body.strategies.length ||
      !body.strategies.every(isRuntimeStrategyReference)
    ) {
      return NextResponse.json(
        { error: 'Invalid runtime strategy reference' },
        { status: 400 },
      );
    }
    const releases = await Promise.all(
      body.strategies.map(async (strategy) => {
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
    );
    if (
      !body.id ||
      !body.label ||
      !body.connectorName ||
      !body.provider ||
      !body.accountId ||
      typeof body.enabled !== 'boolean'
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
    const unsupportedUniverse = releases
      .map((release) => release.config.UNIVERSE as MarketUniverse)
      .find((universe) => !account.universes.includes(universe));
    if (unsupportedUniverse) {
      return NextResponse.json(
        {
          error: `Account ${account.id} does not support ${unsupportedUniverse}`,
        },
        { status: 400 },
      );
    }
    const deployment = await saveRuntimeDeployment(userName, {
      id: body.id,
      label: body.label,
      connectorName: body.connectorName,
      provider: body.provider,
      accountId: body.accountId,
      enabled: body.enabled,
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
