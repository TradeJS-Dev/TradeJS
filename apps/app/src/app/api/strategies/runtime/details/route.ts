import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@tradejs/infra/logger';
import { readRuntimeLaunchReport } from '@tradejs/node/runtimeStrategies';
import { getCurrentUserName } from '#app/lib/currentUser';

export const GET = async (request: NextRequest) => {
  if (!(await getCurrentUserName())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const deploymentId = request.nextUrl.searchParams.get('deploymentId');
  const strategyName = request.nextUrl.searchParams.get('strategyName');
  if (!deploymentId || !strategyName) {
    return NextResponse.json(
      { error: 'Missing strategy or deployment' },
      { status: 400 },
    );
  }

  try {
    const response = await readRuntimeLaunchReport({
      projectRoot: process.env.PROJECT_CWD?.trim() || process.cwd(),
      deploymentId,
      strategyName,
    });
    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    logger.error('strategy launch report failed: %o', error);
    return NextResponse.json(
      { error: 'Unable to load launch report' },
      { status: 500 },
    );
  }
};
