import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@tradejs/infra/logger';
import { getCurrentUserName } from '#app/lib/currentUser';
import {
  cancelBacktestJob,
  deleteBacktestJob,
  getBacktestJob,
  heartbeatBacktestJob,
  pauseBacktestJob,
  resumeBacktestJob,
} from '#app/lib/backtestJobs';

interface Params {
  jobId: string;
}

type BacktestJobAction = 'pause' | 'stop' | 'resume' | 'cancel' | 'heartbeat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const isBacktestJobAction = (value: unknown): value is BacktestJobAction =>
  value === 'pause' ||
  value === 'stop' ||
  value === 'resume' ||
  value === 'cancel' ||
  value === 'heartbeat';

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<Params> },
) => {
  try {
    const userName = await getCurrentUserName();
    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId } = await params;
    const job = await getBacktestJob(userName, jobId);
    if (!job) {
      return NextResponse.json(
        { error: 'Backtest job not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ job });
  } catch (error) {
    logger.log('error', 'Backtest run load error: %o', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<Params> },
) => {
  try {
    const userName = await getCurrentUserName();
    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId } = await params;
    const payload = (await req.json()) as { action?: unknown };
    const action = payload.action;
    if (!isBacktestJobAction(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const job =
      action === 'pause'
        ? await pauseBacktestJob(userName, jobId, 'manual_pause')
        : action === 'stop'
          ? await pauseBacktestJob(userName, jobId, 'manual_stop')
          : action === 'resume'
            ? await resumeBacktestJob(userName, jobId)
            : action === 'cancel'
              ? await cancelBacktestJob(userName, jobId)
              : await heartbeatBacktestJob(userName, jobId);

    if (!job) {
      return NextResponse.json(
        { error: 'Backtest job not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ job });
  } catch (error) {
    const message = toErrorMessage(error);
    logger.log('error', 'Backtest run action error: %o', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
};

export const DELETE = async (
  _req: NextRequest,
  { params }: { params: Promise<Params> },
) => {
  try {
    const userName = await getCurrentUserName();
    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId } = await params;
    const deleted = await deleteBacktestJob(userName, jobId);
    return NextResponse.json({ deleted });
  } catch (error) {
    logger.log('error', 'Backtest run delete error: %o', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
