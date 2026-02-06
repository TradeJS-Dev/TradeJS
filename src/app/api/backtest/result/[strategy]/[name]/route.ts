'use server';

import { NextResponse } from 'next/server';
import { OrderLogData, Test, TestResult, TestStat } from '@types';
import { getData, redisKeys } from '@utils/redis';
import { compactOrderLog, getTimeline } from '@utils/timestamp';
import { logger } from '@utils/logger';
import { auth } from '@app/auth';

interface Params {
  strategy: string;
  name: string;
}

export const GET = async (
  _req: Request,
  { params }: { params: Promise<Params> },
) => {
  try {
    const { name, strategy } = await params;

    if (!name || !strategy) {
      return NextResponse.json(
        { error: 'Missing required parameter: name/strategy' },
        { status: 400 },
      );
    }

    const session = await auth();
    const userName = session?.user?.id || session?.user?.name;

    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const orderLog: OrderLogData = await getData(
      redisKeys.testOrders(userName, strategy, name),
    );
    const test: Test = await getData(
      redisKeys.testConfig(userName, strategy, name),
    );
    const stat: TestStat = await getData(
      redisKeys.testStat(userName, strategy, name),
    );

    const timeline = getTimeline(test.options.start, test.options.end);

    const payload: TestResult = {
      test,
      orderLog: compactOrderLog(timeline, orderLog),
      stat,
    };

    return NextResponse.json({ result: payload });
  } catch (error) {
    logger.log('error', `Backtest load error: %o`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
