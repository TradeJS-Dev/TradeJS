import { NextRequest, NextResponse } from 'next/server';
import {
  getRuntimeDeployment,
  saveRuntimeDeployment,
} from '@tradejs/infra/runtimeDeployments';
import { recordRuntimeStrategyControlEvent } from '@tradejs/infra/runtimeStrategyReleases';
import type { RuntimeStrategyControlState } from '@tradejs/types';
import { getCurrentUserName } from '#app/lib/currentUser';

export const PATCH = async (
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ deploymentId: string; strategyName: string }>;
  },
) => {
  const userName = await getCurrentUserName();
  if (!userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { deploymentId, strategyName: encodedStrategyName } = await params;
  const strategyName = decodeURIComponent(encodedStrategyName);
  const deployment = await getRuntimeDeployment(userName, deploymentId);
  if (!deployment) {
    return NextResponse.json(
      { error: 'Deployment not found' },
      { status: 404 },
    );
  }
  const body = (await request.json()) as { controlState?: unknown };
  if (
    body.controlState !== 'active' &&
    body.controlState !== 'entries_paused'
  ) {
    return NextResponse.json(
      { error: 'controlState must be active or entries_paused' },
      { status: 400 },
    );
  }
  const controlState: RuntimeStrategyControlState = body.controlState;
  const reference = deployment.strategies.find(
    (strategy) => strategy.strategyName === strategyName,
  );
  if (!reference) {
    return NextResponse.json(
      { error: 'Pause/resume requires a versioned strategy release' },
      { status: 400 },
    );
  }
  const previousState = reference.controlState;
  if (previousState === controlState) {
    return NextResponse.json({ deployment, controlState });
  }
  const updated = await saveRuntimeDeployment(userName, {
    ...deployment,
    strategies: deployment.strategies.map((strategy) =>
      strategy.strategyName === strategyName
        ? { ...strategy, controlState }
        : strategy,
    ),
  });
  const event = await recordRuntimeStrategyControlEvent({
    userName,
    deploymentId: deployment.id,
    strategyName,
    releaseVersion: reference.releaseVersion,
    previousState,
    nextState: controlState,
    createdBy: userName,
  });
  return NextResponse.json({ deployment: updated, controlState, event });
};
