import { NextRequest, NextResponse } from 'next/server';
import {
  pauseRuntimeStrategy,
  recordRuntimeStrategyControlEvent,
  resumeRuntimeStrategy,
} from '@tradejs/infra/runtimeControls';
import { getRuntimeDeployment } from '@tradejs/node/runtimeStrategies';
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
  const projectRoot =
    String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
  const deployment = await getRuntimeDeployment({
    userName,
    projectRoot,
    deploymentId,
  });
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
      { error: 'Strategy is not declared in tradejs.config.ts' },
      { status: 400 },
    );
  }
  const previousState = reference.controlState;
  if (previousState === controlState) {
    return NextResponse.json({ deployment, controlState });
  }
  if (
    controlState === 'active' &&
    (!deployment.enabled || !reference.enabled)
  ) {
    return NextResponse.json(
      { error: 'Strategy is disabled in tradejs.config.ts' },
      { status: 409 },
    );
  }
  if (controlState === 'entries_paused') {
    await pauseRuntimeStrategy({
      userName,
      deploymentId,
      strategyName,
      updatedBy: userName,
    });
  } else {
    await resumeRuntimeStrategy({ userName, deploymentId, strategyName });
  }
  const updated = await getRuntimeDeployment({
    userName,
    projectRoot,
    deploymentId,
  });
  const event = await recordRuntimeStrategyControlEvent({
    userName,
    deploymentId: deployment.id,
    strategyName,
    version: reference.version,
    previousState,
    nextState: controlState,
    createdBy: userName,
  });
  return NextResponse.json({ deployment: updated, controlState, event });
};
