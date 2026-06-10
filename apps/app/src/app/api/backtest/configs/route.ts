import { NextResponse } from 'next/server';
import { logger } from '@tradejs/infra/logger';
import { getCurrentUserName } from '#app/lib/currentUser';
import { listBacktestConfigs } from '#app/lib/backtestJobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = async () => {
  try {
    const userName = await getCurrentUserName();
    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const configs = await listBacktestConfigs(userName);
    return NextResponse.json({ configs });
  } catch (error) {
    logger.log('error', 'Backtest configs error: %o', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
