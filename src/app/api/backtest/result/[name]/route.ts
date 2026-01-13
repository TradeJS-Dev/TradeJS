import { NextResponse } from 'next/server';
import { OrderLogData, Test, TestResult, TestStat } from '@types';
import { getData, redisKeys } from '@utils/redis';
import { compactOrderLog, getTimeline } from '@utils/timestamp';
import { logger } from '@utils/logger';

interface Params {
  name: string;
}

export const GET = async (
  _req: Request,
  { params }: { params: Promise<Params> },
) => {
  try {
    const { name } = await params;

    if (!name) {
      return NextResponse.json(
        { error: 'Missing required parameter: name' },
        { status: 400 },
      );
    }

    const orderLog: OrderLogData = await getData(
      redisKeys.testOrders('root', name),
    );
    const test: Test = await getData(redisKeys.testConfig('root', name));
    const stat: TestStat = await getData(redisKeys.testStat('root', name));

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
