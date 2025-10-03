import { NextResponse } from 'next/server';
import { OrderLogData, Test, TestResult, TestStat } from '@types';
import { getData } from '@utils/data';
import { compactOrderLog, getTimeline } from '@utils/timestamp';
import { logger } from '@utils/logger';

const DIR = 'data/tests';

interface Params {
  name: string;
}

export const GET = async (_req: Request, { params }: { params: Params }) => {
  try {
    const { name } = params;

    if (!name) {
      return NextResponse.json(
        { error: 'Missing required parameter: name' },
        { status: 400 },
      );
    }

    const orderLog: OrderLogData = await getData(DIR, `${name}.orders`);
    const test: Test = await getData(DIR, `${name}.config`);
    const stat: TestStat = await getData(DIR, `${name}.stat`);

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
