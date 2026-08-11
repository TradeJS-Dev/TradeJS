import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@tradejs/infra/logger';
import { getCurrentUserName } from '#app/lib/currentUser';
import { loadRuntimeDashboard } from '#app/lib/runtimeDashboard';

export const dynamic = 'force-dynamic';

export const GET = async (request: NextRequest) => {
  try {
    const userName = await getCurrentUserName();
    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const response = await loadRuntimeDashboard({
      userName,
      provider: request.nextUrl.searchParams.get('provider'),
      hours: request.nextUrl.searchParams.get('hours'),
    });

    return NextResponse.json(response);
  } catch (error) {
    logger.error('strategies runtime route failed: %o', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
