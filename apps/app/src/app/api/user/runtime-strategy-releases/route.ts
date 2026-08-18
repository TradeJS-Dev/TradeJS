import { NextRequest, NextResponse } from 'next/server';
import {
  getRuntimeStrategyReleaseOptions,
  publishRuntimeStrategyReleaseForUser,
  saveRuntimeStrategyReleaseDraftForUser,
} from '#app/lib/runtimeStrategyReleaseService';
import { getCurrentUserName } from '#app/lib/currentUser';

export const dynamic = 'force-dynamic';

const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

export const GET = async () => {
  const userName = await getCurrentUserName();
  if (!userName)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(
    await getRuntimeStrategyReleaseOptions({ userName, projectRoot }),
  );
};

export const PATCH = async (request: NextRequest) => {
  const userName = await getCurrentUserName();
  if (!userName)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const draft = await saveRuntimeStrategyReleaseDraftForUser({
      userName,
      projectRoot,
      input: (await request.json()) as Record<string, unknown>,
    });
    return NextResponse.json({ draft });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
};

export const POST = async (request: NextRequest) => {
  const userName = await getCurrentUserName();
  if (!userName)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = (await request.json()) as { strategyName?: unknown };
    const release = await publishRuntimeStrategyReleaseForUser({
      userName,
      projectRoot,
      strategyName: String(body.strategyName ?? '').trim(),
    });
    return NextResponse.json({ release });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
};
