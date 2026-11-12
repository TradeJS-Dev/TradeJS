import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@tradejs/infra/logger';
import { getCurrentUserName } from '#app/lib/currentUser';
import { listBacktestJobs, startBacktestJob } from '#app/lib/backtestJobs';
import { listCliBacktestRuns } from '#app/lib/cliBacktestRuns';
import {
  getResearchStudyHeader,
  isResearchLibraryOwner,
} from '#app/lib/researchLibrary';
import { parseStudyKey } from '#app/lib/researchStudyLinks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const GET = async (req: NextRequest) => {
  try {
    const userName = await getCurrentUserName();
    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const jobs =
      req.nextUrl.searchParams.get('source') === 'cli'
        ? await listCliBacktestRuns(userName)
        : await listBacktestJobs(userName);
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
    if (payload?.researchStudy !== undefined) {
      if (!isResearchLibraryOwner(userName)) {
        return NextResponse.json(
          { error: 'Research is available to the project owner.' },
          { status: 403 },
        );
      }
      const study =
        typeof payload.researchStudy === 'string'
          ? parseStudyKey(payload.researchStudy.trim())
          : null;
      if (!study || !(await getResearchStudyHeader(study.strategy, study.id))) {
        return NextResponse.json(
          { error: 'Research study not found.' },
          { status: 400 },
        );
      }
    }
    const job = await startBacktestJob(userName, payload);
    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    const message = toErrorMessage(error);
    logger.log('error', 'Backtest run start error: %o', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
};
