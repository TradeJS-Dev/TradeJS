import { NextRequest, NextResponse } from 'next/server';
import {
  getRuntimeStrategyConfigOptions,
  RuntimeStrategyConfigServiceError,
  saveRuntimeStrategyConfigForUser,
} from '#app/lib/runtimeStrategyConfigService';
import { getCurrentUserName } from '#app/lib/currentUser';

export const dynamic = 'force-dynamic';

const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

export const GET = async () => {
  const userName = await getCurrentUserName();
  if (!userName)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(
    await getRuntimeStrategyConfigOptions({ userName, projectRoot }),
  );
};

const save = async (request: NextRequest, editing: boolean) => {
  const userName = await getCurrentUserName();
  if (!userName)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(
      await saveRuntimeStrategyConfigForUser({
        userName,
        projectRoot,
        input: (await request.json()) as Record<string, unknown>,
        editing,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      error instanceof RuntimeStrategyConfigServiceError &&
      error.code === 'conflict'
        ? 409
        : error instanceof RuntimeStrategyConfigServiceError &&
            error.code === 'not_found'
          ? 404
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
};

export const POST = (request: NextRequest) => save(request, false);
export const PATCH = (request: NextRequest) => save(request, true);
