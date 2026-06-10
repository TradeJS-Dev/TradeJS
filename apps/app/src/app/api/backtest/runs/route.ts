import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@tradejs/infra/logger';
import { getCurrentUserName } from '#app/lib/currentUser';
import { listBacktestJobs, startBacktestJob } from '#app/lib/backtestJobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const GET = async () => {
  try {
    const userName = await getCurrentUserName();
    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const jobs = await listBacktestJobs(userName);
    return NextResponse.json({ jobs });
  } catch (error) {
    logger.log('error', 'Backtest runs list error: %o', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};

export const POST = async (req: NextRequest) => {
  try {
    const userName = await getCurrentUserName();
    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const job = await startBacktestJob(userName, payload);
    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    const message = toErrorMessage(error);
    logger.log('error', 'Backtest run start error: %o', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
};
